import type { Colony } from "../../Colony";
import { CreepSetup } from "../../creepSetups/CreepSetup";
import { Roles } from "../../creepSetups/setups";
import type { DirectiveColonySupport } from "../../directives/colony/support";
import { getRoomDangerousPlayerHostiles, getRoomPlayerHostiles } from "../../game/Room";
import { log } from "../../console/log";
import { NotifierPriority } from "../../directives/Notifier";
import { getRoomContainers, getRoomRamparts } from "../../game/RoomStructures";
import { CombatIntel } from "../../intel/CombatIntel";
import { profile } from "../../profiler/decorator";
import { Movement } from "../../movement/Movement";
import {
  colonyCriticalRamparts,
  colonyRampartTarget,
  hasColonySupportCapacity,
  colonyDefenseTarget,
  isControllerRampartDeferred,
  isSouthDefenseActive,
} from "../../strategy/colonyDefense";
import { minBy } from "../../utilities/utils";
import { CombatZerg } from "../../zerg/CombatZerg";
import { Zerg } from "../../zerg/Zerg";
import { Overlord } from "../Overlord";

const builderSetup = new CreepSetup("colonyBuilder", {
  pattern: [WORK, CARRY, MOVE, MOVE],
  sizeLimit: 9,
});
const haulerSetup = new CreepSetup("colonyHauler", {
  pattern: [CARRY, MOVE],
  sizeLimit: 20,
});
const warningScoutSetup = new CreepSetup(Roles.scout, { pattern: [MOVE], sizeLimit: 1 });
const guardSetup = new CreepSetup(
  "colonyGuard",
  {
    pattern: [RANGED_ATTACK, RANGED_ATTACK, MOVE],
    sizeLimit: 5,
  },
  ["move", "ranged"],
);

@profile
export class ColonySupportOverlord extends Overlord {
  directive: DirectiveColonySupport;
  builders: Zerg[];
  haulers: Zerg[];
  guards: CombatZerg[];
  scouts: Zerg[];

  constructor(directive: DirectiveColonySupport) {
    // Below all parent economy and outpost replacement priorities.
    super(directive, "support", 950);
    this.directive = directive;
    this.builders = this.zerg("colonyBuilder");
    this.haulers = this.zerg("colonyHauler");
    this.guards = this.combatZerg("colonyGuard");
    this.scouts = this.zerg(Roles.scout, { notifyWhenAttacked: false });
  }

  private get child(): Colony | undefined {
    return Overmind.colonies[this.pos.roomName];
  }

  private get reserve(): number {
    return Math.max(50000, this.directive.memory.reserve ?? 150000);
  }

  private canSupport(): boolean {
    return hasColonySupportCapacity({
      energy: (this.colony.storage?.store.energy || 0) + (this.colony.terminal?.store.energy || 0),
      reserve: this.reserve,
      bootstrapping: !!this.colony.state.bootstrapping,
      threatened:
        getRoomDangerousPlayerHostiles(this.colony.room).length > 0 || this.colony.defcon > 0,
      hasQueen: this.colony.getCreepsByRole(Roles.queen).some((c) => !c.spawning),
      hasMiners:
        this.colony
          .getCreepsByRole(Roles.drone)
          .filter((c) => c.room.name == this.colony.name && !c.spawning).length >=
        this.colony.room.find(FIND_SOURCES).length,
      bucket: Game.cpu.bucket,
    });
  }

