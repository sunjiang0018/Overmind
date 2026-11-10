import { getRoomContainers, getRoomLinks } from "../../game/RoomStructures";
import { getStoredGhodium } from "../../game/Structures";
import { $ } from "../../caching/GlobalCache";
import { Colony } from "../../Colony";
import { log } from "../../console/log";
import { CreepSetup } from "../../creepSetups/CreepSetup";
import { Roles, Setups } from "../../creepSetups/setups";
import { Hatchery } from "../../hiveClusters/hatchery";
import { TransportRequest } from "../../logistics/TransportRequestGroup";
import { Pathing } from "../../movement/Pathing";
import { OverlordPriority } from "../../priorities/priorities_overlords";
import { profile } from "../../profiler/decorator";
import {
  getPosFromBunkerCoord,
  insideBunkerBounds,
  quadrantFillOrder,
} from "../../roomPlanner/layouts/bunker";
import { Task } from "../../tasks/Task";
import { Tasks } from "../../tasks/Tasks";
import { hasMinerals, mergeSum, minBy } from "../../utilities/utils";
import { Zerg } from "../../zerg/Zerg";
import { Overlord } from "../Overlord";
import { compact, zipObject, sum, sortBy } from "../../utilities/native";

import { isSupplyStructure, refillPassingQueen, type SupplyStructure } from "./queenDelivery";

type SupplySource = StructureContainer | StructureLink | StructureStorage | StructureTerminal;

function isEnergyBuffer(structure: SupplySource): boolean {
  return (
    structure.structureType == STRUCTURE_LINK || structure.structureType == STRUCTURE_CONTAINER
  );
}

function computeQuadrant(colony: Colony, quadrant: Coord[]): SupplyStructure[] {
  const positions = quadrant.map((coord) => getPosFromBunkerCoord(coord, colony));
  const structures: SupplyStructure[] = [];
  for (const pos of positions) {
    const structure = pos.lookFor(LOOK_STRUCTURES).find((s) => isSupplyStructure(s)) as
      | SupplyStructure
      | undefined;
    if (structure) {
      structures.push(structure);
    }
  }
  return structures;
}

/**
 * A modified version of the queen overlord which contains a number of hard-coded optimization for bunker-type rooms.
 * This overlord supercedes the default queen overlord once the colony has a storage with a minimum amount of energy.
 */
@profile
export class BunkerQueenOverlord extends Overlord {
  room: Room;
  queens: Zerg[];
  queenSetup: CreepSetup;
  storeStructures: SupplySource[];
  batteries: StructureContainer[];
  links: StructureLink[]; // hacky workaround for new typings
  quadrants: { [quadrant: string]: SupplyStructure[] };
  private numActiveQueens: number;
  assignments: { [queenName: string]: { [id: string]: boolean } };

  constructor(hatchery: Hatchery, priority = OverlordPriority.core.queen) {
    super(hatchery, "supply", priority);
    this.queenSetup = Setups.queens.default;
    this.queens = this.zerg(Roles.queen);
    this.batteries = getRoomContainers(this.room).filter((container) =>
      insideBunkerBounds(container.pos, this.colony),
    );
    this.links = getRoomLinks(this.room).filter((link) =>
      insideBunkerBounds(link.pos, this.colony),
    );
    this.storeStructures = compact([
      this.colony.terminal!,
      this.colony.storage!,
      ...this.batteries,
      ...this.links,
    ]);
    this.quadrants = {
      lowerRight: $.structures(this, "LR", () =>
        computeQuadrant(this.colony, quadrantFillOrder.lowerRight),
      ),
      upperLeft: $.structures(this, "UL", () =>
        computeQuadrant(this.colony, quadrantFillOrder.upperLeft),
      ),
      lowerLeft: $.structures(this, "LL", () =>
        computeQuadrant(this.colony, quadrantFillOrder.lowerLeft),
      ),
      upperRight: $.structures(this, "UR", () =>
        computeQuadrant(this.colony, quadrantFillOrder.upperRight),
      ),
    };
    this.computeQueenAssignments();
  }

