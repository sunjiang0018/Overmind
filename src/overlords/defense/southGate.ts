import { shuttleToTerminal, stagingLoad } from "../../strategy/terminalEvacuation";
import type { Colony } from "../../Colony";
import { CreepSetup } from "../../creepSetups/CreepSetup";
import { Overlord } from "../Overlord";
import type { Zerg } from "../../zerg/Zerg";
import {
  defendSouthGate,
  gateEnemy,
  guardRole,
  menderRole,
  mobilized,
  needsGateRanger,
  needsGateBreaker,
  prepWall,
  repairBoost,
  recoverWithMenders,
  recoverGateCargo,
  needsRecoveryTruck,
  southFront,
  supplyWallWorker,
  supplyGateSpawn,
  updateSouthWatch,
  warningRoom,
} from "../../strategy/southGate";

const scout = new CreepSetup("southLookout", { pattern: [MOVE], sizeLimit: 1 });
const guard = new CreepSetup(guardRole, { pattern: [ATTACK, ATTACK, MOVE], sizeLimit: 8 });
const breaker = new CreepSetup("southBreaker", {
  pattern: [...Array<BodyPartConstant>(24).fill(ATTACK), ...Array<BodyPartConstant>(7).fill(MOVE)],
  sizeLimit: 1,
});
const breakerBoost = RESOURCE_CATALYZED_UTRIUM_ACID;
const ranger = new CreepSetup("southRanger", {
  pattern: [RANGED_ATTACK, RANGED_ATTACK, MOVE],
  sizeLimit: 5,
});
const t3Ranger = new CreepSetup("southSniper", ranger.bodySetup);
const rangedBoost = RESOURCE_CATALYZED_KEANIUM_ALKALIDE;
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
  private snipers = this.zerg(t3Ranger.role);
  private trucks = this.zerg(recoveryTruck.role);
  private menders = this.zerg(mender.role);

  constructor(colony: Colony) {
    super(colony, "southGate", 90);
  }

  private unboosted(units: Zerg[], type: BodyPartConstant): number {
    return units.reduce(
      (amount, u) =>
        amount +
        u.creep.body.filter((p) => p.type === type && p.hits && !p.boost).length *
          LAB_BOOST_MINERAL,
      0,
    );
  }

  init(): void {
    updateSouthWatch(this.colony);
    this.wishlist(1, scout, { prespawn: 175, priority: 199 });
    if (
      this.colony.room.energyCapacityAvailable >= 1200 &&
      (needsRecoveryTruck(this.colony) ||
        (this.colony.memory.terminalEvacuation &&
          stagingLoad(this.colony, 1200) &&
          !this.colony.overlords.logistics.transporters.length))
    )
      this.wishlist(1, recoveryTruck, { priority: 3, noLifetimeFilter: true });
    const attackPair =
      !this.colony.controller.safeMode &&
      this.colony.room.energyCapacityAvailable >= 2270 &&
      needsGateBreaker(this.colony);
    const fighting = mobilized(this.colony);
    const pendingGuard = this.unboosted(this.guards, ATTACK);
    const pendingBreaker = this.unboosted(this.breakers, ATTACK);
    const fundBreaker = attackPair && !this.breakers.length;
    const reserved = pendingGuard + pendingBreaker + (fundBreaker ? 720 : 0);
    const fundGuard =
      fighting && !this.guards.length && this.colony.room.energyCapacityAvailable >= 1680;
    const available = this.colony.assets[breakerBoost] || 0;
    const meleeOrder = Math.min(available, reserved + (fundGuard ? 480 : 0));
    if (meleeOrder) this.colony.evolutionChamber?.requestBoosts({ [breakerBoost]: meleeOrder });
    if (fundBreaker && available >= reserved)
      this.wishlist(1, breaker, { priority: 0, noLifetimeFilter: true });
    if (fundGuard && available >= reserved + 480)
      this.wishlist(1, guard, { priority: 1, noLifetimeFilter: true });
    const rangedPending = this.unboosted([...this.rangers, ...this.snipers], RANGED_ATTACK);
    const fundSniper =
      !this.snipers.length &&
      this.colony.room.energyCapacityAvailable >= 1750 &&
      (this.colony.memory.orderSouthSniper || (fighting && needsGateRanger(this.colony)));
    const rangedOrder = rangedPending + (fundSniper ? 300 : 0);
    if (rangedOrder && this.colony.assets[rangedBoost] >= rangedOrder) {
      this.colony.evolutionChamber?.requestBoosts({ [rangedBoost]: rangedOrder });
      if (fundSniper) this.wishlist(1, t3Ranger, { priority: 2, noLifetimeFilter: true });
    }
    if (this.snipers.some((u) => !u.spawning && !this.unboosted([u], RANGED_ATTACK)))
      delete this.colony.memory.orderSouthSniper;
    if (!fighting) return;
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
      if (unit.spawning || this.visitBoost(unit, ATTACK, breakerBoost, false)) continue;
      if (this.unboosted([unit], ATTACK)) continue;
      defendSouthGate(
        unit,
        this.colony,
        front,
        1,
        this.breakers.some((b) => !b.spawning),
      );
    }
    for (const unit of this.breakers) {
      if (unit.spawning || this.visitBoost(unit, ATTACK, breakerBoost, false)) continue;
      if (this.unboosted([unit], ATTACK)) continue;
      defendSouthGate(unit, this.colony, front, 1, true);
    }
    for (const unit of [...this.rangers, ...this.snipers]) {
      if (unit.spawning) continue;
      if (this.visitBoost(unit, RANGED_ATTACK, rangedBoost, false)) {
        const target = gateEnemy(this.colony.room);
        if (target && unit.pos.inRangeTo(target, 3)) unit.creep.rangedAttack(target);
        continue;
      }
      if (this.unboosted([unit], RANGED_ATTACK) && this.snipers.includes(unit)) continue;
      defendSouthGate(unit, this.colony, front, 3);
    }
    for (const unit of this.trucks) {
      if (unit.spawning) continue;
      const waitingBreaker = !this.breakers.length && this.colony.assets[breakerBoost] >= 720;
      const waitingGuard =
        this.breakers.length > 0 &&
        !this.guards.some((u) => u.spawning || (u.ticksToLive ?? 0) > 145);
      const waitingSniper =
        !this.snipers.length &&
        this.colony.memory.orderSouthSniper &&
        this.colony.assets[rangedBoost] >= 300;
      if (
        waitingSniper &&
        this.colony.room.energyAvailable < 1750 &&
        supplyGateSpawn(this.colony, unit)
      )
        continue;
      if (
        (waitingBreaker || waitingGuard) &&
        !this.colony.controller.safeMode &&
        needsGateBreaker(this.colony) &&
        this.colony.room.energyAvailable < (waitingBreaker ? 2270 : 1680) &&
        supplyGateSpawn(this.colony, unit)
      )
        continue;
      // During the siege, menders still collect at the wall while the large truck stages warehouse stock.
      if (this.colony.memory.terminalEvacuation && shuttleToTerminal(this.colony, unit)) continue;
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
