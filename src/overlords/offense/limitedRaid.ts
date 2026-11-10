import { CreepSetup } from "../../creepSetups/CreepSetup";
import type { DirectiveLimitedRaid } from "../../directives/offense/limitedRaid";
import { log } from "../../console/log";
import {
  RAID_ROLES,
  type LimitedRaidMemory,
  type RaidRole,
  raidBody,
  raidCommitted,
  raidHasRole,
  raidMilitary,
  reconcileRaidSpawns,
  reserveRaidSpawn,
  settleRaidSpawn,
  stopRaid,
} from "../../strategy/limitedRaid";
import type { Zerg } from "../../zerg/Zerg";
import { Overlord } from "../Overlord";

const roleName = (role: RaidRole) => `raid_${role}`;
const position = (pos: ProtoPos) => new RoomPosition(pos.x, pos.y, pos.roomName);

/** Five unboosted, single-issue units; no lifetime replacement or idle-unit adoption. */
export class LimitedRaidOverlord extends Overlord {
  declare memory: LimitedRaidMemory;
  directive: DirectiveLimitedRaid;
  private groups: { [role in RaidRole]: Zerg[] };

  constructor(directive: DirectiveLimitedRaid) {
    // Protect queens, local economy and outpost defense; precede upgrades and remote expansion.
    super(directive, "raid", 590);
    this.directive = directive;
    this.groups = Object.fromEntries(
      RAID_ROLES.map((role) => [role, this.zerg(roleName(role))]),
    ) as {
      [role in RaidRole]: Zerg[];
    };
  }

  private get units(): Zerg[] {
    return RAID_ROLES.flatMap((role) => this.groups[role]);
  }

  private unit(role: RaidRole): Zerg | undefined {
    return this.groups[role][0];
  }

  private hostiles(room: Room): Creep[] {
    return room
      .find(FIND_HOSTILE_CREEPS)
      .filter((creep) => !Memory.settings.allies.includes(creep.owner.username));
  }

  private structures(): Structure[] {
    return Game.rooms[this.memory.target]?.find(FIND_STRUCTURES) || [];
  }

  private towers(): StructureTower[] {
    return this.structures().filter(
      (structure): structure is StructureTower => structure.structureType === STRUCTURE_TOWER,
    );
  }

  private cold(): boolean {
    return (
      this.memory.lastSeen === Game.time &&
      this.memory.towerEnergy === 0 &&
      this.memory.coldSince !== undefined &&
      Game.time - this.memory.coldSince >= 5
    );
  }

  private checkSafety(): void {
    const memory = this.memory;
    if (memory.phase === "retreating" || memory.phase === "complete") return;
    if (
      memory.version !== 1 ||
      memory.route[0] !== this.colony.name ||
      memory.route.at(-1) !== memory.target ||
      memory.entry.roomName !== memory.target ||
      memory.staging.roomName !== memory.route.at(-2) ||
      memory.target === this.colony.name
    ) {
      stopRaid(memory, "invalid raid configuration");
      return;
    }
    if (Game.time >= memory.deadline) stopRaid(memory, "first-wave deadline");
    for (const roomName of memory.route) {
      const room = Game.rooms[roomName];
      if (!room) continue;
      if (roomName === memory.target && room.controller?.safeMode) {
        stopRaid(memory, "enemy safe mode");
        return;
      }
      const reinforcement = this.hostiles(room).find((creep) =>
        raidMilitary(creep, roomName === memory.target),
      );
      const powerReinforcement = room
        .find(FIND_HOSTILE_POWER_CREEPS)
        .find((creep) => !Memory.settings.allies.includes(creep.owner.username));
      if (reinforcement || powerReinforcement) {
        stopRaid(
          memory,
          `enemy reinforcement in ${roomName}: ${(reinforcement || powerReinforcement)!.name}`,
        );
        return;
      }
    }
    for (const unit of this.units) {
      if (!unit.spawning && (unit.ticksToLive || CREEP_LIFE_TIME) < 250)
        stopRaid(memory, "lifetime reserve for withdrawal");
    }
    const room = Game.rooms[memory.target];
    if (!room) {
      delete memory.coldSince;
      return;
    }
    if (room.controller?.owner?.username !== memory.owner) {
      stopRaid(memory, "target ownership changed");
      return;
    }
    const previousSeen = memory.lastSeen;
    memory.lastSeen = Game.time;
    memory.towerEnergy = this.towers().reduce((sum, tower) => sum + tower.store.energy, 0);
    if (memory.minimumTowerEnergy === undefined || memory.towerEnergy < memory.minimumTowerEnergy) {
      memory.minimumTowerEnergy = memory.towerEnergy;
      memory.lastProgress = Game.time;
    }
    if (memory.towerEnergy === 0) {
      if (
        memory.coldSince === undefined ||
        (previousSeen !== Game.time && previousSeen !== Game.time - 1)
      )
        memory.coldSince = Game.time;
    } else {
      delete memory.coldSince;
      if (memory.phase === "breaching" || memory.phase === "looting") memory.phase = "draining";
    }
    if (
      memory.drainStarted &&
      Game.time - (memory.lastProgress || memory.drainStarted) > 400 &&
      memory.phase === "draining"
    )
      stopRaid(memory, "no sustained drain progress");
    if (this.cold() && memory.phase === "draining") memory.phase = "breaching";
    if (
      this.cold() &&
      memory.phase === "breaching" &&
      !this.structures().some(
        (structure) =>
          structure.structureType === STRUCTURE_TOWER ||
          structure.structureType === STRUCTURE_SPAWN,
      )
    )
      memory.phase = "looting";
  }