  /**
   * Computes "quadrants" of locally grouped structures (the arms on the Overmind spiral)
   * and assigns them to the attending queens.
   */
  private computeQueenAssignments() {
    this.assignments = zipObject(this.queens.map((queen) => [queen.name, {}]));
    const activeQueens = this.queens.filter((queen) => !queen.spawning);
    this.numActiveQueens = activeQueens.length;
    if (this.numActiveQueens > 0) {
      const quadrantAssignmentOrder = [
        this.quadrants.lowerRight,
        this.quadrants.upperLeft,
        this.quadrants.lowerLeft,
        this.quadrants.upperRight,
      ];
      let i = 0;
      for (const quadrant of quadrantAssignmentOrder) {
        const queen = activeQueens[i % activeQueens.length];
        Object.assign(this.assignments[queen.name], zipObject(quadrant.map((s) => [s.id, true])));
        i++;
      }
    }
  }

  refresh() {
    super.refresh();
    $.refresh(this, "batteries", "storeStructures");
    $.refreshObject(this, "quadrants");
    // Re-compute queen assignments if the number of queens has changed
    if (this.queens.filter((queen) => !queen.spawning).length != this.numActiveQueens) {
      this.computeQueenAssignments();
    }
  }

  init() {
    for (const battery of this.batteries) {
      if (hasMinerals(battery.store)) {
        // get rid of any minerals in the container if present
        this.colony.logisticsNetwork.requestOutputMinerals(battery);
      }
    }
    // const amount = this.colony.spawns.length > 1 ? 2 : 1;
    const amount = this.colony.room.energyCapacityAvailable > 2000 ? 2 : 1;
    this.wishlist(amount, this.queenSetup);
  }

  // Builds a series of tasks to empty unnecessary carry contents, withdraw required resources, and supply structures
  private buildSupplyTaskManifest(queen: Zerg): Task<any> | null {
    const tasks: Task<any>[] = [];
    const queenCarry = {} as { [resourceType: string]: number };
    const allStore = mergeSum(this.storeStructures.map((s) => s.store));
    const carriedEnergy = queen.store.getUsedCapacity(RESOURCE_ENERGY);
    allStore.energy = (allStore.energy || 0) + carriedEnergy;
    const supplyRequests: TransportRequest[] = [];
    for (const priority in this.colony.transportRequests.supply) {
      for (const request of this.colony.transportRequests.supply[priority]) {
        if (this.assignments[queen.name][request.target.id]) {
          supplyRequests.push(request);
        }
      }
    }
    const supplyTasks: Task<any>[] = [];
    for (const request of supplyRequests) {
      // stop when carry will be full
      const remainingAmount = queen.store.getCapacity() - sum(queenCarry);
      if (remainingAmount == 0) break;
      // figure out how much you can withdraw
      let amount = Math.min(request.amount, remainingAmount);
      amount = Math.min(amount, allStore[request.resourceType] || 0);
      if (amount == 0) continue;
      // update the simulated carry
      if (!queenCarry[request.resourceType]) {
        queenCarry[request.resourceType] = 0;
      }
      queenCarry[request.resourceType] += amount;
      allStore[request.resourceType] -= amount;
      // add a task to supply the target
      supplyTasks.push(Tasks.transfer(request.target, request.resourceType, amount));
    }

    // Keep energy between delivery rounds, leaving room for this round's minerals.
    const capacity = queen.store.getCapacity();
    const energyDemand = queenCarry.energy || 0;
    const mineralDemand = sum(queenCarry) - energyDemand;
    const keptEnergy = Math.min(carriedEnergy, capacity - mineralDemand);
    let queenPos = queen.pos;
    const unloadMinerals = hasMinerals(queen.store);
    if (unloadMinerals || carriedEnergy > keptEnergy) {
      const deposit = this.colony.terminal || this.colony.storage || this.batteries[0];
      if (!deposit) return null;
      if (unloadMinerals) tasks.push(Tasks.transferAll(deposit, true));
      if (carriedEnergy > keptEnergy) {
        tasks.push(Tasks.transfer(deposit, RESOURCE_ENERGY, carriedEnergy - keptEnergy));
      }
      queenPos = deposit.pos;
    }

    // Load minerals before an open-ended energy withdrawal.
    const neededResources: ResourceConstant[] = (
      Object.keys(queenCarry) as ResourceConstant[]
    ).filter((resource) => resource != RESOURCE_ENERGY);
    queenCarry.energy = Math.max(0, energyDemand - keptEnergy);
    if (queenCarry.energy > 0) neededResources.push(RESOURCE_ENERGY);
    if (neededResources.length) {
      const targets = this.storeStructures.filter((source) =>
        neededResources.every((resource) => source.store[resource] >= queenCarry[resource]),
      );
      const distance = (target: SupplySource) => Pathing.distance(queenPos, target.pos) ?? Infinity;
      const closest = minBy(targets, distance) || minBy(this.storeStructures, distance);
      if (!closest) return null;
      for (const resource of neededResources) {
        this.addSupplyWithdrawals(
          tasks,
          closest,
          resource,
          queenCarry[resource],
          capacity - mineralDemand - keptEnergy,
        );
      }
    }
    return Tasks.chain(tasks.concat(supplyTasks));
  }

