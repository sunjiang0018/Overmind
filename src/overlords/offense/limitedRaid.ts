import { CreepSetup } from "../../creepSetups/CreepSetup";
import type { DirectiveLimitedRaid } from "../../directives/offense/limitedRaid";
import { log } from "../../console/log";
import {
  RAID_ROLES,
  RAID_REINFORCEMENT_ROLES,
  type LimitedRaidMemory,
  type RaidRole,
  raidBody,
  raidBodyCost,
  raidBudgetLimit,
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

/** A budgeted raid with optional border attrition tactics. */
export class LimitedRaidOverlord extends Overlord {
  declare memory: LimitedRaidMemory;
  directive: DirectiveLimitedRaid;
  private groups: { [role in RaidRole]: Zerg[] };

  constructor(directive: DirectiveLimitedRaid) {
    // Attrition must get a spawn window between routine transport replacements.
    // Queens, defense, first transport, miners and essential workers remain ahead of it.
    super(directive, "raid", directive.memory.raid?.tactics === "attrition" ? 505 : 590);
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
    const active = this.groups[role].filter((unit) => !this.memory.retiring?.includes(unit.name));
    // Cache refreshes can enumerate the new creep first. Keep the veteran on duty
    // until stageReplacements explicitly hands over, regardless of array order.
    return active.find((unit) => this.memory.replacing?.includes(unit.name)) || active[0];
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

  private chargedTowers(): boolean {
    return this.towers().some((tower) => tower.store.energy >= TOWER_ENERGY_COST);
  }

  private cold(): boolean {
    return (
      this.memory.lastSeen === Game.time &&
      !this.chargedTowers() &&
      this.memory.coldSince !== undefined &&
      Game.time - this.memory.coldSince >= 5
    );
  }

  private defenders(roomName: string): Creep[] {
    const room = Game.rooms[roomName];
    return room ? this.hostiles(room).filter((creep) => raidMilitary(creep)) : [];
  }

  private borderBattle(): boolean {
    return (
      this.memory.tactics === "attrition" &&
      (this.defenders(this.memory.target).length > 0 ||
        this.defenders(this.memory.staging.roomName).length > 0)
    );
  }

  private waitingForLaunch(): boolean {
    return !!this.memory.launch && Game.time < this.memory.launch.notBefore;
  }

  private lureEnabled(): boolean {
    return this.memory.tactics === "attrition" && !!this.memory.breachAndLure;
  }

  private lureMode(mode: NonNullable<LimitedRaidMemory["lure"]>["mode"], reason?: string): void {
    const state = (this.memory.lure ??= { mode, since: Game.time, attempts: 0, noPursuit: 0 });
    if (state.mode !== mode) state.since = Game.time;
    state.mode = mode;
    state.reason = reason;
  }

  /** Bound forward operations to the explicitly ordered part of the target room. */
  private insideProbe(pos: RoomPosition): boolean {
    return (
      pos.roomName === this.memory.target &&
      pos.inRangeTo(
        position(this.memory.entry),
        Math.max(1, Math.min(48, this.memory.breachAndLure?.maxDepth || 1)),
      )
    );
  }

  private pressureTarget(unit: Zerg): Structure | undefined {
    const target = this.demolitionTarget(unit);
    return target && this.insideProbe(target.pos) ? target : undefined;
  }

  private pressureReady(target: Structure): boolean {
    const tank = this.unit("tank");
    const medic = this.unit("medic");
    return !!(
      this.cold() &&
      tank &&
      !tank.spawning &&
      tank.hits >= tank.hitsMax * 0.85 &&
      tank.pos.inRangeTo(target.pos, 3) &&
      medic &&
      !medic.spawning &&
      medic.hits === medic.hitsMax &&
      medic.pos.inRangeTo(target.pos, 3) &&
      medic.getActiveBodyparts(HEAL) >= 7 &&
      !this.defenders(this.memory.target).some((enemy) => enemy.pos.inRangeTo(target.pos, 6)) &&
      !this.defenders(this.memory.staging.roomName).length &&
      this.memory.lure?.mode !== "pulling"
    );
  }

  private combatPower(
    unit: Creep | Zerg,
    part: BodyPartConstant,
    action: string,
    base: number,
  ): number {
    return unit.body.reduce((sum, body) => {
      if (body.type !== part || body.hits <= 0) return sum;
      const boost =
        body.boost &&
        (BOOSTS[part] as { [resource: string]: { [effect: string]: number } })[body.boost];
      return sum + base * ((boost && boost[action]) || 1);
    }, 0);
  }

  /** Conservative local focus-fire estimate; remote reinforcements contribute nothing. */
  private canWinContact(tank: Zerg, target: Creep): boolean {
    const enemies = this.defenders(this.memory.target).filter((enemy) =>
      enemy.pos.inRangeTo(tank.pos, 6),
    );
    const friends = this.units.filter(
      (unit) =>
        !unit.spawning &&
        !this.memory.retiring?.includes(unit.name) &&
        unit.pos.inRangeTo(target.pos, 4),
    );
    const damage = (unit: Creep | Zerg) =>
      this.combatPower(unit, ATTACK, "attack", 30) +
      this.combatPower(unit, RANGED_ATTACK, "rangedAttack", 10);
    const friendlyDamage = friends.reduce(
      (sum, unit) =>
        sum +
        (unit.pos.isNearTo(target.pos) ? this.combatPower(unit, ATTACK, "attack", 30) : 0) +
        (unit.pos.inRangeTo(target.pos, 3)
          ? this.combatPower(unit, RANGED_ATTACK, "rangedAttack", 10)
          : 0),
      0,
    );
    const enemyDamage = enemies.reduce((sum, enemy) => sum + damage(enemy), 0);
    const enemyHealing = enemies.reduce(
      (sum, enemy) => sum + this.combatPower(enemy, HEAL, "heal", 12),
      0,
    );
    const effectiveHits = (enemy: Creep) =>
      enemy.body.reduce((sum, part) => {
        const multiplier =
          part.type === TOUGH && part.boost ? BOOSTS[TOUGH][part.boost]?.damage || 1 : 1;
        return sum + part.hits / multiplier;
      }, 0);
    const netDamage = friendlyDamage - enemyHealing;
    const killTicks =
      netDamage > 0
        ? enemies.reduce((sum, enemy) => sum + effectiveHits(enemy), 0) / netDamage
        : 100000;
    const survivalTicks = Math.min(
      100000,
      ...friends.map((patient) => {
        const healing = friends.reduce(
          (sum, medic) =>
            sum +
            (medic.pos.isNearTo(patient)
              ? this.combatPower(medic, HEAL, "heal", 12)
              : medic.pos.inRangeTo(patient, 3) &&
                  !(
                    medic.pos.inRangeTo(target.pos, 3) &&
                    this.combatPower(medic, RANGED_ATTACK, "rangedAttack", 10) > 0
                  )
                ? this.combatPower(medic, HEAL, "heal", 4)
                : 0),
          0,
        );
        const loss = enemyDamage - healing;
        return loss > 0 ? Math.max(0, patient.hits - patient.hitsMax * 0.25) / loss : 100000;
      }),
    );
    const canWin =
      this.cold() &&
      this.insideProbe(target.pos) &&
      netDamage > 0 &&
      survivalTicks > killTicks * 1.5 + 2 &&
      friends.every((unit) => (unit.ticksToLive || 0) > killTicks + 20);
    this.memory.lure!.engagement = {
      tick: Game.time,
      canWin,
      friendlyDamage,
      enemyDamage,
      enemyHealing,
      killTicks,
      survivalTicks,
    };
    return canWin;
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
      memory.target === this.colony.name ||
      (memory.launch &&
        (!Number.isFinite(memory.launch.notBefore) || memory.launch.notBefore >= memory.deadline))
    ) {
      stopRaid(memory, "invalid raid configuration");
      return;
    }
    if (this.waitingForLaunch()) return;
    if (memory.launch) memory.launch.startedAt ??= Game.time;
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
        // Target defenders and pursuers in the adjacent arena are combat objectives.
        if (
          memory.tactics === "attrition" &&
          !powerReinforcement &&
          (roomName === memory.target || roomName === memory.staging.roomName)
        )
          continue;
        stopRaid(
          memory,
          `enemy reinforcement in ${roomName}: ${(reinforcement || powerReinforcement)!.name}`,
        );
        return;
      }
    }
    for (const unit of this.units) {
      if (unit.spawning) continue;
      const ttl = unit.ticksToLive ?? CREEP_LIFE_TIME;
      if (memory.tactics === "attrition") {
        // Spawn and stage the relief before returning the veteran, preserving pressure.
        if (ttl < 500 && !memory.replacing?.includes(unit.name))
          (memory.replacing ??= []).push(unit.name);
        // Military veterans stay on station until relief arrives. Their remaining
        // lifetime is already paid for; withdrawing early would interrupt pressure.
        // Cargo carriers still reserve a return trip to protect collected loot.
        if (ttl < 200 && unit.store.getUsedCapacity() > 0 && !memory.retiring?.includes(unit.name))
          (memory.retiring ??= []).push(unit.name);
      } else if (ttl < 250) {
        stopRaid(memory, "lifetime reserve for withdrawal");
      }
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
    if (!this.chargedTowers()) {
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
      memory.phase === "draining" &&
      memory.tactics !== "attrition"
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
      !this.waitingForLaunch() &&
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
    if (role === "skirmisher")
      return (
        this.memory.tactics === "attrition" &&
        this.memory.reinforcements === true &&
        !this.unit("interceptor") &&
        raidBudgetLimit(this.memory) - raidCommitted(this.memory) <
          raidBodyCost(raidBody("interceptor")) &&
        this.units.some(
          (unit) =>
            !unit.spawning &&
            !this.memory.retiring?.includes(unit.name) &&
            unit.getActiveBodyparts(ATTACK) > 0,
        )
      );
    if (RAID_REINFORCEMENT_ROLES.some((candidate) => candidate === role))
      return this.memory.tactics === "attrition" && this.memory.reinforcements === true;
    return role === "breaker"
      ? this.memory.reinforcements === true || (this.cold() && !this.borderBattle())
      : role === "hauler"
        ? this.cold() && !this.borderBattle() && this.memory.phase === "looting"
        : true;
  }

  init(): void {
    reconcileRaidSpawns(this.memory);
    this.checkSafety();
    if (!this.canRecruit()) return;
    // Once the reinforced squad is funded, fund its demolition unit before
    // optional early relief for a still-serving veteran consumes the last budget.
    const recruitmentOrder: readonly RaidRole[] = this.lureEnabled()
      ? [
          "medic",
          "tank",
          "interceptor",
          "breaker",
          ...RAID_REINFORCEMENT_ROLES,
          "hauler",
          "skirmisher",
        ]
      : this.memory.reinforcements &&
          RAID_REINFORCEMENT_ROLES.every((candidate) => raidHasRole(this.memory, candidate))
        ? ["breaker", ...RAID_ROLES.filter((candidate) => candidate !== "breaker")]
        : RAID_ROLES;
    const role = recruitmentOrder.find(
      (candidate) =>
        !raidHasRole(this.memory, candidate) &&
        this.roleAllowed(candidate) &&
        (this.memory.tactics !== "attrition" ||
          raidCommitted(this.memory) + raidBodyCost(raidBody(candidate)) <=
            raidBudgetLimit(this.memory)),
    );
    if (!role) {
      if (
        !this.units.some(
          (unit) =>
            !this.memory.retiring?.includes(unit.name) &&
            [ATTACK, RANGED_ATTACK, WORK].some(
              (part) => unit.getActiveBodyparts(part as BodyPartConstant) > 0,
            ),
        ) &&
        this.memory.tactics === "attrition" &&
        RAID_ROLES.every(
          (candidate) =>
            !this.roleAllowed(candidate) ||
            raidBodyCost(raidBody(candidate)) >
              raidBudgetLimit(this.memory) - raidCommitted(this.memory),
        )
      )
        stopRaid(this.memory, "budget limit");
      return;
    }
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
    const local = unit.pos.roomName === destination.roomName;
    const route = local
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
      noPush: true,
      ...(local ? { repathChance: 1 } : {}),
      pathOpts: {
        route,
        maxRooms: local ? 1 : allowed.length,
        blockExits: local,
        blockCreeps: true,
        allowHostile: true,
        allowPortals: false,
        avoidSK: true,
      },
    });
  }

  private stage(unit: Zerg, offset = 0): void {
    const p = this.memory.staging;
    if (this.memory.reinforcements) {
      const stations: { [role: string]: [number, number] } = {
        raid_supportMedicA: [-1, 0],
        raid_supportMedicB: [1, 1],
        raid_supportMedicC: [-1, 1],
        raid_extraTank: [0, 1],
        raid_breaker: [0, -1],
      };
      const station = stations[unit.memory.role];
      if (station) {
        this.move(unit, new RoomPosition(p.x + station[0], p.y + station[1], p.roomName));
        return;
      }
    }
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
    if (this.lureEnabled() && this.runLureTank(tank)) return;
    const medic =
      [
        this.unit("medic"),
        this.unit("supportMedicA"),
        this.unit("supportMedicB"),
        this.unit("supportMedicC"),
      ].find(
        (unit) =>
          unit &&
          !unit.spawning &&
          unit.pos.roomName === this.memory.staging.roomName &&
          unit.hits === unit.hitsMax,
      ) || this.unit("medic");
    const charged = this.towers().filter((tower) => tower.store.energy >= TOWER_ENERGY_COST);
    const stagedMedics = this.units.filter(
      (unit) =>
        !unit.spawning &&
        !this.memory.retiring?.includes(unit.name) &&
        unit.pos.roomName === this.memory.staging.roomName &&
        unit.pos.inRangeTo(position(this.memory.staging), 3) &&
        unit.hits === unit.hitsMax &&
        unit.getActiveBodyparts(HEAL) >= 7,
    );
    const ranged = this.unit("interceptor") || this.unit("skirmisher");
    const coverReady =
      (this.memory.reinforcements && stagedMedics.length >= 3) ||
      (ranged &&
        !ranged.spawning &&
        ranged.pos.roomName === this.memory.staging.roomName &&
        (this.memory.tactics !== "attrition" ||
          (ranged.pos.inRangeTo(position(this.memory.staging), 3) &&
            ranged.hits === ranged.hitsMax)));
    const borderProbe =
      this.memory.reinforcements &&
      this.memory.phase === "draining" &&
      tank.pos.roomName === this.memory.target &&
      tank.pos.inRangeTo(position(this.memory.entry), 1) &&
      charged.length > 0 &&
      charged.length <= 2 &&
      charged.every((tower) => tank.pos.getRangeTo(tower) >= TOWER_FALLOFF_RANGE) &&
      stagedMedics.length >= 3;
    const needsRecovery =
      tank.hits < tank.hitsMax && (!borderProbe || tank.hits <= tank.hitsMax / 2);
    if (this.memory.tactics === "attrition" && tank.pos.roomName === this.memory.target) {
      const enemy = tank.pos.findClosestByRange(this.defenders(this.memory.target));
      const target = enemy && tank.pos.isNearTo(enemy) ? enemy : this.demolitionTarget(tank);
      if (target && tank.pos.isNearTo(target)) tank.creep.attack(target);
    }
    if (
      this.memory.tactics === "attrition" &&
      tank.pos.roomName === this.memory.target &&
      needsRecovery
    ) {
      this.stage(tank);
      return;
    }
    if (this.borderBattle()) {
      const enemies = this.defenders(tank.pos.roomName);
      const enemy = tank.pos.findClosestByRange(enemies);
      if (enemy && tank.pos.roomName !== this.memory.target && tank.pos.isNearTo(enemy))
        tank.creep.attack(enemy);
      if (tank.pos.roomName === this.memory.target) {
        // Bait at the entry, then pull the defender across the border and out of tower cover.
        if (
          needsRecovery ||
          (enemy && tank.pos.inRangeTo(enemy, 5)) ||
          (this.chargedTowers() && !borderProbe)
        )
          this.stage(tank);
        else if (enemy && this.cold()) {
          const gate = this.demolitionTarget(tank);
          if (gate && gate.pos.x === this.memory.entry.x - 1 && gate.pos.y === this.memory.entry.y)
            this.move(tank, gate.pos, 1);
          else this.move(tank, enemy.pos, 5);
        } else this.move(tank, position(this.memory.entry));
        return;
      }
      if (tank.pos.roomName === this.memory.staging.roomName && enemies.length) {
        this.stage(tank);
        return;
      }
    }
    if (tank.pos.roomName === this.memory.target) {
      if (this.memory.phase === "draining" || this.memory.phase === "assembling") {
        this.memory.tankEntered ??= Game.time;
        const gate = this.demolitionTarget(tank);
        if (gate && tank.pos.isNearTo(gate)) tank.creep.attack(gate);
        if (
          needsRecovery ||
          (this.chargedTowers() && !borderProbe && Game.time > this.memory.tankEntered)
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
      !coverReady ||
      (this.memory.tactics === "attrition" &&
        this.units.some(
          (unit) =>
            unit.pos.roomName === this.memory.target &&
            unit.hits < unit.hitsMax &&
            !(
              this.memory.reinforcements &&
              this.memory.phase === "draining" &&
              charged.length > 0 &&
              charged.length <= 2 &&
              stagedMedics.length >= 3 &&
              (unit.memory.role === "raid_tank" || unit.memory.role === "raid_extraTank") &&
              unit.pos.inRangeTo(position(this.memory.entry), 1) &&
              charged.every((tower) => unit.pos.getRangeTo(tower) >= TOWER_FALLOFF_RANGE) &&
              unit.hits > unit.hitsMax / 2
            ),
        ))
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

  /** Opening a defended gate and observing pursuit are separate from tower draining. */
  private runLureTank(tank: Zerg): boolean {
    const inTarget = tank.pos.roomName === this.memory.target;
    const arena = this.defenders(this.memory.staging.roomName);
    if (arena.length) {
      this.lureMode("arena");
      this.memory.lure!.arenaSeenAt ??= Game.time;
      delete this.memory.lure!.probeStarted;
      if (inTarget) this.stage(tank);
      else {
        const enemy = tank.pos.findClosestByRange(arena);
        if (enemy && tank.pos.isNearTo(enemy)) tank.creep.attack(enemy);
        this.stage(tank);
      }
      return true;
    }
    if (!this.cold()) {
      this.lureMode("draining", "towers charged or cold window unverified");
      if (
        inTarget &&
        (this.unit("medic")?.pos.roomName === this.memory.target ||
          !tank.pos.inRangeTo(position(this.memory.entry), 1))
      ) {
        this.stage(tank);
        return true;
      }
      return false;
    }
    // The other tank keeps the exit free instead of competing for the bait tile.
    if (tank.memory.role === "raid_extraTank") {
      const enemy = tank.pos.findClosestByRange(this.defenders(this.memory.target));
      if (
        this.memory.lure?.mode === "fighting" &&
        enemy &&
        this.insideProbe(enemy.pos) &&
        tank.hits > tank.hitsMax * 0.25
      ) {
        if (tank.pos.isNearTo(enemy)) tank.creep.attack(enemy);
        else this.move(tank, enemy.pos, 1);
      } else this.stage(tank);
      return true;
    }
    const state = (this.memory.lure ??= {
      mode: "opening",
      since: Game.time,
      attempts: 0,
      noPursuit: 0,
    });
    const medic = this.unit("medic");
    const guard = this.unit("interceptor") || this.unit("skirmisher");
    if (state.mode === "pulling") {
      this.stage(tank);
      if (!inTarget && Game.time - state.since >= 20) {
        state.noPursuit++;
        state.lastProbeEnded = Game.time;
        delete state.probeStarted;
        this.lureMode("pressure", "no defender followed the bait into the arena");
      }
      return true;
    }
    const enemy = inTarget
      ? tank.pos.findClosestByRange(this.defenders(this.memory.target))
      : undefined;
    if (enemy && tank.pos.isNearTo(enemy)) tank.creep.attack(enemy);
    const contactRange = enemy?.getActiveBodyparts(RANGED_ATTACK) ? 3 : 2;
    const timedOut =
      inTarget &&
      state.probeStarted !== undefined &&
      Game.time - state.probeStarted >=
        Math.max(10, Math.min(60, this.memory.breachAndLure!.probeTicks));
    if ((enemy && tank.pos.inRangeTo(enemy, contactRange)) || timedOut) {
      if (enemy && this.canWinContact(tank, enemy)) {
        this.lureMode("fighting", "local damage and healing leave a survival margin");
        state.defender = enemy.name;
        if (!tank.pos.isNearTo(enemy)) this.move(tank, enemy.pos, 1);
        return true;
      }
      if (state.probeStarted === undefined) {
        state.probeStarted = Game.time;
        state.attempts++;
      }
      this.lureMode(
        "pulling",
        timedOut
          ? "bounded probe elapsed without a winning engagement"
          : "local force cannot safely win contact",
      );
      state.defender = enemy?.name;
      this.stage(tank);
      return true;
    }
    const cover =
      medic &&
      !medic.spawning &&
      medic.hits === medic.hitsMax &&
      medic.getActiveBodyparts(HEAL) >= 7 &&
      guard &&
      !guard.spawning &&
      (guard.pos.inRangeTo(position(this.memory.staging), 4) ||
        (inTarget && guard.pos.inRangeTo(tank.pos, 3))) &&
      guard.hits === guard.hitsMax;
    if (
      !cover ||
      tank.hits < tank.hitsMax * 0.85 ||
      (inTarget &&
        !tank.pos.inRangeTo(medic!.pos, 2) &&
        !tank.pos.inRangeTo(position(this.memory.entry), 1))
    ) {
      this.lureMode("recovering", "bait needs local healing or staged cover");
      this.stage(tank);
      return true;
    }
    if (!inTarget) {
      if (tank.hits < tank.hitsMax) {
        this.stage(tank);
        return true;
      }
      this.move(tank, position(this.memory.entry));
      return true;
    }
    const target = this.pressureTarget(tank);
    if (target) {
      this.lureMode(
        "opening",
        "pressure the next reachable structure instead of waiting for distant defenders",
      );
      if (tank.pos.isNearTo(target)) tank.creep.attack(target);
      else this.move(tank, target.pos, 1);
      return true;
    }
    if (
      enemy &&
      this.insideProbe(enemy.pos) &&
      (state.lastProbeEnded === undefined || Game.time - state.lastProbeEnded >= 60)
    ) {
      if (state.probeStarted === undefined) {
        state.probeStarted = Game.time;
        state.attempts++;
      }
      this.lureMode("probing");
      state.defender = enemy.name;
      this.move(tank, enemy.pos, contactRange);
    } else {
      this.lureMode(
        "pressure",
        "defender remains outside the bounded probe; no pursuit demonstrated",
      );
      if (Game.time - state.since >= 120)
        stopRaid(this.memory, "no reachable pressure target or demonstrated pursuit");
      this.move(tank, position(this.memory.entry));
    }
    return true;
  }

  private runMedic(medic: Zerg): void {
    this.heal(medic);
    if (
      this.lureEnabled() &&
      (medic.memory.role === "raid_medic" || medic.memory.role === "raid_supportMedicA") &&
      this.cold() &&
      !this.defenders(this.memory.staging.roomName).length
    ) {
      const tank = this.unit("tank");
      if (
        tank &&
        !tank.spawning &&
        tank.pos.roomName === this.memory.target &&
        this.insideProbe(tank.pos) &&
        (medic.hits === medic.hitsMax || this.memory.lure?.mode === "fighting") &&
        this.memory.lure?.mode !== "pulling" &&
        this.memory.lure?.mode !== "recovering"
      ) {
        this.move(medic, tank.pos, 1);
        return;
      }
    }
    if (
      this.memory.tactics === "attrition" &&
      medic.pos.roomName === this.memory.staging.roomName
    ) {
      const enemies = this.defenders(medic.pos.roomName);
      if (enemies.some((enemy) => medic.pos.inRangeTo(enemy, 3))) {
        medic.kite(enemies, { pathOpts: { maxRooms: 1 } });
        return;
      }
    }
    if (this.memory.reinforcements && (!this.cold() || this.borderBattle())) {
      this.stage(medic, 1);
      return;
    }
    if (
      !this.borderBattle() &&
      this.cold() &&
      (this.memory.phase === "breaching" || this.memory.phase === "looting")
    ) {
      const patient = this.unit("breaker") || this.unit("tank");
      if (patient && !patient.spawning) this.move(medic, patient.pos, 1);
      else this.stage(medic, 1);
    } else if (medic.pos.roomName === this.memory.staging.roomName) {
      const patient = this.units
        .filter(
          (unit) =>
            !unit.spawning && unit.pos.roomName === medic.pos.roomName && unit.hits < unit.hitsMax,
        )
        .sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax)[0];
      if (patient) this.move(medic, patient.pos, 1);
      else this.stage(medic, 1);
    } else this.stage(medic, 1);
  }

  private runInterceptor(unit: Zerg): void {
    this.heal(unit);
    if (this.lureEnabled() && this.cold() && unit.memory.role === "raid_interceptor") {
      const tank = this.unit("tank");
      const medic = this.unit("medic");
      if (
        tank &&
        medic &&
        !tank.spawning &&
        !medic.spawning &&
        this.insideProbe(tank.pos) &&
        (tank.hits >= tank.hitsMax * 0.85 || this.memory.lure?.mode === "fighting") &&
        medic.pos.inRangeTo(tank.pos, 2) &&
        (medic.hits === medic.hitsMax || this.memory.lure?.mode === "fighting") &&
        (unit.hits >= unit.hitsMax * 0.85 || this.memory.lure?.mode === "fighting") &&
        this.memory.lure?.mode !== "pulling" &&
        this.memory.lure?.mode !== "recovering" &&
        !this.defenders(this.memory.staging.roomName).length
      ) {
        const enemy = unit.pos.findClosestByRange(this.defenders(this.memory.target));
        if (enemy && unit.pos.inRangeTo(enemy, 3)) unit.creep.rangedAttack(enemy);
        if (enemy && unit.pos.inRangeTo(enemy, 2)) this.move(unit, position(this.memory.entry));
        else this.move(unit, tank.pos, 1);
        return;
      }
    }
    const guardOnly =
      unit.memory.role === "raid_skirmisher" ||
      (this.memory.reinforcements && this.towers().length > 0);
    if (guardOnly && unit.pos.roomName !== this.memory.staging.roomName) {
      this.stage(unit, 2);
      return;
    }
    if (this.memory.tactics === "attrition") {
      if (
        unit.pos.roomName === this.memory.target &&
        (this.borderBattle() || unit.hits < unit.hitsMax)
      ) {
        const enemy = unit.pos.findClosestByRange(this.defenders(this.memory.target));
        if (enemy && unit.pos.inRangeTo(enemy, 3)) unit.creep.rangedAttack(enemy);
        this.stage(unit, 2);
        return;
      }
      if (unit.pos.roomName === this.memory.staging.roomName) {
        const enemies = this.defenders(unit.pos.roomName);
        const enemy = unit.pos.findClosestByRange(enemies);
        if (enemy) {
          if (this.lureEnabled()) {
            this.lureMode("arena");
            const state = this.memory.lure!;
            state.arenaSeenAt ??= Game.time;
            if (
              state.arenaTarget?.name === enemy.name &&
              state.arenaTarget.tick === Game.time - 1 &&
              enemy.hits < state.arenaTarget.hits
            )
              state.arenaDamageObservedAt = Game.time;
            state.arenaTarget = { name: enemy.name, hits: enemy.hits, tick: Game.time };
          }
          if (unit.pos.inRangeTo(enemy, 3)) {
            const result = unit.creep.rangedAttack(enemy);
            if (this.lureEnabled()) {
              this.lureMode("arena");
              this.memory.lure!.arenaSeenAt ??= Game.time;
              this.memory.lure!.arenaAttackAt = Game.time;
              this.memory.lure!.arenaAttackResult = result;
              this.memory.lure!.defender = enemy.name;
            }
          }
          if (unit.pos.inRangeTo(enemy, 2) || unit.hits < unit.hitsMax * 0.8)
            unit.kite(enemies, { pathOpts: { maxRooms: 1 } });
          else this.move(unit, enemy.pos, 3);
          return;
        }
        if (guardOnly) {
          this.stage(unit, 2);
          return;
        }
        if (this.borderBattle() || unit.hits < unit.hitsMax) {
          this.stage(unit, 2);
          return;
        }
      }
    }
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
    if (this.lureEnabled()) {
      const target = this.pressureTarget(unit);
      if (!target || !this.pressureReady(target) || unit.hits < unit.hitsMax) {
        const tank = this.unit("tank");
        const medic = this.unit("medic");
        if (
          target &&
          this.cold() &&
          tank &&
          !tank.spawning &&
          this.insideProbe(tank.pos) &&
          tank.hits >= tank.hitsMax * 0.85 &&
          medic &&
          !medic.spawning &&
          medic.hits === medic.hitsMax &&
          medic.getActiveBodyparts(HEAL) >= 7 &&
          medic.pos.inRangeTo(tank.pos, 2) &&
          unit.hits === unit.hitsMax &&
          this.memory.lure?.mode !== "pulling" &&
          this.memory.lure?.mode !== "recovering" &&
          !this.defenders(this.memory.target).some((enemy) => enemy.pos.inRangeTo(unit.pos, 6)) &&
          !this.defenders(this.memory.staging.roomName).length
        ) {
          this.move(unit, tank.pos, 2);
          return;
        }
        this.stage(unit, 3);
        return;
      }
      if (this.memory.targetHits?.id !== target.id || target.hits < this.memory.targetHits.hits)
        this.memory.lastProgress = Game.time;
      this.memory.targetHits = { id: target.id, hits: target.hits };
      if (unit.creep.dismantle(target) === ERR_NOT_IN_RANGE) this.move(unit, target.pos, 1);
      return;
    }
    if (
      !this.cold() ||
      this.borderBattle() ||
      (this.memory.tactics === "attrition" && unit.hits < unit.hitsMax)
    ) {
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
    if (!this.cold() || this.borderBattle() || this.memory.phase !== "looting") {
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

  private stageReplacements(): void {
    for (const role of RAID_ROLES) {
      const veterans = this.groups[role].filter(
        (unit) =>
          this.memory.replacing?.includes(unit.name) && !this.memory.retiring?.includes(unit.name),
      );
      if (!veterans.length) continue;
      const fresh = this.groups[role].find(
        (unit) =>
          !this.memory.replacing?.includes(unit.name) && !this.memory.retiring?.includes(unit.name),
      );
      if (!fresh || fresh.spawning) continue;
      if (fresh.pos.inRangeTo(position(this.memory.staging), 3) && fresh.hits === fresh.hitsMax) {
        for (const veteran of veterans) (this.memory.retiring ??= []).push(veteran.name);
      } else {
        if (fresh.getActiveBodyparts(HEAL) > 0) this.heal(fresh);
        this.stage(
          fresh,
          {
            medic: 1,
            tank: 0,
            interceptor: 2,
            supportMedicA: -1,
            supportMedicB: 1,
            supportMedicC: -1,
            extraTank: 0,
            breaker: 3,
            hauler: 4,
            skirmisher: 2,
          }[role],
        );
      }
    }
  }

  private recoverUnit(unit: Zerg): void {
    if (unit.spawning) return;
    delete unit.memory._go;
    unit.task = null;
    if (unit.getActiveBodyparts(HEAL) > 0) this.heal(unit);
    if (unit.pos.roomName !== this.colony.name) {
      this.move(unit, this.colony.storage?.pos || this.colony.pos, 2);
      return;
    }
    if (!this.unload(unit)) return;
    const spawn = unit.pos.findClosestByRange(this.colony.spawns);
    if (spawn) {
      if (unit.pos.isNearTo(spawn)) spawn.recycleCreep(unit.creep);
      else this.move(unit, spawn.pos, 1);
    }
  }

  private withdraw(): void {
    for (const unit of this.units) this.recoverUnit(unit);
    if (this.units.length === 0) {
      this.memory.phase = "complete";
      this.memory.finishedAt ??= Game.time;
    }
  }

  run(): void {
    this.checkSafety();
    if (this.memory.phase === "complete") return;
    if (this.waitingForLaunch() && this.memory.phase !== "retreating") return;
    if (this.memory.phase === "retreating") this.withdraw();
    else {
      this.stageReplacements();
      for (const unit of this.units) {
        if (this.memory.retiring?.includes(unit.name)) this.recoverUnit(unit);
      }
      for (const role of RAID_ROLES) {
        const unit = this.unit(role);
        if (!unit || unit.spawning) continue;
        unit.task = null;
        if (
          this.memory.tactics !== "attrition" &&
          role !== "tank" &&
          unit.pos.roomName === this.memory.target &&
          unit.hits < unit.hitsMax
        )
          stopRaid(this.memory, `unexpected damage to ${role}`);
        if (this.withdrawing()) break;
        switch (role) {
          case "tank":
          case "extraTank":
            this.runTank(unit);
            break;
          case "medic":
          case "supportMedicA":
          case "supportMedicB":
          case "supportMedicC":
            this.runMedic(unit);
            break;
          case "interceptor":
          case "skirmisher":
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
      remaining: Math.max(0, raidBudgetLimit(this.memory) - raidCommitted(this.memory)),
      units: this.units.length,
      phase: this.memory.phase,
    };
    if (this.memory.stoppedAt === Game.time)
      log.warning(`${this.directive.name}: withdrawing: ${this.memory.stopReason}`);
  }
}
