import { getStoredEnergy, isStructureEmpty, isStructureFull } from "../../game/Structures";
import { CreepSetup } from "../../creepSetups/CreepSetup";
import { Roles, Setups } from "../../creepSetups/setups";
import { Hatchery } from "../../hiveClusters/hatchery";
import { OverlordPriority } from "../../priorities/priorities_overlords";
import { profile } from "../../profiler/decorator";
import { refillPassingQueen } from "./queenDelivery";
import { returningTerminalEnergy, shuttleToTerminal } from "../../strategy/terminalEvacuation";
import { Tasks } from "../../tasks/Tasks";
import { Zerg } from "../../zerg/Zerg";
import { DEFAULT_PRESPAWN, Overlord } from "../Overlord";

/**
 * Spawns a dedicated hatchery attendant to refill spawns and extensions
 */
@profile
export class QueenOverlord extends Overlord {
  hatchery: Hatchery;
  queenSetup: CreepSetup;
  queens: Zerg[];
  settings: any;

  constructor(hatchery: Hatchery, priority = OverlordPriority.core.queen) {
    super(hatchery, "supply", priority);
    this.hatchery = hatchery;
    this.queenSetup =
      this.colony.storage && !this.colony.state.isRebuilding
        ? Setups.queens.default
        : Setups.queens.early;
    this.queens = this.zerg(Roles.queen);
    this.settings = {
      refillTowersBelow: 500,
    };
  }

  init() {
    const amount = 1;
    const prespawn = this.hatchery.spawns.length <= 1 ? 100 : DEFAULT_PRESPAWN;
    this.wishlist(amount, this.queenSetup, { prespawn: prespawn });
  }

  private assignDelivery(queen: Zerg): boolean {
    // Select the closest supply target out of the highest priority and refill it
    const request = this.hatchery.transportRequests.getPrioritizedClosestRequest(
      queen.pos,
      "supply",
    );
    if (!request) return false;
    queen.task = Tasks.transfer(request.target);
    return true;
  }

  private getRechargeSource(queen: Zerg): StructureContainer | StructureLink | null {
    const wanted = queen.store.getFreeCapacity();
    if (wanted <= 0) return null;
    if (this.colony?.roomPlanner?.memory.logisticsPolicy?.queenBufferFirst) {
      const batteries = this.hatchery.batteries.filter((b) => getStoredEnergy(b) > 0);
      // A full buffer supports one full load; a live Link holds only 800.
      const fullBattery = queen.pos.findClosestByRange(
        batteries.filter((b) => getStoredEnergy(b) >= wanted),
      );
      if (fullBattery) return fullBattery;
      const link = this.hatchery.link;
      if (link && getStoredEnergy(link) >= wanted) {
        return link;
      }
      // Never wait for a full load when energy is scarce. Use the largest
      // available partial load, with distance breaking equal-amount ties.
      const sources = link && !isStructureEmpty(link) ? [...batteries, link] : batteries;
      const available = Math.max(0, ...sources.map((source) => getStoredEnergy(source)));
      return queen.pos.findClosestByRange(
        sources.filter((candidate) => getStoredEnergy(candidate) == available),
      );
    }
    if (this.hatchery.link && !isStructureEmpty(this.hatchery.link)) {
      return this.hatchery.link;
    }
    return queen.pos.findClosestByRange(
      this.hatchery.batteries.filter((b) => getStoredEnergy(b) > 0),
    );
  }

  private rechargeActions(queen: Zerg): boolean {
    const source = this.getRechargeSource(queen);
    if (!source) return false;
    queen.task = Tasks.withdraw(source);
    return true;
  }

  private handleQueen(queen: Zerg): void {
    const wasRecharging = queen.memory.queenRecharging;
    if (wasRecharging) {
      if (this.rechargeActions(queen)) return;
      delete queen.memory.queenRecharging;
    }
    if (queen.store.energy > 0 && this.assignDelivery(queen)) return;
    if (!wasRecharging && this.rechargeActions(queen)) {
      // Withdraw is a one-shot task; continue this refill on the next tick.
      queen.memory.queenRecharging = true;
      return;
    }
    if (queen.store.getFreeCapacity() > 0) {
      queen.task = Tasks.recharge();
      if (queen.task) queen.memory.queenRecharging = true;
    } else if (this.hatchery.link && !isStructureEmpty(this.hatchery.link)) {
      // Move link energy into the battery while idle.
      const battery = queen.pos.findClosestByRange(this.hatchery.batteries);
      if (battery && !isStructureFull(battery)) queen.task = Tasks.transfer(battery);
    }
  }

  run() {
    for (const queen of this.queens) {
      // Keep a valid task until completion. Choosing the closest request every
      // tick can alternate targets as the queen moves around extensions.
      if (queen.isIdle) {
        if (
          this.colony?.memory?.terminalEvacuation?.returnEnergy &&
          returningTerminalEnergy(this.colony) &&
          (this.colony.terminal?.store.energy || 0) > 1000 &&
          this.colony.room.energyAvailable === this.colony.room.energyCapacityAvailable &&
          this.colony.towers.every((t) => t.store.energy >= 600) &&
          shuttleToTerminal(this.colony, queen)
        )
          continue;
        this.handleQueen(queen);
      }
      // Run the task if you have one; else move back to idle pos
      if (queen.hasValidTask) {
        queen.run();
        refillPassingQueen(queen);
      } else {
        if (this.queens.length > 1) {
          queen.goTo(this.hatchery.idlePos, { range: 1 });
        } else {
          queen.goTo(this.hatchery.idlePos);
        }
      }
    }
  }
}