  private addSupplyWithdrawals(
    tasks: Task<any>[],
    closest: SupplySource,
    resource: ResourceConstant,
    required: number,
    energySpace: number,
  ): void {
    // Prefer one stop when possible; otherwise draw from the largest stocks first.
    const sources =
      closest.store[resource] >= required
        ? [closest]
        : sortBy(
            this.storeStructures.filter((s) => s.store[resource] > 0),
            (s) => -s.store[resource],
          );
    const buffers: SupplySource[] = [];
    for (const source of sources) {
      const available = source.store[resource];
      const amount = Math.min(required, available);
      if (resource == RESOURCE_ENERGY && isEnergyBuffer(source)) {
        buffers.push(source);
        energySpace -= available;
      } else {
        tasks.push(Tasks.withdraw(source, resource, amount));
        energySpace -= amount;
      }
      required -= amount;
      if (required == 0) break;
    }

    if (buffers.length && energySpace > 0) {
      for (const source of this.storeStructures) {
        if (!isEnergyBuffer(source) || !source.store.energy || buffers.includes(source)) continue;
        buffers.push(source);
        energySpace -= source.store.energy;
        if (energySpace <= 0) break;
      }
    }
    // Take exact order quantities first, then use the live stock and remaining cargo space.
    for (const buffer of buffers) tasks.push(Tasks.withdraw(buffer));
  }

  /**
   * Builds a series of tasks to withdraw required resources from targets
   */
  private buildWithdrawTaskManifest(queen: Zerg): Task<any> | null {
    const tasks: Task<any>[] = [];
    const transferTarget = this.colony.terminal || this.colony.storage || this.batteries[0];
    // Step 1: empty all contents (this shouldn't be necessary since queen is normally empty at this point)
    if (sum(queen.store) > 0) {
      if (transferTarget) {
        tasks.push(Tasks.transferAll(transferTarget));
      } else {
        log.warning(`No transfer targets for ${queen.print}!`);
        return null;
      }
    }
    // Step 2: figure out what you need to withdraw from
    const queenCarry = { energy: 0 } as { [resourceType: string]: number };
    // let allWithdrawRequests = _.compact(_.flatten(_.map(this.assignments[queen.name],
    // 													struc => this.transportRequests.withdrawByID[struc.id])));
    const withdrawRequests: TransportRequest[] = [];
    for (const priority in this.colony.transportRequests.withdraw) {
      for (const request of this.colony.transportRequests.withdraw[priority]) {
        if (this.assignments[queen.name][request.target.id]) {
          withdrawRequests.push(request);
        }
      }
    }
    for (const request of withdrawRequests) {
      // stop when carry will be full
      const remainingAmount = queen.store.getCapacity() - sum(queenCarry);
      if (remainingAmount == 0) break;
      // figure out how much you can withdraw
      const amount = Math.min(request.amount, remainingAmount);
      if (amount == 0) continue;
      // update the simulated carry
      if (!queenCarry[request.resourceType]) {
        queenCarry[request.resourceType] = 0;
      }
      queenCarry[request.resourceType] += amount;
      // add a task to supply the target
      tasks.push(Tasks.withdraw(request.target, request.resourceType, amount));
    }
    // Step 3: put stuff in terminal/storage
    if (transferTarget) {
      tasks.push(Tasks.transferAll(transferTarget));
    } else {
      log.warning(`No transfer targets for ${queen.print}!`);
      return null;
    }
    // Step 4: return chained task manifest
    return Tasks.chain(tasks);
  }