  init() {
    const child = this.child;
    // Native haulers can supply aid workers too; they must not be invisible to local logistics.
    if (child?.controller.my) {
      for (const builder of this.builders) {
        if (
          !builder.spawning &&
          builder.room.name == child.name &&
          builder.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        ) {
          child.logisticsNetwork.requestInput(builder, {
            resourceType: RESOURCE_ENERGY,
            dAmountdt: builder.getActiveBodyparts(WORK),
            multiplier: 2,
          });
        }
      }
    }
    const allowed = this.canSupport();
    this.directive.memory.status = {
      tick: Game.time,
      allowed,
      reserve: this.reserve,
      parentEnergy: this.colony.assets.energy,
      builders: this.builders.length,
      haulers: this.haulers.length,
      guards: this.guards.length,
      scouts: this.scouts.length,
      southDefense: !child?.controller.my
        ? "waiting-recolonization"
        : isSouthDefenseActive(child)
          ? "mobilized"
          : child?.memory.colonyDefense?.southDefenseSchedule?.safeModeSeenAt !== undefined
            ? "waiting-safe-mode-expiry"
            : child?.memory.colonyDefense?.southDefenseSchedule?.attackSeenAt !== undefined
              ? "waiting-safe-mode"
              : "waiting-attack",
    };
    if (allowed && this.directive.memory.warningRoom) {
      this.wishlist(1, warningScoutSetup, { priority: 946, spawnOneAtATime: true });
    }
    if (!child?.controller.my || !allowed) return;
    const developing = child.level < (this.directive.memory.targetRCL ?? 6);
    const builders = developing
      ? Math.min(this.directive.memory.maxBuilders ?? 4, this.haulers.length ? 4 : 2)
      : 2;
    this.wishlist(builders, builderSetup, {
      spawnOneAtATime: true,
      priority:
        this.lifetimeFilter(this.builders).reduce(
          (power, b) => power + b.getActiveBodyparts(WORK),
          0,
        ) < 9
          ? 947
          : 950,
    });
    if (this.builders.length > 0 && developing) {
      this.wishlist(this.directive.memory.maxHaulers ?? 3, haulerSetup, {
        spawnOneAtATime: true,
        priority: this.lifetimeFilter(this.haulers).length == 0 ? 948 : 951,
      });
    }
    // Shielded sentinels concentrate fire; boosted bodies reduce spawn demand.
    if (child.level >= 2 && isSouthDefenseActive(child)) {
      const minimumTowerDamage =
        child.towers.filter((t) => t.isActive() && t.store.energy >= 500).length * 150;
      const needed = Math.max(
        100,
        ((child.memory.colonyDefense?.referenceHealing || 132) + 12) / 0.3 - minimumTowerDamage,
      );
      let damage = 0;
      for (const guard of this.guards) {
        damage += CombatIntel.getRangedAttackDamage(guard.creep);
        if (guard.needsBoosts) {
          // Pending boosts are not counted until they are actually applied.
          continue;
        }
      }
      this.directive.memory.status.guardDamage = damage;
      this.directive.memory.status.requiredGuardDamage = needed;
      if (
        (damage < needed || this.guards.length < (this.directive.memory.minGuards || 0)) &&
        this.guards.length < (this.directive.memory.maxGuards ?? 5)
      ) {
        // One unboosted/spawning unit at a time avoids queuing an excessive army while labs fill.
        if (!this.guards.some((g) => g.spawning || g.needsBoosts))
          this.requestCreep(guardSetup, { priority: 949 });
      }
    }
  }

  private maintainSites(child: Colony) {
    if (child.level < 2 || Game.time % 5 != 0) return;
    for (const site of child.room.find(FIND_MY_CONSTRUCTION_SITES)) {
      if (site.structureType == STRUCTURE_RAMPART && isControllerRampartDeferred(child, site.pos))
        site.remove();
    }
    if (!isSouthDefenseActive(child)) return;
    let budget = Math.min(4, 10 - child.room.find(FIND_MY_CONSTRUCTION_SITES).length);
    for (const pos of colonyCriticalRamparts(child)) {
      if (budget <= 0) break;
      const rampart = pos
        .lookFor(LOOK_STRUCTURES)
        .find((s) => s.structureType == STRUCTURE_RAMPART) as StructureRampart | undefined;
      if (rampart) {
        if (rampart.isPublic) rampart.setPublic(false);
      } else if (
        !pos.lookFor(LOOK_CONSTRUCTION_SITES).length &&
        pos.createConstructionSite(STRUCTURE_RAMPART) == OK
      )
        budget--;
    }
  }