  private canRecruit(): boolean {
    return (
      this.memory.phase !== "retreating" &&
      this.memory.phase !== "complete" &&
      !this.memory.stopReason &&
      !this.colony.state.bootstrapping &&
      this.colony.defcon === 0 &&
      (this.colony.storage?.store.energy || 0) + (this.colony.terminal?.store.energy || 0) >=
        150000 &&
      Game.cpu.bucket >= 100
    );
  }

  private withdrawing(): boolean {
    return this.memory.phase === "retreating";
  }

  private roleAllowed(role: RaidRole): boolean {
    return role === "breaker"
      ? this.cold()
      : role === "hauler"
        ? this.cold() && this.memory.phase === "looting"
        : true;
  }

  init(): void {
    reconcileRaidSpawns(this.memory);
    this.checkSafety();
    if (!this.canRecruit()) return;
    const role = RAID_ROLES.find(
      (candidate) => !raidHasRole(this.memory, candidate) && this.roleAllowed(candidate),
    );
    if (!role) return;
    const setup = new CreepSetup(roleName(role), {
      pattern: raidBody(role),
      sizeLimit: 1,
      ordered: false,
    });
    // Always bind to this colony's hatchery; no distributed spawning or market boost acquisition.
    this.colony.hatchery?.enqueue({
      setup,
      overlord: this,
      priority: this.priority,
      options: {
        beforeSpawn: (creep) => {
          this.checkSafety();
          return (
            this.canRecruit() &&
            this.roleAllowed(role) &&
            reserveRaidSpawn(this.memory, role, creep)
          );
        },
        onSpawnResult: (creep, result) => settleRaidSpawn(this.memory, creep.name, result),
      },
    });
  }

  private move(unit: Zerg, destination: RoomPosition, range = 0): void {
    const allowed = this.memory.route;
    const route =
      unit.pos.roomName === destination.roomName
        ? undefined
        : Game.map.findRoute(unit.pos.roomName, destination.roomName, {
            routeCallback: (room) => (allowed.includes(room) ? 1 : Infinity),
          });
    if (route === ERR_NO_PATH) {
      stopRaid(this.memory, "withdrawal route unavailable");
      return;
    }
    unit.task = null;
    unit.goTo(destination, {
      range,
      pathOpts: {
        route,
        maxRooms: allowed.length,
        allowHostile: true,
        allowPortals: false,
        avoidSK: true,
      },
    });
  }

  private stage(unit: Zerg, offset = 0): void {
    const p = this.memory.staging;
    this.move(unit, new RoomPosition(p.x + offset, p.y, p.roomName));
  }

