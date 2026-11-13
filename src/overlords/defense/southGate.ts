import type { Colony } from "../../Colony";
import { CreepSetup } from "../../creepSetups/CreepSetup";
import { Overlord } from "../Overlord";
import type { Zerg } from "../../zerg/Zerg";
import {
  defendSouthGate,
  guardBoost,
  guardRole,
  menderRole,
  mobilized,
  needsGateRanger,
  prepWall,
  repairBoost,
  southFront,
  supplyWallWorker,
  updateSouthWatch,
  warningRoom,
} from "../../strategy/southGate";

const scout = new CreepSetup("southLookout", { pattern: [MOVE], sizeLimit: 1 });
const guard = new CreepSetup(guardRole, { pattern: [ATTACK, ATTACK, MOVE], sizeLimit: 10 });
const ranger = new CreepSetup("southRanger", {
  pattern: [RANGED_ATTACK, RANGED_ATTACK, MOVE],
  sizeLimit: 5,
});
const mender = new CreepSetup(menderRole, {
  pattern: [
    ...Array<BodyPartConstant>(16).fill(WORK),
    ...Array<BodyPartConstant>(4).fill(CARRY),
    ...Array<BodyPartConstant>(7).fill(MOVE),
  ],
  sizeLimit: 1,
});

export class SouthGateOverlord extends Overlord {
  private scouts = this.zerg(scout.role);
  private guards = this.zerg(guard.role);
  private rangers = this.zerg(ranger.role);
  private menders = this.zerg(mender.role);

  constructor(colony: Colony) {
    super(colony, "southGate", 90);
  }

  init(): void {
    updateSouthWatch(this.colony);
    this.wishlist(1, scout, { prespawn: 175, priority: 199 });
    if (!mobilized(this.colony)) return;
    if (this.colony.room.energyCapacityAvailable >= 2100)
      this.wishlist(1, guard, { priority: 1, prespawn: 50 });
    if (this.colony.room.energyCapacityAvailable >= 1750 && needsGateRanger(this.colony))
      this.wishlist(1, ranger, { priority: 2 });
    if (this.colony.room.energyCapacityAvailable >= 2150)
      this.wishlist(4, mender, { priority: 198, spawnOneAtATime: true });
  }

  private visitBoost(
    unit: Zerg,
    part: BodyPartConstant,
    mineral: MineralBoostConstant,
    onDuty: boolean,
  ): boolean {
    const required = unit.creep.body.filter((p) => p.type === part && p.hits && !p.boost).length;
    if (!required) return false;
    const lab = this.colony.labs.find(
      (l) =>
        l.mineralType === mineral &&
        l.store[mineral] >= required * LAB_BOOST_MINERAL &&
        l.store.energy >= required * LAB_BOOST_ENERGY,
    );
    if (!lab) return false;
    if (!unit.pos.isNearTo(lab)) {
      if (onDuty) return false;
      unit.goTo(lab, { range: 1 });
      return true;
    }
    return lab.boostCreep(unit.creep) === OK;
  }

  run(): void {
    for (const unit of this.scouts) {
      if (!unit.spawning && !unit.safelyInRoom(warningRoom)) unit.goToRoom(warningRoom);
    }
    const front = southFront(this.colony);
    for (const unit of this.guards) {
      if (unit.spawning || this.visitBoost(unit, ATTACK, guardBoost, !!front && unit.pos.y >= 44))
        continue;
      defendSouthGate(unit, this.colony, front);
    }
    for (const unit of this.rangers) {
      if (!unit.spawning) defendSouthGate(unit, this.colony, front, 3);
    }
    for (const unit of this.menders) {
      if (unit.spawning || this.visitBoost(unit, WORK, repairBoost, !!front && unit.pos.y >= 40))
        continue;
      const wall = front || prepWall(this.colony);
      if (wall) supplyWallWorker(this.colony, unit, wall);
    }
  }
}