  // private getChargingSpot(queen: Zerg): RoomPosition {
  // 	let chargeSpots = _.map(bunkerChargingSpots, coord => getPosFromBunkerCoord(coord, this.colony));
  // 	let chargeSpot = (_.first(this.assignments[queen.name]) || queen).pos.findClosestByRange(chargeSpots);
  // 	if (chargeSpot) {
  // 		return chargeSpot;
  // 	} else {
  // 		log.warning(`Could not determine charging spot for queen at ${queen.pos.print}!`);
  // 		return queen.pos;
  // 	}
  // }
  //
  // private idleActions(queen: Zerg): void {
  //
  // 	// // Refill any empty batteries
  // 	// for (let battery of this.batteries) {
  // 	// 	if (!battery.isFull) {
  // 	// 		let amount = Math.min(battery.storeCapacity - _.sum(battery.store), queen.carryCapacity);
  // 	// 		let target = this.colony.storage || this.colony.storage;
  // 	// 		if (target) {
  // 	// 			queen.task = Tasks.transfer(battery, RESOURCE_ENERGY, amount)
  // 	// 							  .fork(Tasks.withdraw(target, RESOURCE_ENERGY, amount))
  // 	// 			return;
  // 	// 		}
  // 	// 	}
  // 	// }
  //
  // 	// Go to recharging spot and get recharged
  // 	let chargingSpot = this.getChargingSpot(queen);
  // 	queen.goTo(chargingSpot, {range: 0});
  // 	// // TODO: this will cause oscillating behavior where recharge drains some energy and queen leaves to supply it
  // 	// if (queen.pos.getRangeTo(chargingSpot) == 0) {
  // 	// 	let chargingSpawn = _.first(queen.pos.findInRange(this.colony.spawns, 1));
  // 	// 	if (chargingSpawn && !chargingSpawn.spawning) {
  // 	// 		chargingSpawn.renewCreep(queen.creep);
  // 	// 	}
  // 	// }
  // }

  private handleQueen(queen: Zerg): void {
    // Does something need withdrawing?
    if (
      this.colony.transportRequests.needsWithdrawing() &&
      Object.keys(this.assignments[queen.name] ?? {}).some(
        (id) => this.colony.transportRequests.withdrawByID[id],
      )
    ) {
      queen.task = this.buildWithdrawTaskManifest(queen);
    }
    // Does something need supplying?
    else if (
      this.colony.transportRequests.needsSupplying() &&
      Object.keys(this.assignments[queen.name] ?? {}).some(
        (id) => this.colony.transportRequests.supplyByID[id],
      )
    ) {
      queen.task = this.buildSupplyTaskManifest(queen);
    }
    // Do we need safemodes?
    else if (
      this.colony.level > 5 &&
      this.colony.controller.safeModeAvailable < 3 &&
      this.colony.terminal &&
      getStoredGhodium(this.colony.terminal) >= 1000 &&
      queen.store.getCapacity() >= 1000
    ) {
      // Only use 1 queen to avoid adding 2 safemodes
      if (queen.name == sortBy(this.queens, (q) => q.name)[0].name) {
        queen.task = Tasks.chain([
          Tasks.transferAll(this.colony.terminal),
          Tasks.withdraw(this.colony.terminal, RESOURCE_GHODIUM, 1000),
          Tasks.generateSafeMode(this.colony.controller),
        ]);
        log.alert(
          `${this.colony.print} has ${this.colony.controller.safeModeAvailable} safemodes avaliable, ` +
            `generating a new one`,
        );
      }
    }
    // Otherwise do idle actions
    if (queen.isIdle) {
      // this.idleActions(queen);
      delete queen.memory._go;
    }
  }

  run() {
    this.autoRun(this.queens, (queen) => this.handleQueen(queen));
    for (const queen of this.queens) refillPassingQueen(queen);
  }
}