  private heal(medic: Zerg): void {
    const patient = [medic, ...this.units]
      .filter(
        (unit) =>
          !unit.spawning && unit.pos.roomName === medic.pos.roomName && unit.hits < unit.hitsMax,
      )
      .sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax)[0];
    if (!patient) return;
    if (medic.pos.isNearTo(patient)) medic.creep.heal(patient.creep);
    else if (medic.pos.inRangeTo(patient, 3)) medic.creep.rangedHeal(patient.creep);
  }

  private shield(target: Structure): Structure {
    return (
      this.structures().find(
        (structure) =>
          structure.structureType === STRUCTURE_RAMPART && structure.pos.isEqualTo(target.pos),
      ) || target
    );
  }

  private demolitionTarget(unit: Zerg): Structure | undefined {
    const structures = this.structures();
    const gate = structures.find(
      (structure) =>
        (structure.structureType === STRUCTURE_RAMPART ||
          structure.structureType === STRUCTURE_WALL) &&
        structure.pos.x === this.memory.entry.x - 1 &&
        structure.pos.y === this.memory.entry.y,
    );
    if (gate) return gate;
    for (const type of [STRUCTURE_TOWER, STRUCTURE_SPAWN]) {
      const targets = structures.filter((structure) => structure.structureType === type);
      const target = unit.pos.findClosestByRange(targets) || targets[0];
      if (target) return this.shield(target);
    }
    for (const type of [STRUCTURE_TERMINAL, STRUCTURE_STORAGE]) {
      const store = structures.find((structure) => structure.structureType === type);
      if (store && this.shield(store) !== store) return this.shield(store);
    }
    return undefined;
  }

  private runTank(tank: Zerg): void {
    const medic = this.unit("medic");
    if (tank.pos.roomName === this.memory.target) {
      if (this.memory.phase === "draining" || this.memory.phase === "assembling") {
        this.memory.tankEntered ??= Game.time;
        const gate = this.demolitionTarget(tank);
        if (gate && tank.pos.isNearTo(gate)) tank.creep.attack(gate);
        if (
          tank.hits < tank.hitsMax ||
          (this.memory.towerEnergy !== 0 && Game.time > this.memory.tankEntered)
        ) {
          this.memory.tankRecovering = true;
          delete tank.memory._go;
          this.stage(tank);
        } else this.move(tank, position(this.memory.entry));
      } else {
        const target = this.demolitionTarget(tank);
        if (target) {
          if (tank.pos.isNearTo(target)) tank.creep.attack(target);
          else this.move(tank, target.pos, 1);
        }
      }
      return;
    }
    delete this.memory.tankEntered;
    if (
      tank.hits < tank.hitsMax ||
      !medic ||
      medic.spawning ||
      medic.pos.roomName !== this.memory.staging.roomName ||
      medic.hits < medic.hitsMax ||
      !this.unit("interceptor") ||
      this.unit("interceptor")!.spawning ||
      this.unit("interceptor")!.pos.roomName !== this.memory.staging.roomName
    ) {
      this.stage(tank);
      return;
    }
    this.memory.tankRecovering = false;
    if (this.memory.phase === "assembling") {
      this.memory.phase = "draining";
      this.memory.drainStarted = Game.time;
      this.memory.lastProgress = Game.time;
    }
    this.move(tank, position(this.memory.entry));
  }

  private runMedic(medic: Zerg): void {
    this.heal(medic);
    if (this.cold() && (this.memory.phase === "breaching" || this.memory.phase === "looting")) {
      const patient = this.unit("breaker") || this.unit("tank");
      if (patient && !patient.spawning) this.move(medic, patient.pos, 1);
      else this.stage(medic, 1);
    } else if (medic.pos.roomName === this.memory.staging.roomName) {
      const tank = this.unit("tank");
      if (tank && tank.pos.roomName === medic.pos.roomName && tank.hits < tank.hitsMax)
        this.move(medic, tank.pos, 1);
      else this.stage(medic, 1);
    } else this.stage(medic, 1);
  }

  private runInterceptor(unit: Zerg): void {
    this.heal(unit);
    if (unit.pos.roomName === this.memory.target && !this.cold()) {
      this.stage(unit, 2);
      return;
    }
    if (
      unit.pos.roomName !== this.memory.staging.roomName &&
      unit.pos.roomName !== this.memory.target
    ) {
      this.stage(unit, 2);
      return;
    }
    const supply = unit.pos.findClosestByRange(
      this.hostiles(unit.room).filter((creep) => creep.owner.username === this.memory.owner),
    );
    if (
      supply &&
      !supply.pos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType === STRUCTURE_RAMPART)
    ) {
      if (unit.pos.inRangeTo(supply, 3)) unit.creep.rangedAttack(supply);
      else this.move(unit, supply.pos, 3);
    } else if (this.cold()) {
      const target = this.demolitionTarget(unit);
      if (target) {
        if (unit.pos.inRangeTo(target, 3)) unit.creep.rangedAttack(target);
        else this.move(unit, target.pos, 3);
      } else this.stage(unit, 2);
    } else this.stage(unit, 2);
  }

  private runBreaker(unit: Zerg): void {
    if (!this.cold()) {
      this.stage(unit, 3);
      return;
    }
    const target = this.demolitionTarget(unit);
    if (!target) {
      this.stage(unit, 3);
      return;
    }
    if (this.memory.targetHits?.id !== target.id || target.hits < this.memory.targetHits.hits)
      this.memory.lastProgress = Game.time;
    this.memory.targetHits = { id: target.id, hits: target.hits };
    if (unit.creep.dismantle(target) === ERR_NOT_IN_RANGE) this.move(unit, target.pos, 1);
  }

  private unload(unit: Zerg): boolean {
    const resources = Object.keys(unit.store).filter(
      (resource) => unit.store[resource as ResourceConstant] > 0,
    ) as ResourceConstant[];
    if (!resources.length) return true;
    const resource = resources[0];
    const destination = [this.colony.storage, this.colony.terminal].find(
      (store) => store && store.store.getFreeCapacity(resource) > 0,
    );
    if (!destination) return false;
    const amount = Math.min(unit.store[resource], destination.store.getFreeCapacity(resource));
    if (unit.creep.transfer(destination, resource, amount) === OK) {
      this.memory.delivered ??= {};
      this.memory.delivered[resource] = (this.memory.delivered[resource] || 0) + amount;
    } else this.move(unit, destination.pos, 1);
    return false;
  }

  private runHauler(unit: Zerg): void {
    if (unit.pos.roomName === this.colony.name && unit.store.getUsedCapacity() > 0) {
      this.unload(unit);
      return;
    }
    if (unit.store.getFreeCapacity() === 0) {
      this.move(unit, this.colony.storage?.pos || this.colony.pos, 1);
      return;
    }
    if (!this.cold() || this.memory.phase !== "looting") {
      this.stage(unit, 4);
      return;
    }
    const room = Game.rooms[this.memory.target]!;
    const sources = [
      ...room.find(FIND_RUINS),
      ...this.structures().filter(
        (structure): structure is StructureStorage | StructureTerminal =>
          structure.structureType === STRUCTURE_STORAGE ||
          structure.structureType === STRUCTURE_TERMINAL,
      ),
    ].filter(
      (source) =>
        source.store.getUsedCapacity() > 0 &&
        !source.pos.lookFor(LOOK_STRUCTURES).some((s) => s.structureType === STRUCTURE_RAMPART),
    );
    const source = sources[0];
    if (!source) {
      if (
        this.structures().some(
          (structure) =>
            (structure.structureType === STRUCTURE_STORAGE ||
              structure.structureType === STRUCTURE_TERMINAL) &&
            (structure as StructureStorage | StructureTerminal).store.getUsedCapacity() > 0,
        )
      )
        this.stage(unit, 4);
      else stopRaid(this.memory, "raid objectives completed");
      return;
    }
    const resource = (Object.keys(source.store) as ResourceConstant[])
      .filter((r) => source.store[r] > 0)
      .sort((a, b) => Number(a === RESOURCE_ENERGY) - Number(b === RESOURCE_ENERGY))[0];
    if (unit.creep.withdraw(source, resource) === ERR_NOT_IN_RANGE) this.move(unit, source.pos, 1);
  }

  private withdraw(): void {
    for (const unit of this.units) {
      if (unit.spawning) continue;
      delete unit.memory._go;
      unit.task = null;
      if (unit.getActiveBodyparts(HEAL) > 0) this.heal(unit);
      if (unit.pos.roomName !== this.colony.name) {
        this.move(unit, this.colony.storage?.pos || this.colony.pos, 2);
        continue;
      }
      if (!this.unload(unit)) continue;
      const spawn = unit.pos.findClosestByRange(this.colony.spawns);
      if (spawn) {
        if (unit.pos.isNearTo(spawn)) spawn.recycleCreep(unit.creep);
        else this.move(unit, spawn.pos, 1);
      }
    }
    if (this.units.length === 0) {
      this.memory.phase = "complete";
      this.memory.finishedAt ??= Game.time;
    }
  }

  run(): void {
    this.checkSafety();
    if (this.memory.phase === "complete") return;
    if (this.memory.phase === "retreating") this.withdraw();
    else {
      for (const role of RAID_ROLES) {
        const unit = this.unit(role);
        if (!unit || unit.spawning) continue;
        unit.task = null;
        if (role !== "tank" && unit.pos.roomName === this.memory.target && unit.hits < unit.hitsMax)
          stopRaid(this.memory, `unexpected damage to ${role}`);
        if (this.withdrawing()) break;
        switch (role) {
          case "tank":
            this.runTank(unit);
            break;
          case "medic":
            this.runMedic(unit);
            break;
          case "interceptor":
            this.runInterceptor(unit);
            break;
          case "breaker":
            this.runBreaker(unit);
            break;
          case "hauler":
            this.runHauler(unit);
            break;
        }
      }
      if (this.withdrawing()) this.withdraw();
    }
    this.memory.status = {
      tick: Game.time,
      spent: raidCommitted(this.memory),
      remaining: Math.max(0, Math.min(10000, this.memory.budget) - raidCommitted(this.memory)),
      units: this.units.length,
      phase: this.memory.phase,
    };
    if (this.memory.stoppedAt === Game.time)
      log.warning(`${this.directive.name}: withdrawing: ${this.memory.stopReason}`);
  }
}
