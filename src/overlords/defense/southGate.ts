import type { Colony } from "../../Colony";
import { CreepSetup } from "../../creepSetups/CreepSetup";
import { Overlord } from "../Overlord";
import type { Zerg } from "../../zerg/Zerg";
import {
  defendSouthGate,
  gateEnemy,
  guardBoost,
  guardRole,
  menderRole,
  mobilized,
  needsGateRanger,
  needsGateBreaker,
  prepWall,
  repairBoost,
  rangerBoosts,
  recoverWithMenders,
  recoverGateCargo,
  needsRecoveryTruck,
  southFront,
  supplyWallWorker,
  updateSouthWatch,
  warningRoom,
} from "../../strategy/southGate";

const scout = new CreepSetup("southLookout", { pattern: [MOVE], sizeLimit: 1 });
const guard = new CreepSetup(guardRole, { pattern: [ATTACK, ATTACK, MOVE], sizeLimit: 10 });
const breaker = new CreepSetup("southBreaker", {
  pattern: [...Array<BodyPartConstant>(24).fill(ATTACK), ...Array<BodyPartConstant>(7).fill(MOVE)],
  sizeLimit: 1,
});
const breakerBoost = RESOURCE_CATALYZED_UTRIUM_ACID;
const ranger = new CreepSetup("southRanger", {
  pattern: [RANGED_ATTACK, RANGED_ATTACK, MOVE],
  sizeLimit: 5,
});
const recoveryTruck = new CreepSetup("southRecovery", {
  pattern: [CARRY, CARRY, MOVE],
  sizeLimit: 12,
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
  private breakers = this.zerg(breaker.role);
  private rangers = this.zerg(ranger.role);
  private trucks = this.zerg(recoveryTruck.role);
  private menders = this.zerg(mender.role);

  constructor(colony: Colony) {
    super(colony, "southGate", 90);
  }

  private rangerDose(unit: Zerg) {
    const amount =
      unit.creep.body.filter((p) => p.type === RANGED_ATTACK && p.hits && !p.boost).length *
      LAB_BOOST_MINERAL;
    if (!amount) return;
    const mineral = rangerBoosts.find((m) => this.colony.assets[m] >= amount);
    if (mineral) return { mineral, amount };
  }

  init(): void {
    updateSouthWatch(this.colony);
    this.wishlist(1, scout, { prespawn: 175, priority: 199 });
    for (const unit of this.rangers) {
      const dose = this.rangerDose(unit);
      if (dose) this.colony.evolutionChamber?.requestBoosts({ [dose.mineral]: dose.amount });
    }
    if (this.colony.room.energyCapacityAvailable >= 1200 && needsRecoveryTruck(this.colony))
      this.wishlist(1, recoveryTruck, { priority: 3, noLifetimeFilter: true });
    const attackPair =
      !this.colony.controller.safeMode &&
      this.colony.room.energyCapacityAvailable >= 2270 &&
      needsGateBreaker(this.colony);
    const pending = this.breakers.some((u) =>
      u.creep.body.some((p) => p.type === ATTACK && p.hits && !p.boost),
    );
    if (
      (pending || (attackPair && !this.breakers.length)) &&
      this.colony.assets[breakerBoost] >= 720
    )
      this.colony.evolutionChamber?.requestBoosts({ [breakerBoost]: 720 });
    if (attackPair && this.colony.assets[breakerBoost] >= 720)
      this.wishlist(1, breaker, { priority: 0, noLifetimeFilter: true });
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
      unit.goTo(lab, { range: 1, pathOpts: { maxRooms: 1, blockExits: true } });
      return true;
    }
    return lab.boostCreep(unit.creep) === OK;
  }

  run(): void {
    if (this.colony.memory.pauseHydralisks) {
      for (const creep of this.colony.getCreepsByRole("hydralisk")) {
        if (creep.spawning) continue;
        const spawn = creep.pos.findClosestByRange(this.colony.spawns) || this.colony.spawns[0];
        if (!spawn) continue;
        if (creep.pos.isNearTo(spawn)) spawn.recycleCreep(creep);
        else creep.moveTo(spawn, { range: 1, reusePath: 3 });
      }
    }
    for (const unit of this.scouts) {
      if (!unit.spawning && !unit.safelyInRoom(warningRoom)) unit.goToRoom(warningRoom);
    }
    const front = southFront(this.colony);
    for (const unit of this.guards) {
      if (unit.spawning || this.visitBoost(unit, ATTACK, guardBoost, !!front && unit.pos.y >= 44))
        continue;
      defendSouthGate(unit, this.colony, front);
    }
    for (const unit of this.breakers) {
      if (unit.spawning || this.visitBoost(unit, ATTACK, breakerBoost, false)) continue;
      defendSouthGate(unit, this.colony, front, 1, true);
    }
    for (const unit of this.rangers) {
      if (unit.spawning) continue;
      const dose = this.rangerDose(unit);
      if (dose && this.visitBoost(unit, RANGED_ATTACK, dose.mineral, false)) {
        const target = gateEnemy(this.colony.room);
        if (target && unit.pos.inRangeTo(target, 3)) unit.creep.rangedAttack(target);
        continue;
      }
      defendSouthGate(unit, this.colony, front, 3);
    }
    for (const unit of this.trucks) {
      if (unit.spawning) continue;
      if (!recoverGateCargo(this.colony, unit))
        unit.reassign(this.colony.overlords.logistics, "transport");
    }
    const salvagers = recoverWithMenders(this.colony, this.menders);
    for (const unit of this.menders) {
      if (salvagers.has(unit)) continue;
      if (unit.spawning || this.visitBoost(unit, WORK, repairBoost, !!front && unit.pos.y >= 40))
        continue;
      const wall = front || prepWall(this.colony);
      if (wall) supplyWallWorker(this.colony, unit, wall);
    }
  }
}