  private withdrawFromParent(unit: Zerg): boolean {
    if (!this.canSupport()) return false;
    const parentEnergy =
      (this.colony.storage?.store.energy || 0) + (this.colony.terminal?.store.energy || 0);
    const amount = Math.min(
      unit.store.getFreeCapacity(RESOURCE_ENERGY),
      parentEnergy - this.reserve,
    );
    const source = [this.colony.storage, this.colony.terminal].find((s) => s && s.store.energy > 0);
    if (source && amount > 0) {
      if (
        unit.creep.withdraw(source, RESOURCE_ENERGY, Math.min(amount, source.store.energy)) ==
        ERR_NOT_IN_RANGE
      )
        unit.goTo(source);
      return true;
    }
    return false;
  }

  private act(unit: Zerg, target: RoomObject, action: () => number, range: number) {
    if (action() == ERR_NOT_IN_RANGE) unit.goTo(target, { range });
  }

  private recharge(builder: Zerg) {
    const containers = getRoomContainers(builder.room).filter((s) => s.store.energy > 0);
    const source = builder.pos.findClosestByRange([
      ...containers,
      ...[builder.room.storage, builder.room.terminal].filter(
        (s): s is StructureStorage | StructureTerminal => !!s && s.store.energy > 0,
      ),
    ]);
    if (source) {
      this.act(builder, source, () => builder.creep.withdraw(source, RESOURCE_ENERGY), 1);
      return;
    }
    const drop = builder.pos.findClosestByRange(
      builder.room.find(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType == RESOURCE_ENERGY && r.amount > 20,
      }),
    );
    if (drop) {
      this.act(builder, drop, () => builder.creep.pickup(drop), 1);
      return;
    }
    const sourceToHarvest = builder.pos.findClosestByRange(builder.room.find(FIND_SOURCES_ACTIVE));
    if (sourceToHarvest)
      this.act(builder, sourceToHarvest, () => builder.creep.harvest(sourceToHarvest), 1);
  }

  private handleBuilder(builder: Zerg, child: Colony, index: number) {
    if (builder.spawning) return;
    const mobilized = isSouthDefenseActive(child);
    if (mobilized) builder.task = null;
    if (builder.room.name == this.colony.name && builder.store.energy < builder.carryCapacity) {
      if (this.withdrawFromParent(builder)) return;
    }
    if (!builder.safelyInRoom(child.name)) {
      builder.goToRoom(child.name, { pathOpts: { avoidSK: true } });
      return;
    }
    if (!mobilized) {
      child.overlords.work.runSupportWorker(builder);
      return;
    }
    const enemies = getRoomDangerousPlayerHostiles(child.room);
    // A repairer beneath a private shield must keep repairing instead of abandoning it.
    if (!builder.inRampart && builder.flee()) return;
    if (!builder.store.energy) {
      this.recharge(builder);
      return;
    }
    const controller = child.controller;
    const upgrade = () =>
      this.act(builder, controller, () => builder.creep.upgradeController(controller), 3);
    if (
      !controller.upgradeBlocked &&
      (child.level < 2 || controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[child.level] * 0.75)
    ) {
      upgrade();
      return;
    }
    const critical = colonyCriticalRamparts(child);
    const ramparts = getRoomRamparts(child.room).filter(
      (r) => r.my && critical.some((p) => p.isEqualTo(r.pos)),
    );
    const targetHits = colonyRampartTarget(child);
    const threatened = ramparts.filter(
      (r) => enemies.some((c) => c.pos.getRangeTo(r) <= 3) && r.hits < targetHits,
    );
    const emergency = minBy(threatened, (r) => r.hits);
    if (emergency) {
      this.act(builder, emergency, () => builder.creep.repair(emergency), 3);
      return;
    }
    const fragile = minBy(
      ramparts.filter((r) => r.hits < Math.min(5000, targetHits)),
      (r) => r.hits,
    );
    if (fragile) {
      this.act(builder, fragile, () => builder.creep.repair(fragile), 3);
      return;
    }
    const sites = child.room.find(FIND_MY_CONSTRUCTION_SITES);
    const rank = (s: ConstructionSite) => {
      if (s.structureType == STRUCTURE_SPAWN) return 0;
      if (s.structureType == STRUCTURE_TOWER) return 1;
      const southernPriority =
        child.memory.colonyDefense?.priorityRamparts?.findIndex(
          (p) => p.x == s.pos.x && p.y == s.pos.y,
        ) ?? -1;
      if (s.structureType == STRUCTURE_RAMPART && southernPriority >= 0)
        return 2 + southernPriority / 100;
      if (s.structureType == STRUCTURE_RAMPART && critical.some((p) => p.isEqualTo(s.pos)))
        return 3;
      if (s.structureType == STRUCTURE_CONTAINER) return 4;
      if (s.structureType == STRUCTURE_EXTENSION) return 5;
      if (s.structureType == STRUCTURE_STORAGE) return 6;
      return 10;
    };
    const site = minBy(sites, (s) => rank(s) * 100 + builder.pos.getRangeTo(s));
    if (site && rank(site) < 10) {
      this.act(builder, site, () => builder.creep.build(site), 3);
      return;
    }
    // Scheduled mobilization commits all aid builders; legacy rooms retain the split workload.
    const fortify = minBy(
      ramparts.filter((r) => r.hits < targetHits),
      (r) => r.hits,
    );
    if (
      fortify &&
      (child.memory.colonyDefense?.southDefenseSchedule ||
        (this.builders.length > 1 && index % 2 == 0))
    ) {
      this.act(builder, fortify, () => builder.creep.repair(fortify), 3);
    } else if (!controller.upgradeBlocked && child.level < (this.directive.memory.targetRCL ?? 6)) {
      upgrade();
    } else if (site) {
      this.act(builder, site, () => builder.creep.build(site), 3);
    }
  }

  private handleHauler(hauler: Zerg, child: Colony) {
    if (hauler.spawning) return;
    hauler.task = null;
    if (hauler.flee()) return;
    if (!hauler.store.energy) {
      if (!hauler.safelyInRoom(this.colony.name))
        hauler.goToRoom(this.colony.name, { pathOpts: { avoidSK: true } });
      else if (!this.withdrawFromParent(hauler)) hauler.park();
      return;
    }
    if (!hauler.safelyInRoom(child.name)) {
      hauler.goToRoom(child.name, { pathOpts: { avoidSK: true } });
      return;
    }
    const tower = minBy(
      child.towers.filter((t) => t.store.energy < 750),
      (t) => t.store.energy,
    );
    if (tower) {
      this.act(hauler, tower, () => hauler.creep.transfer(tower, RESOURCE_ENERGY), 1);
      return;
    }
    const builder = minBy(
      this.builders.filter(
        (b) =>
          b.room.name == child.name &&
          !b.spawning &&
          b.store.getFreeCapacity(RESOURCE_ENERGY) >= 50,
      ),
      (b) => b.store.energy + hauler.pos.getRangeTo(b) * 2,
    );
    if (builder) {
      this.act(
        hauler,
        builder.creep,
        () => hauler.creep.transfer(builder.creep, RESOURCE_ENERGY),
        1,
      );
      return;
    }
    const spawn = child.spawns.find((s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    const buffer =
      getRoomContainers(child.room).find(
        (s) =>
          s.pos.getRangeTo(child.controller) <= 3 && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      ) ||
      child.storage ||
      getRoomContainers(child.room).find((s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    const target = spawn || buffer;
    if (target && target.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      this.act(hauler, target, () => hauler.creep.transfer(target, RESOURCE_ENERGY), 1);
    } else hauler.goTo(child.controller, { range: 3 });
  }

  private handleGuard(guard: CombatZerg, child: Colony, occupied: Set<string>, index = 0) {
    if (guard.spawning) return;
    if (guard.hasValidTask) {
      guard.run();
      return;
    }
    if (guard.needsBoosts && guard.room.name == this.colony.name) {
      this.handleBoosting(guard);
      guard.run();
      return;
    }
    if (!guard.safelyInRoom(child.name)) {
      guard.goToRoom(child.name, { pathOpts: { avoidSK: true } });
      return;
    }
    // All sentinels use one deterministic target instead of splitting damage across healers.
    const target = colonyDefenseTarget(child);
    const fireTarget =
      target && guard.pos.getRangeTo(target) <= 3
        ? target
        : colonyDefenseTarget(
            child,
            getRoomPlayerHostiles(child.room).filter((c) => guard.pos.getRangeTo(c) <= 3),
          );
    if (fireTarget) guard.rangedAttack(fireTarget);
    const anchors = this.directive.memory.defenseAnchors;
    const anchor = anchors?.length
      ? new RoomPosition(
          anchors[index % anchors.length].x,
          anchors[index % anchors.length].y,
          child.name,
        )
      : child.controller.pos;
    const shields = getRoomRamparts(child.room).filter(
      (r) =>
        r.my &&
        !r.isPublic &&
        r.hits >= 10000 &&
        !occupied.has(`${r.pos.x}:${r.pos.y}`) &&
        !r.pos.lookFor(LOOK_CREEPS).some((c) => c.name != guard.name),
    );
    const shield = minBy(shields, (r) =>
      target
        ? Math.max(0, r.pos.getRangeTo(target) - 3) * 100 + guard.pos.getRangeTo(r)
        : r.pos.getRangeTo(anchor) * 10 + guard.pos.getRangeTo(r),
    );
    if (shield) {
      occupied.add(`${shield.pos.x}:${shield.pos.y}`);
      if (guard.inRampart && target) {
        delete guard.memory._go;
        Movement.combatMove(guard, [{ pos: shield.pos, range: 0 }], [], {
          requireRamparts: true,
          preferRamparts: true,
        });
      } else if (!target || !guard.flee()) guard.goTo(shield, { range: 0 });
    } else if (!guard.inRampart) {
      if (!guard.flee()) guard.goTo(anchor, { range: 3 });
    }
  }

  run() {
    this.runEarlyWarning();
    const child = this.child;
    if (!child?.controller.my) {
      for (const unit of [...this.builders, ...this.haulers, ...this.guards]) {
        if (!unit.spawning) unit.goToRoom(this.colony.name);
      }
      return;
    }
    this.maintainSites(child);
    this.builders.forEach((b, i) => this.handleBuilder(b, child, i));
    this.haulers.forEach((h) => this.handleHauler(h, child));
    const occupied = new Set<string>();
    this.guards.forEach((g, i) => this.handleGuard(g, child, occupied, i));
  }

  private runEarlyWarning() {
    const name = this.directive.memory.warningRoom;
    if (!name) return;
    const room = Game.rooms[name];
    const previous = this.directive.memory.warning;
    if (room) {
      const hostiles = getRoomPlayerHostiles(room)
        .map((c) => `${c.owner.username}/${c.name}`)
        .sort();
      this.directive.memory.warning = { room: name, tick: Game.time, visible: true, hostiles };
      const key = hostiles.join(",");
      if (hostiles.length) {
        this.directive.alert(`South warning ${name}: ${key}`, NotifierPriority.Critical);
        if (
          key != this.directive.memory.lastWarningKey ||
          Game.time - (this.directive.memory.lastWarningTick || 0) >= 100
        ) {
          log.notify(`South warning for ${this.pos.roomName}: ${name} ${key}`);
          this.directive.memory.lastWarningKey = key;
          this.directive.memory.lastWarningTick = Game.time;
        }
      } else this.directive.memory.lastWarningKey = "";
    } else {
      this.directive.memory.warning = {
        room: name,
        tick: previous?.tick || Game.time,
        visible: false,
        hostiles: previous?.hostiles || [],
      };
      if (previous?.visible)
        log.notify(`South warning vision lost: ${name}, protecting ${this.pos.roomName}`);
    }
    for (const scout of this.scouts) {
      if (scout.spawning) continue;
      scout.task = null;
      if (!scout.safelyInRoom(name)) scout.goToRoom(name, { pathOpts: { avoidSK: true } });
      else if (!scout.flee()) {
        const pos = this.directive.memory.warningPos || { x: 28, y: 3 };
        scout.goTo(new RoomPosition(pos.x, pos.y, name), { range: 0 });
      }
    }
  }
}
