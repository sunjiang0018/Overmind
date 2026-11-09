import { getStoredEnergy, isStructureEmpty, isStructureFull } from "../../game/Structures";
import { CreepSetup } from "../../creepSetups/CreepSetup";
import { Roles, Setups } from "../../creepSetups/setups";
import { Hatchery } from "../../hiveClusters/hatchery";
import { OverlordPriority } from "../../priorities/priorities_overlords";
import { profile } from "../../profiler/decorator";
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

  private supplyActions(queen: Zerg) {
    // Select the closest supply target out of the highest priority and refill it
    const request = this.hatchery.transportRequests.getPrioritizedClosestRequest(
      queen.pos,
      "supply",
    );
    if (request) {
      queen.task = Tasks.transfer(request.target);
    } else {
      this.rechargeActions(queen); // if there are no targets, refill yourself
    }
  }

  private rechargeActions(queen: Zerg): void {
    if (this.colony?.roomPlanner?.memory.logisticsPolicy?.queenBufferFirst) {
      const wanted = queen.store.getCapacity() - queen.store.energy;
      if (wanted <= 0) return;
      const batteries = this.hatchery.batteries.filter((b) => getStoredEnergy(b) > 0);
      // A full buffer supports one full load; a live Link holds only 800.
      const fullBattery = queen.pos.findClosestByRange(
        batteries.filter((b) => getStoredEnergy(b) >= wanted),
      );
      if (fullBattery) {
        queen.task = Tasks.withdraw(fullBattery);
        return;
      }
      const link = this.hatchery.link;
      if (link && getStoredEnergy(link) >= wanted) {
        queen.task = Tasks.withdraw(link);
        return;
      }
      // Never wait for a full load when energy is scarce. Use the largest
      // available partial load, with distance breaking equal-amount ties.
      const sources = link && !isStructureEmpty(link) ? [...batteries, link] : batteries;
      const available = Math.max(0, ...sources.map((source) => getStoredEnergy(source)));
      const source = queen.pos.findClosestByRange(
        sources.filter((candidate) => getStoredEnergy(candidate) == available),
      );
      queen.task = source ? Tasks.withdraw(source) : Tasks.recharge();
      return;
    }
    if (this.hatchery.link && !isStructureEmpty(this.hatchery.link)) {
      queen.task = Tasks.withdraw(this.hatchery.link);
    } else if (this.hatchery.batteries.length > 0) {
      const target = queen.pos.findClosestByRange(
        this.hatchery.batteries.filter((b) => getStoredEnergy(b) > 0),
      );
      if (target) {
        queen.task = Tasks.withdraw(target);
      } else {
        queen.task = Tasks.recharge();
      }
    } else {
      queen.task = Tasks.recharge();
    }
  }

  private idleActions(queen: Zerg): void {
    // will only have one battery when this overlord is called
    const battery = queen.pos.findClosestByRange(this.hatchery.batteries);
    if (this.hatchery.link) {
      // Can energy be moved from the link to the battery?
      if (battery && !isStructureFull(battery) && !isStructureEmpty(this.hatchery.link)) {
        // Move energy to battery as needed
        if (queen.store.energy < queen.store.getCapacity()) {
          queen.task = Tasks.withdraw(this.hatchery.link);
        } else {
          queen.task = Tasks.transfer(battery);
        }
      } else {
        if (queen.store.energy < queen.store.getCapacity()) {
          // make sure you're recharged
          if (!isStructureEmpty(this.hatchery.link)) {
            queen.task = Tasks.withdraw(this.hatchery.link);
          } else if (battery && !isStructureEmpty(battery)) {
            queen.task = Tasks.withdraw(battery);
          }
        }
      }
    } else {
      if (battery && queen.store.energy < queen.store.getCapacity()) {
        queen.task = Tasks.withdraw(battery);
      }
    }
  }

  private handleQueen(queen: Zerg): void {
    if (queen.store.energy > 0) {
      this.supplyActions(queen);
    } else {
      this.rechargeActions(queen);
    }
    // If there aren't any tasks that need to be done, recharge the battery from link
    if (queen.isIdle) {
      this.idleActions(queen);
    }
    // // If all of the above is done and hatchery is not in emergencyMode, move to the idle point and renew as needed
    // if (!this.emergencyMode && queen.isIdle) {
    // 	if (queen.pos.isEqualTo(this.idlePos)) {
    // 		// If queen is at idle position, renew her as needed
    // 		if (queen.ticksToLive < this.settings.renewQueenAt && this.availableSpawns.length > 0) {
    // 			this.availableSpawns[0].renewCreep(queen.creep);
    // 		}
    // 	} else {
    // 		// Otherwise, travel back to idle position
    // 		queen.goTo(this.idlePos);
    // 	}
    // }
  }

  run() {
    for (const queen of this.queens) {
      // Keep a valid task until completion. Choosing the closest request every
      // tick can alternate targets as the queen moves around extensions.
      if (queen.isIdle) {
        this.handleQueen(queen);
      }
      // Run the task if you have one; else move back to idle pos
      if (queen.hasValidTask) {
        queen.run();
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
