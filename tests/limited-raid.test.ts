import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { constants as C } from "./helpers/constants";
import type { TestScope } from "./helpers/types";
import { classMembers } from "./helpers/source";
import * as native from "../src/utilities/native";

const compiled = new Map<string, string>();
function load(file: string, scope: TestScope, dependencies: TestScope = {}) {
  let code = compiled.get(file);
  if (!code) {
    code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2024,
        module: ts.ModuleKind.CommonJS,
        useDefineForClassFields: false,
      },
    }).outputText;
    compiled.set(file, code);
  }
  const out: TestScope = {};
  new Function("scope", `with(scope){return function(exports,require){${code}}}`)(scope)(
    out,
    (name: string) => dependencies[name] || {},
  );
  return out;
}

function fixture(tactics?: "attrition") {
  const calls: TestScope[] = [];
  const groups: TestScope = {};
  const memory: TestScope = {
    version: 1,
    target: "E57S44",
    owner: "pcunning",
    budget: 10000,
    created: 100,
    deadline: 3100,
    phase: "assembling",
    route: ["E58S42", "E58S43", "E58S44", "E57S44"],
    entry: { x: 48, y: 25, roomName: "E57S44" },
    staging: { x: 2, y: 25, roomName: "E58S44" },
    receipts: [],
    ...(tactics ? { tactics } : {}),
  };
  const scope: TestScope = {
    ...C,
    Game: {
      time: 100,
      rooms: {},
      creeps: {},
      cpu: { bucket: 9000 },
      map: { findRoute: (_from: string, to: string) => [{ exit: C.LEFT, room: to }] },
    },
    Memory: { settings: { allies: ["harland", "ally"] } },
    log: { warning: () => {} },
    bodyCost: (body: string[]) => body.reduce((n, part) => n + C.BODYPART_COST[part], 0),
    ...native,
  };
  class Position {
    constructor(
      public x: number,
      public y: number,
      public roomName: string,
    ) {}
    getRangeTo(target: TestScope) {
      const p = target.pos || target;
      return this.roomName === p.roomName
        ? Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y))
        : Infinity;
    }
    isNearTo(target: TestScope) {
      return this.getRangeTo(target) <= 1;
    }
    inRangeTo(target: TestScope, range: number) {
      return this.getRangeTo(target) <= range;
    }
    isEqualTo(target: TestScope) {
      return this.getRangeTo(target) === 0;
    }
    findClosestByRange(targets: TestScope[]) {
      return targets
        .filter((target) => this.getRangeTo(target) < Infinity)
        .sort((a, b) => this.getRangeTo(a) - this.getRangeTo(b))[0];
    }
    lookFor() {
      return (scope.Game.rooms[this.roomName]?.structures || []).filter((s: TestScope) =>
        this.isEqualTo(s),
      );
    }
  }
  scope.RoomPosition = Position;
  const makeStore = (resources: TestScope = {}, capacity = 1000) =>
    Object.assign(resources, {
      getUsedCapacity: () =>
        Object.entries(resources).reduce(
          (n, [, amount]) => n + (typeof amount === "number" ? amount : 0),
          0,
        ),
      getFreeCapacity: () =>
        capacity -
        Object.entries(resources).reduce(
          (n, [, amount]) => n + (typeof amount === "number" ? amount : 0),
          0,
        ),
    });
  const room = (name: string) => {
    const r: TestScope = {
      name,
      controller: {
        owner: { username: name === memory.target ? "pcunning" : "harland" },
        safeMode: 0,
      },
      structures: [],
      enemies: [],
      powers: [],
      ruins: [],
    };
    r.find = (type: number) =>
      type === C.FIND_STRUCTURES
        ? r.structures
        : type === C.FIND_HOSTILE_CREEPS
          ? r.enemies
          : type === C.FIND_HOSTILE_POWER_CREEPS
            ? r.powers
            : type === C.FIND_RUINS
              ? r.ruins
              : [];
    scope.Game.rooms[name] = r;
    return r;
  };
  const target = room(memory.target),
    staging = room(memory.staging.roomName),
    home = room("E58S42");
  const structure = (type: string, x: number, y: number, energy = 0, hits = 3000) => ({
    id: `${type}:${x}:${y}`,
    structureType: type,
    pos: new Position(x, y, memory.target),
    store: makeStore({ energy }),
    hits,
  });
  const tower = structure(C.STRUCTURE_TOWER, 11, 14, 400);
  target.structures.push(tower);
  const queue: TestScope[] = [];
  const colony: TestScope = {
    name: "E58S42",
    pos: new Position(24, 40, "E58S42"),
    state: { bootstrapping: false },
    defcon: 0,
    storage: { pos: new Position(24, 40, "E58S42"), store: makeStore({ energy: 300000 }, 1000000) },
    spawns: [],
    hatchery: { enqueue: (request: TestScope) => queue.push(request) },
  };
  const api = load("src/strategy/limitedRaid.ts", scope);
  class BaseOverlord {
    memory: TestScope;
    colony: TestScope;
    priority = 590;
    constructor(directive: TestScope, _name: string, priority = 590) {
      this.memory = directive.memory.raid;
      this.colony = directive.colony;
      this.priority = priority;
    }
    zerg(role: string) {
      return (groups[role] ||= []);
    }
  }
  class Setup {
    constructor(
      public role: string,
      public bodySetup: TestScope,
    ) {}
    create() {
      return { body: this.bodySetup.pattern, boosts: [] };
    }
  }
  const { LimitedRaidOverlord } = load("src/overlords/offense/limitedRaid.ts", scope, {
    "../../strategy/limitedRaid": api,
    "../Overlord": { Overlord: BaseOverlord },
    "../../creepSetups/CreepSetup": { CreepSetup: Setup },
    "../../console/log": { log: scope.log },
  });
  const overlord = new LimitedRaidOverlord({
    name: "limitedRaid:E57S44:first",
    memory: { raid: memory },
    colony,
  });
  const creep = (role: string, roomName = "E58S44", x = 2, y = 25, suffix = 0) => {
    const name = `raid_${role}_${suffix}`,
      body = api.raidBody(role);
    const unit: TestScope = {
      name,
      body: body.map((type: string) => ({ type, hits: 100 })),
      pos: new Position(x, y, roomName),
      room: scope.Game.rooms[roomName],
      memory: { role: `raid_${role}` },
      spawning: false,
      ticksToLive: 1400,
      hits: body.length * 100,
      hitsMax: body.length * 100,
      store: makeStore(),
    };
    unit.getActiveBodyparts = (part: string) => body.filter((p: string) => p === part).length;
    unit.goTo = (destination: TestScope, options: TestScope) =>
      calls.push({ action: "move", role, name, destination, options });
    unit.kite = (enemies: TestScope[], options: TestScope) =>
      calls.push({ action: "kite", role, enemies, options });
    unit.creep = Object.fromEntries(
      ["attack", "rangedAttack", "heal", "rangedHeal", "dismantle", "withdraw", "transfer"].map(
        (action) => [
          action,
          (object: TestScope, ...args: unknown[]) => {
            calls.push({ action, role, object, args });
            return unit.pos.inRangeTo(
              object,
              action === "rangedAttack" || action === "rangedHeal" ? 3 : 1,
            )
              ? C.OK
              : C.ERR_NOT_IN_RANGE;
          },
        ],
      ),
    );
    groups[`raid_${role}`].push(unit);
    scope.Game.creeps[name] = unit;
    return unit;
  };
  const enemy = (part: string, username = "pcunning") => ({
    name: `enemy_${part}`,
    owner: { username },
    pos: new Position(30, 25, memory.target),
    body: [{ type: part, hits: 100 }],
    hits: 100,
    hitsMax: 100,
    getActiveBodyparts: (p: string) => (p === part ? 1 : 0),
  });
  const proto = (role: string, name = `raid_${role}_0`) => ({
    body: api.raidBody(role),
    name,
    memory: { O: "raid>raid", C: "E58S42", role: `raid_${role}`, task: null, data: { origin: "" } },
  });
  return {
    scope,
    memory,
    api,
    overlord,
    target,
    staging,
    home,
    tower,
    queue,
    calls,
    colony,
    creep,
    enemy,
    proto,
    structure,
    Position,
    makeStore,
  };
}

function nextRound() {
  const f = fixture("attrition");
  f.memory.budget = 30000;
  f.memory.reinforcements = true;
  f.memory.breachAndLure = { maxDepth: 2, probeTicks: 60 };
  f.memory.phase = "breaching";
  f.memory.lastSeen = 99;
  f.memory.coldSince = 90;
  f.tower.store.energy = 0;
  f.creep("tank", f.target.name, 48, 25);
  f.creep("medic", f.target.name, 48, 26);
  f.creep("interceptor", f.staging.name, 4, 25);
  return f;
}

test("a scheduled next round spends nothing during safe mode and rechecks safety at launch", () => {
  const f = fixture("attrition");
  f.memory.launch = { notBefore: 200 };
  f.target.controller.safeMode = 100;
  for (const tick of [100, 150, 199]) {
    f.scope.Game.time = tick;
    f.overlord.init();
    f.overlord.run();
  }
  assert.equal(f.queue.length, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.api.raidCommitted(f.memory), 0);
  assert.equal(f.memory.stopReason, undefined);
  f.scope.Game.time = 200;
  f.overlord.init();
  assert.equal(f.memory.stopReason, "enemy safe mode");
  assert.equal(f.queue.length, 0);
});

test("the next round starts its own ledger at the authorized tick and funds demolition early", () => {
  const f = fixture("attrition");
  f.memory.launch = { notBefore: 100 };
  f.memory.breachAndLure = { maxDepth: 2, probeTicks: 60 };
  f.memory.reinforcements = true;
  f.memory.budget = 30000;
  for (const role of ["medic", "tank", "interceptor"]) {
    f.creep(role);
    f.api.reserveRaidSpawn(f.memory, role, f.proto(role));
    f.api.settleRaidSpawn(f.memory, f.proto(role).name, C.OK);
  }
  f.overlord.init();
  assert.equal(f.memory.launch.startedAt, 100);
  assert.equal(f.queue[0].setup.role, "raid_breaker");
  assert.equal(f.api.raidCommitted(f.memory), 5730);
});

test("a distant core guard does not veto covered entry demolition in the next round", () => {
  const f = nextRound();
  const gate = f.structure(C.STRUCTURE_RAMPART, 47, 25, 0, 9000);
  f.target.structures.push(gate);
  f.target.enemies.push(f.enemy(C.ATTACK));
  f.creep("breaker", f.target.name, 48, 24);
  f.overlord.run();
  assert.ok(
    f.calls.some((c) => c.role === "breaker" && c.action === "dismantle" && c.object === gate),
  );
  assert.ok(f.calls.some((c) => c.role === "tank" && c.action === "attack" && c.object === gate));
  assert.equal(f.memory.lure.mode, "opening");
  assert.equal(f.memory.lure.arenaSeenAt, undefined);
  assert.equal(f.memory.stopReason, undefined);
});

test("an authorized deeper window advances the screened squad toward the core after opening the gate", () => {
  const f = nextRound();
  f.memory.breachAndLure.maxDepth = 45;
  f.target.enemies.push(f.enemy(C.ATTACK));
  f.creep("breaker", f.target.name, 49, 25);
  f.overlord.run();
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.isEqualTo(f.tower.pos)));
  assert.ok(
    f.calls.some(
      (c) => c.role === "breaker" && c.destination?.isEqualTo(f.scope.Game.creeps.raid_tank_0.pos),
    ),
  );
  assert.equal(f.memory.stopReason, undefined);
});

test("covered demolition closes when the escort, screen or defender buffer is lost", () => {
  for (const scenario of ["escort", "screen", "defender", "tower"]) {
    const f = nextRound();
    const gate = f.structure(C.STRUCTURE_RAMPART, 47, 25);
    f.target.structures.push(gate);
    f.creep("breaker", f.target.name, 48, 24);
    if (scenario === "escort")
      f.scope.Game.creeps.raid_medic_0.pos = new f.Position(3, 25, f.staging.name);
    if (scenario === "screen") f.scope.Game.creeps.raid_tank_0.hits = 2000;
    if (scenario === "defender") {
      const enemy = f.enemy(C.ATTACK);
      enemy.pos = new f.Position(42, 25, f.target.name);
      f.target.enemies.push(enemy);
    }
    if (scenario === "tower") f.tower.store.energy = 10;
    f.overlord.run();
    assert.ok(!f.calls.some((c) => c.role === "breaker" && c.action === "dismantle"), scenario);
    assert.ok(
      f.calls.some((c) => c.role === "breaker" && c.destination?.roomName === f.staging.name),
      scenario,
    );
  }
});

test("the mobile escort follows the bait through an empty-tower gate despite a distant guard", () => {
  const f = nextRound();
  f.scope.Game.creeps.raid_medic_0.pos = new f.Position(3, 25, f.staging.name);
  f.target.enemies.push(f.enemy(C.ATTACK));
  f.creep("supportMedicB", f.staging.name, 3, 26);
  f.overlord.run();
  assert.ok(f.calls.some((c) => c.role === "medic" && c.destination?.roomName === f.target.name));
  assert.ok(
    !f.calls.some((c) => c.role === "supportMedicB" && c.destination?.roomName === f.target.name),
  );
  assert.ok(
    !f.calls.some((c) => c.role === "interceptor" && c.destination?.roomName === f.target.name),
  );
});

test("losing melee contact pulls across the border and records actual arena attacks without stopping on pursuit", () => {
  const f = nextRound();
  const defender = f.enemy(C.ATTACK);
  defender.body = Array.from({ length: 20 }, () => ({ type: C.ATTACK, hits: 100 }));
  defender.pos = new f.Position(46, 25, f.target.name);
  f.target.enemies.push(defender);
  f.overlord.run();
  assert.equal(f.memory.lure.mode, "pulling");
  assert.equal(f.memory.lure.attempts, 1);
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name));
  assert.equal(f.memory.lure.arenaSeenAt, undefined);
  f.target.enemies = [];
  defender.pos = new f.Position(2, 25, f.staging.name);
  f.staging.enemies.push(defender);
  f.scope.Game.creeps.raid_tank_0.pos = new f.Position(2, 26, f.staging.name);
  f.scope.Game.time++;
  f.overlord.run();
  assert.equal(f.memory.lure.mode, "arena");
  assert.equal(f.memory.lure.arenaSeenAt, 101);
  assert.equal(f.memory.lure.arenaAttackAt, 101);
  assert.equal(f.memory.lure.arenaAttackResult, C.OK);
  assert.equal(f.memory.lure.arenaDamageObservedAt, undefined);
  defender.hits -= 50;
  f.scope.Game.time++;
  f.overlord.run();
  assert.equal(f.memory.lure.arenaDamageObservedAt, 102);
  assert.equal(f.memory.stopReason, undefined);
});

test("a winning local fight stays engaged instead of withdrawing merely on contact", () => {
  const f = nextRound();
  f.creep("supportMedicA", f.target.name, 48, 25);
  f.scope.Game.creeps.raid_tank_0.pos = new f.Position(47, 25, f.target.name);
  const defender = f.enemy(C.ATTACK);
  defender.body = [
    ...Array.from({ length: 5 }, () => ({ type: C.ATTACK, hits: 100 })),
    ...Array.from({ length: 5 }, () => ({ type: C.MOVE, hits: 100 })),
  ];
  defender.pos = new f.Position(46, 25, f.target.name);
  f.target.enemies.push(defender);
  f.scope.Game.creeps.raid_interceptor_0.pos = new f.Position(48, 24, f.target.name);
  f.overlord.run();
  assert.equal(f.memory.lure.mode, "fighting");
  assert.equal(f.memory.lure.engagement.canWin, true);
  assert.equal(f.memory.lure.engagement.friendlyDamage, 100);
  assert.equal(f.memory.lure.engagement.enemyDamage, 150);
  assert.ok(!f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name));
  assert.ok(
    f.calls.some((c) => c.role === "tank" && c.action === "attack" && c.object === defender),
  );
  assert.ok(f.calls.some((c) => c.role === "interceptor" && c.action === "rangedAttack"));
  f.scope.Game.creeps.raid_medic_0.hits -= 100;
  f.scope.Game.creeps.raid_interceptor_0.hits -= 200;
  f.calls.length = 0;
  f.overlord.run();
  assert.equal(f.memory.lure.mode, "fighting");
  assert.ok(!f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name));
});

test("remote support and destroyed or boosted parts cannot create a false winning assessment", () => {
  for (const scenario of ["remote", "damaged", "boosted"]) {
    const f = nextRound();
    f.scope.Game.creeps.raid_tank_0.pos = new f.Position(47, 25, f.target.name);
    const defender = f.enemy(C.ATTACK);
    defender.body = [
      ...Array.from({ length: 5 }, () => ({
        type: C.ATTACK,
        hits: 100,
        ...(scenario === "boosted" ? { boost: "XUH2O" } : {}),
      })),
      ...Array.from({ length: 5 }, () => ({ type: C.MOVE, hits: 100 })),
    ];
    defender.pos = new f.Position(46, 25, f.target.name);
    f.target.enemies.push(defender);
    const guard = f.scope.Game.creeps.raid_interceptor_0;
    if (scenario !== "remote") guard.pos = new f.Position(48, 24, f.target.name);
    if (scenario === "damaged")
      for (const p of guard.body) if (p.type === C.RANGED_ATTACK) p.hits = 0;
    if (scenario === "boosted") f.scope.BOOSTS = { [C.ATTACK]: { XUH2O: { attack: 4 } } };
    f.overlord.run();
    assert.equal(f.memory.lure.mode, "pulling", scenario);
    assert.equal(f.memory.lure.engagement.canWin, false, scenario);
    if (scenario === "boosted") assert.equal(f.memory.lure.engagement.enemyDamage, 600);
  }
});

test("tower refill ends even a winning field fight and recovers its escort and breaker", () => {
  const f = nextRound();
  f.memory.lure = { mode: "fighting", since: 99, attempts: 1, noPursuit: 0 };
  f.tower.store.energy = 10;
  f.creep("breaker", f.target.name, 48, 24);
  f.overlord.run();
  for (const role of ["tank", "medic", "breaker"])
    assert.ok(
      f.calls.some((c) => c.role === role && c.destination?.roomName === f.staging.name),
      role,
    );
  assert.equal(f.memory.stopReason, undefined);
});

test("a bait return without a follower records failure instead of reporting a successful lure", () => {
  const f = nextRound();
  f.memory.lure = { mode: "pulling", since: 80, probeStarted: 70, attempts: 1, noPursuit: 0 };
  f.scope.Game.creeps.raid_tank_0.pos = new f.Position(2, 25, f.staging.name);
  f.overlord.run();
  assert.equal(f.memory.lure.noPursuit, 1);
  assert.equal(f.memory.lure.mode, "pressure");
  assert.equal(f.memory.lure.arenaAttackAt, undefined);
  assert.equal(f.memory.stopReason, undefined);
});

test("an unresponsive core never draws the squad beyond its probe or consumes endless replacements", () => {
  const f = nextRound();
  f.target.enemies.push(f.enemy(C.ATTACK));
  f.overlord.run();
  assert.equal(f.memory.lure.mode, "pressure");
  assert.ok(!f.calls.some((c) => c.destination?.x === 30));
  f.scope.Game.time += 120;
  f.memory.lastSeen = f.scope.Game.time - 1;
  f.overlord.run();
  assert.equal(f.memory.stopReason, "no reachable pressure target or demonstrated pursuit");
  assert.equal(f.api.raidCommitted(f.memory), 0);
  assert.equal(f.memory.lure.arenaAttackAt, undefined);
});

test("the complete unboosted wave costs 9480 and every fixed body fits RCL6", () => {
  const f = fixture();
  assert.equal(
    f.api.RAID_ROLES.filter(
      (role: string) => role !== "skirmisher" && !f.api.RAID_REINFORCEMENT_ROLES.includes(role),
    ).reduce((n: number, role: string) => n + f.api.raidBodyCost(f.api.raidBody(role)), 0),
    9480,
  );
  for (const role of f.api.RAID_ROLES) {
    assert.ok(f.api.raidBody(role).length <= 50);
    assert.ok(f.api.raidBodyCost(f.api.raidBody(role)) <= 2300);
  }
  assert.equal(f.api.raidBody("tank").at(-1), C.MOVE);
});

test("attrition gets a spawn window before routine transports while keeping essential economy ahead", () => {
  const f = fixture("attrition");
  f.overlord.init();
  assert.equal(f.queue[0].priority, 505);
  assert.equal(fixture().overlord.priority, 590);
  f.colony.storage.store.energy = 149999;
  f.queue.length = 0;
  f.overlord.init();
  assert.equal(f.queue.length, 0);
});

test("reinforced bodies cost 17110 while a default raid remains a 9480 wave", () => {
  const f = fixture();
  assert.equal(
    f.api.RAID_ROLES.filter((role: string) => role !== "skirmisher").reduce(
      (n: number, role: string) => n + f.api.raidBodyCost(f.api.raidBody(role)),
      0,
    ),
    17110,
  );
});

test("extra medical and tank slots require an explicit attrition reinforcement order", () => {
  for (const authorized of [false, true]) {
    const f = fixture("attrition");
    f.memory.budget = 30000;
    f.memory.reinforcements = authorized;
    for (const role of ["medic", "tank", "interceptor"]) {
      f.creep(role);
      f.api.reserveRaidSpawn(f.memory, role, f.proto(role));
      f.api.settleRaidSpawn(f.memory, f.proto(role).name, C.OK);
    }
    f.overlord.init();
    assert.equal(f.queue.length, authorized ? 1 : 0);
    if (authorized) {
      assert.equal(f.queue[0].setup.role, "raid_supportMedicA");
      assert.equal(f.queue[0].options.beforeSpawn(f.proto("supportMedicA")), true);
      assert.equal(f.api.raidCommitted(f.memory), 7830);
    }
  }
});

test("four medics heal the staged tank while the extra tank can keep draining", () => {
  const f = fixture("attrition");
  f.memory.reinforcements = true;
  f.memory.phase = "draining";
  const tank = f.creep("tank");
  tank.hits -= 750;
  f.creep("medic", f.staging.name, 3, 25);
  f.creep("supportMedicA", f.staging.name, 1, 25);
  f.creep("supportMedicB", f.staging.name, 3, 26);
  f.creep("supportMedicC", f.staging.name, 1, 26);
  f.creep("interceptor", f.staging.name, 4, 25);
  f.creep("extraTank", f.staging.name, 2, 26);
  f.overlord.run();
  assert.equal(f.calls.filter((c) => c.action === "heal" && c.object === tank.creep).length, 4);
  assert.ok(
    f.calls.some((c) => c.role === "extraTank" && c.destination?.roomName === f.memory.target),
  );
  assert.ok(!f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
  assert.equal(f.memory.stopReason, undefined);
});

test("reinforcements use distinct walkable staging stations and any ready medic can support a tank", () => {
  const f = fixture("attrition");
  f.memory.reinforcements = true;
  for (const role of ["supportMedicA", "supportMedicB", "supportMedicC", "extraTank"])
    f.creep(role);
  f.scope.Game.creeps.raid_extraTank_0.hits--;
  f.overlord.run();
  for (const [role, x, y] of [
    ["supportMedicA", 1, 25],
    ["supportMedicB", 3, 26],
    ["supportMedicC", 1, 26],
    ["extraTank", 2, 26],
  ]) {
    assert.ok(
      f.calls.some((c) => c.role === role && c.destination?.x === x && c.destination?.y === y),
    );
  }
  f.creep("interceptor", f.staging.name, 4, 25);
  f.scope.Game.creeps.raid_extraTank_0.hits = f.scope.Game.creeps.raid_extraTank_0.hitsMax;
  f.calls.length = 0;
  f.overlord.run();
  assert.ok(
    f.calls.some((c) => c.role === "extraTank" && c.destination?.roomName === f.memory.target),
  );
});

test("local staging blocks exits and pushing while explicit tank crossing stays allowed", () => {
  const f = fixture("attrition");
  f.memory.reinforcements = true;
  f.creep("medic", f.staging.name, 3, 25);
  const support = f.creep("supportMedicA", f.staging.name, 1, 25);
  support.hits -= 150;
  f.creep("tank");
  f.creep("interceptor", f.staging.name, 4, 25);
  f.overlord.run();
  const staging = f.calls.filter(
    (c) => c.action === "move" && c.destination?.roomName === f.staging.name,
  );
  assert.ok(staging.length > 0);
  for (const call of staging) {
    assert.equal(call.options.noPush, true);
    assert.equal(call.options.pathOpts.blockExits, true);
    assert.equal(call.options.pathOpts.blockCreeps, true);
    assert.equal(call.options.pathOpts.maxRooms, 1);
  }
  const crossing = f.calls.find(
    (c) => c.role === "tank" && c.destination?.roomName === f.memory.target,
  );
  assert.ok(crossing);
  assert.equal(crossing.options.noPush, true);
  assert.equal(crossing.options.pathOpts.blockExits, false);
  assert.equal(crossing.options.pathOpts.maxRooms, f.memory.route.length);
});

test("reinforced medics heal an edge casualty without following it onto the exit", () => {
  const f = fixture("attrition");
  f.memory.reinforcements = true;
  const casualty = f.creep("supportMedicC", f.staging.name, 0, 26);
  casualty.hits -= 150;
  f.creep("medic", f.staging.name, 3, 25);
  f.creep("supportMedicA", f.staging.name, 1, 25);
  f.overlord.run();
  assert.ok(
    f.calls.some(
      (c) => (c.action === "heal" || c.action === "rangedHeal") && c.object === casualty.creep,
    ),
  );
  assert.ok(!f.calls.some((c) => c.action === "move" && c.destination?.x === 0));
  assert.ok(
    f.calls.some(
      (c) => c.role === "supportMedicA" && c.destination?.x === 1 && c.destination?.y === 25,
    ),
  );
});

test("three staged medics support a sustained low-tower border probe until half health", () => {
  const f = fixture("attrition");
  f.memory.reinforcements = true;
  f.memory.phase = "draining";
  for (const role of ["medic", "supportMedicA", "supportMedicB", "supportMedicC"]) f.creep(role);
  f.creep("interceptor", f.staging.name, 4, 25);
  const tank = f.creep("tank", f.memory.target, 48, 25);
  tank.hits = 3000;
  f.target.enemies.push(f.enemy(C.ATTACK));
  f.overlord.run();
  assert.ok(!f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name));
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
  tank.hits = 2100;
  f.calls.length = 0;
  f.overlord.run();
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name));
  assert.equal(f.memory.stopReason, undefined);
});

test("border probes exit immediately with more towers, insufficient medics or a nearby defender", () => {
  for (const scenario of ["towers", "medics", "remoteMedic", "defender"]) {
    const f = fixture("attrition");
    f.memory.reinforcements = true;
    f.memory.phase = "draining";
    const tank = f.creep("tank", f.memory.target, 48, 25);
    tank.hits = 3000;
    for (const role of ["medic", "supportMedicA", "supportMedicB"]) f.creep(role);
    if (scenario === "towers")
      f.target.structures.push(
        f.structure(C.STRUCTURE_TOWER, 8, 15, 100),
        f.structure(C.STRUCTURE_TOWER, 9, 17, 100),
      );
    if (scenario === "medics") f.scope.Game.creeps.raid_supportMedicB_0.spawning = true;
    if (scenario === "remoteMedic")
      f.scope.Game.creeps.raid_supportMedicB_0.pos = new f.Position(25, 4, f.staging.name);
    if (scenario === "defender") {
      const enemy = f.enemy(C.ATTACK);
      enemy.pos = new f.Position(45, 25, f.memory.target);
      f.target.enemies.push(enemy);
    }
    f.overlord.run();
    assert.ok(
      f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name),
      scenario,
    );
    assert.equal(f.memory.stopReason, undefined);
  }
});

test("a reinforced melee squad keeps pressure after losing its unaffordable interceptor", () => {
  const f = fixture("attrition");
  f.memory.reinforcements = true;
  f.memory.phase = "draining";
  f.creep("tank");
  f.creep("extraTank", f.staging.name, 2, 26);
  for (const role of ["medic", "supportMedicA", "supportMedicB"]) f.creep(role);
  f.overlord.run();
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
  assert.equal(f.memory.stopReason, undefined);
});

test("the 600-energy emergency guard fits the last 830 without exceeding the 30000 budget", () => {
  const f = fixture("attrition");
  f.memory.budget = 30000;
  f.memory.reinforcements = true;
  f.memory.phase = "draining";
  f.memory.supportEnergy = 29170;
  f.creep("tank");
  for (const role of ["medic", "supportMedicA", "supportMedicB"]) f.creep(role);
  f.overlord.init();
  assert.equal(f.queue[0].setup.role, "raid_skirmisher");
  assert.equal(f.api.raidBodyCost(f.api.raidBody("skirmisher")), 600);
  assert.equal(f.queue[0].options.beforeSpawn(f.proto("skirmisher")), true);
  f.api.settleRaidSpawn(f.memory, "raid_skirmisher_0", C.OK);
  f.creep("skirmisher", f.home.name, 29, 40);
  f.overlord.run();
  assert.equal(f.memory.status.spent, 29770);
  assert.equal(f.memory.status.remaining, 230);
  assert.equal(f.memory.stopReason, undefined);
});

test("ranged guards hold the arena while enemy towers exist and fire on pursuing defenders", () => {
  for (const role of ["interceptor", "skirmisher"]) {
    const f = fixture("attrition");
    f.memory.reinforcements = true;
    f.memory.phase = "breaching";
    f.memory.lastSeen = 99;
    f.memory.coldSince = 90;
    f.tower.store.energy = 0;
    f.target.enemies.push(f.enemy(C.WORK));
    f.creep(role, f.staging.name, 4, 25);
    f.overlord.run();
    assert.ok(!f.calls.some((c) => c.role === role && c.destination?.roomName === f.memory.target));
    const defender = f.enemy(C.ATTACK);
    defender.pos = new f.Position(1, 25, f.staging.name);
    f.staging.enemies.push(defender);
    f.calls.length = 0;
    f.overlord.run();
    assert.ok(
      f.calls.some((c) => c.role === role && c.action === "rangedAttack" && c.object === defender),
    );
    assert.equal(f.memory.stopReason, undefined);
  }
});

test("supported border probes do not make the other healthy tank wait for every scratch", () => {
  const f = fixture("attrition");
  f.memory.reinforcements = true;
  f.memory.phase = "draining";
  for (const role of ["medic", "supportMedicA", "supportMedicB"]) f.creep(role);
  const primary = f.creep("tank", f.memory.target, 48, 25);
  primary.hits = 3000;
  f.creep("extraTank", f.staging.name, 2, 26);
  f.overlord.run();
  assert.ok(
    f.calls.some((c) => c.role === "extraTank" && c.destination?.roomName === f.memory.target),
  );
  primary.hits = 2000;
  f.calls.length = 0;
  f.overlord.run();
  assert.ok(
    !f.calls.some((c) => c.role === "extraTank" && c.destination?.roomName === f.memory.target),
  );
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name));
});

test("a successful reservation survives reset and duplicate role requests cannot spend twice", () => {
  const f = fixture(),
    p = f.proto("tank");
  assert.equal(f.api.reserveRaidSpawn(f.memory, "tank", p), true);
  assert.equal(f.api.raidCommitted(f.memory), 1330);
  f.scope.Game.creeps[p.name] = {};
  f.scope.Game.time++;
  const restored = JSON.parse(JSON.stringify(f.memory));
  f.api.reconcileRaidSpawns(restored);
  assert.equal(restored.receipts[0].state, "spawned");
  assert.equal(f.api.reserveRaidSpawn(restored, "tank", p), false);
  assert.equal(f.api.raidCommitted(restored), 1330);
});

test("failed spawn intents cost nothing; a smaller budget rejects the entire next body", () => {
  const f = fixture();
  f.api.reserveRaidSpawn(f.memory, "medic", f.proto("medic"));
  f.api.settleRaidSpawn(f.memory, "raid_medic_0", C.ERR_NOT_ENOUGH_ENERGY);
  assert.equal(f.api.raidCommitted(f.memory), 0);
  f.memory.budget = 3000;
  f.api.reserveRaidSpawn(f.memory, "medic", f.proto("medic"));
  f.api.settleRaidSpawn(f.memory, "raid_medic_0", C.OK);
  assert.equal(f.api.reserveRaidSpawn(f.memory, "tank", f.proto("tank")), false);
  assert.equal(f.memory.phase, "retreating");
  assert.equal(f.api.raidCommitted(f.memory), 2100);
});

test("an interrupted spawn consumes its reservation and permanently stops recruitment", () => {
  const f = fixture();
  f.api.reserveRaidSpawn(f.memory, "tank", f.proto("tank"));
  f.scope.Game.time++;
  f.api.reconcileRaidSpawns(f.memory);
  assert.equal(f.memory.receipts[0].state, "uncertain");
  assert.equal(f.api.raidCommitted(f.memory), 1330);
  f.overlord.init();
  assert.equal(f.queue.length, 0);
});

test("lost issued units are never automatically replaced", () => {
  const f = fixture();
  f.api.reserveRaidSpawn(f.memory, "tank", f.proto("tank"));
  f.api.settleRaidSpawn(f.memory, "raid_tank_0", C.OK);
  f.scope.Game.time += 2;
  f.overlord.init();
  assert.match(f.memory.stopReason, /lost tank/);
  assert.equal(f.queue.length, 0);
});

test("home tower healing uses the same hard cap and never charges failed or duplicate actions", () => {
  const f = fixture(),
    p = f.proto("medic");
  f.api.reserveRaidSpawn(f.memory, "medic", p);
  f.api.settleRaidSpawn(f.memory, p.name, C.OK);
  f.scope.Memory.flags = { raid: { raid: f.memory } };
  f.memory.supportEnergy = 7890;
  let healingCalls = 0;
  const tower = {
    id: "homeTower",
    heal: () => {
      healingCalls++;
      return C.OK;
    },
  };
  const target = { name: p.name, memory: { O: "raid>raid" } };
  assert.equal(f.api.healWithRaidBudget(tower, target), C.OK);
  assert.equal(f.api.raidCommitted(f.memory), 10000);
  assert.equal(f.api.healWithRaidBudget(tower, target), C.OK);
  assert.equal(healingCalls, 1);
  f.scope.Game.time++;
  assert.equal(f.api.healWithRaidBudget(tower, target), C.ERR_NOT_ENOUGH_RESOURCES);
  assert.equal(healingCalls, 1);
  assert.equal(f.api.raidCommitted(f.memory), 10000);
});

test("failed home healing releases its charge and ordinary allies retain native behavior", () => {
  const f = fixture(),
    p = f.proto("medic");
  f.api.reserveRaidSpawn(f.memory, "medic", p);
  f.api.settleRaidSpawn(f.memory, p.name, C.OK);
  f.scope.Memory.flags = { raid: { raid: f.memory } };
  const tower = { id: "homeTower", heal: () => C.ERR_NOT_ENOUGH_RESOURCES };
  assert.equal(
    f.api.healWithRaidBudget(tower, { name: p.name, memory: { O: "raid>raid" } }),
    C.ERR_NOT_ENOUGH_RESOURCES,
  );
  assert.equal(f.api.raidCommitted(f.memory), 2100);
  assert.equal(
    f.api.healWithRaidBudget(tower, { name: "queen", memory: { O: "E58S42>queen" } }),
    undefined,
  );
});

test("an authorized 20000 cap permits spending past 10000 but rejects overspending", () => {
  const f = fixture("attrition");
  f.memory.budget = 20000;
  f.memory.supportEnergy = 17000;
  assert.equal(f.api.reserveRaidSpawn(f.memory, "medic", f.proto("medic")), true);
  f.api.settleRaidSpawn(f.memory, "raid_medic_0", C.OK);
  f.creep("medic");
  f.api.reconcileRaidSpawns(f.memory);
  assert.equal(f.memory.stopReason, undefined);
  assert.equal(f.api.raidCommitted(f.memory), 19100);
  f.overlord.run();
  assert.equal(f.memory.status.remaining, 900);
  assert.equal(f.api.reserveRaidSpawn(f.memory, "tank", f.proto("tank")), false);
  assert.equal(f.memory.stopReason, undefined);
  assert.equal(f.memory.recruitmentPaused.remaining, 900);
  assert.equal(f.api.raidCommitted(f.memory), 19100);
});

test("home healing continues to respect an order limited to 20000", () => {
  const f = fixture("attrition"),
    p = f.proto("medic");
  f.memory.budget = 20000;
  f.api.reserveRaidSpawn(f.memory, "medic", p);
  f.api.settleRaidSpawn(f.memory, p.name, C.OK);
  f.memory.supportEnergy = 17890;
  f.scope.Memory.flags = { raid: { raid: f.memory } };
  const tower = { id: "homeTower", heal: () => C.OK };
  const target = { name: p.name, memory: { O: "raid>raid" } };
  assert.equal(f.api.healWithRaidBudget(tower, target), C.OK);
  assert.equal(f.api.raidCommitted(f.memory), 20000);
  f.scope.Game.time++;
  assert.equal(f.api.healWithRaidBudget(tower, target), C.ERR_NOT_ENOUGH_RESOURCES);
  assert.equal(f.api.raidCommitted(f.memory), 20000);
});

test("an authorized 30000 order permits recruitment past 20000 and caps all support spending", () => {
  const f = fixture("attrition"),
    p = f.proto("medic");
  f.memory.budget = 30000;
  f.memory.supportEnergy = 25000;
  assert.equal(f.api.reserveRaidSpawn(f.memory, "medic", p), true);
  f.api.settleRaidSpawn(f.memory, p.name, C.OK);
  f.creep("medic");
  f.api.reconcileRaidSpawns(f.memory);
  assert.equal(f.memory.stopReason, undefined);
  assert.equal(f.api.raidCommitted(f.memory), 27100);
  f.overlord.run();
  assert.equal(f.memory.status.remaining, 2900);
  f.memory.budget = 50000;
  f.memory.supportEnergy = 27890;
  f.scope.Memory.flags = { raid: { raid: f.memory } };
  const tower = { id: "homeTower", heal: () => C.OK };
  const target = { name: p.name, memory: { O: "raid>raid" } };
  assert.equal(f.api.healWithRaidBudget(tower, target), C.OK);
  assert.equal(f.api.raidCommitted(f.memory), 30000);
  f.scope.Game.time++;
  assert.equal(f.api.healWithRaidBudget(tower, target), C.ERR_NOT_ENOUGH_RESOURCES);
  assert.equal(f.api.raidCommitted(f.memory), 30000);
});

test("an aging attrition medic goes home while a charged replacement takes over without ending the raid", () => {
  const f = fixture("attrition");
  f.memory.budget = 20000;
  f.memory.phase = "draining";
  for (const role of ["medic", "tank", "interceptor"]) {
    f.creep(role);
    f.api.reserveRaidSpawn(f.memory, role, f.proto(role));
    f.api.settleRaidSpawn(f.memory, f.proto(role).name, C.OK);
  }
  f.scope.Game.creeps.raid_medic_0.ticksToLive = 349;
  f.overlord.init();
  assert.equal(f.memory.phase, "draining");
  assert.equal(f.memory.stopReason, undefined);
  assert.deepEqual(f.memory.replacing, ["raid_medic_0"]);
  assert.equal(f.memory.retiring, undefined);
  assert.equal(f.queue[0].setup.role, "raid_medic");
  const replacement = f.proto("medic", "raid_medic_1");
  assert.equal(f.queue[0].options.beforeSpawn(replacement), true);
  f.api.settleRaidSpawn(f.memory, replacement.name, C.OK);
  const fresh = f.creep("medic", "E58S43", 25, 25, 1);
  // Production enumeration/cache rebuilds may place the new creep before its veteran.
  f.overlord.groups.medic.reverse();
  f.overlord.run();
  assert.equal(f.overlord.unit("medic").name, "raid_medic_0");
  assert.equal(f.memory.retiring, undefined);
  assert.ok(
    f.calls.some((c) => c.name === "raid_tank_0" && c.destination?.roomName === f.memory.target),
  );
  assert.ok(
    f.calls.some((c) => c.name === fresh.name && c.destination?.roomName === f.staging.name),
  );
  assert.ok(
    !f.calls.some((c) => c.name === "raid_medic_0" && c.destination?.roomName === f.home.name),
  );
  fresh.pos = new f.Position(3, 25, f.staging.name);
  fresh.room = f.staging;
  f.calls.length = 0;
  f.overlord.run();
  assert.equal(f.overlord.unit("medic"), fresh);
  assert.equal(f.api.raidCommitted(f.memory), 7830);
  assert.ok(
    f.calls.some((c) => c.name === "raid_medic_0" && c.destination?.roomName === f.home.name),
  );
  assert.ok(
    !f.calls.some((c) => c.name === "raid_tank_0" && c.destination?.roomName === f.home.name),
  );
  assert.equal(f.memory.stopReason, undefined);
});

test("retired names are released before reuse and legacy raids retain lifetime withdrawal", () => {
  const f = fixture("attrition");
  f.memory.retiring = ["raid_medic_0"];
  f.memory.replacing = ["raid_medic_0"];
  f.api.reconcileRaidSpawns(f.memory);
  assert.deepEqual(f.memory.retiring, []);
  assert.deepEqual(f.memory.replacing, []);
  assert.equal(f.api.reserveRaidSpawn(f.memory, "medic", f.proto("medic")), true);
  f.api.settleRaidSpawn(f.memory, "raid_medic_0", C.OK);
  f.creep("medic");
  assert.equal(f.api.raidHasRole(f.memory, "medic"), true);
  const legacy = fixture();
  legacy.creep("medic").ticksToLive = 249;
  legacy.overlord.init();
  assert.equal(legacy.memory.stopReason, "lifetime reserve for withdrawal");
});

test("delayed attrition relief keeps its military veteran on duty instead of opening a gap", () => {
  const f = fixture("attrition");
  f.memory.budget = 20000;
  f.memory.phase = "draining";
  const medic = f.creep("medic");
  medic.ticksToLive = 199;
  f.creep("tank");
  f.creep("interceptor");
  f.overlord.init();
  f.overlord.run();
  assert.equal(f.memory.phase, "draining");
  assert.equal(f.memory.stopReason, undefined);
  assert.equal(f.memory.retiring, undefined);
  assert.equal(f.overlord.unit("medic"), medic);
  assert.ok(!f.calls.some((c) => c.name === medic.name && c.destination?.roomName === f.home.name));
  assert.ok(
    f.calls.some((c) => c.name === "raid_tank_0" && c.destination?.roomName === f.memory.target),
  );
});

test("an aging loaded hauler reserves time to unload even when its relief is delayed", () => {
  const f = fixture("attrition");
  f.memory.phase = "looting";
  const hauler = f.creep("hauler");
  hauler.ticksToLive = 199;
  hauler.store.U = 100;
  f.overlord.init();
  f.overlord.run();
  assert.equal(f.memory.stopReason, undefined);
  assert.deepEqual(f.memory.retiring, [hauler.name]);
  assert.ok(f.calls.some((c) => c.name === hauler.name && c.destination?.roomName === f.home.name));
});

test("a missed vision tick restarts the empty-tower observation period", () => {
  const f = fixture();
  f.memory.phase = "draining";
  f.memory.coldSince = 90;
  f.memory.lastSeen = 98;
  f.tower.store.energy = 0;
  f.overlord.run();
  assert.equal(f.memory.coldSince, 100);
  assert.equal(f.memory.phase, "draining");
});

test("safe mode and any visible battle reinforcement stop the wave before queueing", () => {
  for (const part of [C.ATTACK, C.RANGED_ATTACK, C.HEAL, C.CLAIM]) {
    const f = fixture();
    f.target.enemies.push(f.enemy(part));
    f.overlord.init();
    assert.equal(f.memory.phase, "retreating");
    assert.equal(f.queue.length, 0);
  }
  const f = fixture();
  f.target.controller.safeMode = 20000;
  f.overlord.init();
  assert.equal(f.memory.stopReason, "enemy safe mode");
  assert.equal(f.queue.length, 0);
});

test("civilian workers and allies do not masquerade as battle reinforcements", () => {
  const f = fixture();
  f.target.enemies.push(f.enemy(C.WORK), f.enemy(C.HEAL, "ally"));
  f.overlord.init();
  assert.equal(f.memory.phase, "assembling");
  assert.equal(f.queue.length, 1);
  assert.equal(f.queue[0].setup.role, "raid_medic");
});

test("attrition accepts target defenders and pursuers but retains approach and safe mode stops", () => {
  for (const where of ["target", "staging"]) {
    const f = fixture();
    f.memory.tactics = "attrition";
    f[where as "target" | "staging"].enemies.push(f.enemy(C.ATTACK));
    f.overlord.init();
    assert.equal(f.memory.phase, "assembling");
    assert.equal(f.queue.length, 1);
  }
  const f = fixture();
  f.memory.tactics = "attrition";
  f.home.enemies.push(f.enemy(C.ATTACK));
  f.overlord.init();
  assert.equal(f.memory.phase, "retreating");
  const safe = fixture();
  safe.memory.tactics = "attrition";
  safe.target.controller.safeMode = 100;
  safe.overlord.init();
  assert.equal(safe.memory.stopReason, "enemy safe mode");
});

test("attrition pulls the tank out of tower cover and fights the pursuer in staging", () => {
  const f = fixture();
  f.memory.tactics = "attrition";
  f.memory.phase = "draining";
  const tank = f.creep("tank", f.memory.target, 48, 25);
  f.creep("medic");
  const interceptor = f.creep("interceptor", f.memory.staging.roomName, 4, 25);
  f.target.enemies.push(f.enemy(C.ATTACK));
  f.overlord.run();
  assert.equal(f.memory.phase, "draining");
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name));
  f.target.enemies = [];
  const defender = f.enemy(C.ATTACK);
  defender.pos = new f.Position(3, 25, f.staging.name);
  f.staging.enemies.push(defender);
  tank.pos = new f.Position(2, 25, f.staging.name);
  tank.room = f.staging;
  interceptor.hits -= 200;
  f.calls.length = 0;
  f.overlord.run();
  assert.equal(f.memory.stopReason, undefined);
  assert.ok(
    f.calls.some(
      (c) => c.role === "interceptor" && c.action === "rangedAttack" && c.object === defender,
    ),
  );
  assert.ok(
    f.calls.some(
      (c) => c.role === "interceptor" && c.action === "kite" && c.options.pathOpts.maxRooms === 1,
    ),
  );
  assert.ok(f.calls.some((c) => c.role === "tank" && c.action === "attack"));
  assert.ok(!f.calls.some((c) => c.destination?.roomName === f.memory.target));
});

test("attrition damage causes local recovery and a fully healed team resumes pressure", () => {
  const f = fixture();
  f.memory.tactics = "attrition";
  f.memory.phase = "draining";
  const tank = f.creep("tank");
  f.creep("medic");
  const interceptor = f.creep("interceptor", f.memory.target, 48, 25);
  interceptor.hits -= 100;
  f.overlord.run();
  assert.equal(f.memory.stopReason, undefined);
  assert.ok(
    f.calls.some((c) => c.role === "interceptor" && c.destination?.roomName === f.staging.name),
  );
  assert.ok(!f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
  interceptor.pos = new f.Position(4, 25, f.staging.name);
  interceptor.room = f.staging;
  interceptor.hits = interceptor.hitsMax;
  f.calls.length = 0;
  f.overlord.run();
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
  assert.equal(tank.hits, tank.hitsMax);
});

test("attrition waits for the interceptor to reach firing position, not just the staging room", () => {
  const f = fixture("attrition");
  f.creep("tank");
  f.creep("medic");
  const interceptor = f.creep("interceptor", f.staging.name, 25, 4);
  f.overlord.run();
  assert.ok(!f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
  interceptor.pos = new f.Position(4, 25, f.staging.name);
  f.calls.length = 0;
  f.overlord.run();
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
});

test("attrition replacements retain the cost of lost units and cannot exceed the additional cap", () => {
  const f = fixture();
  f.memory.tactics = "attrition";
  f.api.reserveRaidSpawn(f.memory, "medic", f.proto("medic"));
  f.api.settleRaidSpawn(f.memory, "raid_medic_0", C.OK);
  f.scope.Game.time += 2;
  f.overlord.init();
  assert.equal(f.memory.stopReason, undefined);
  assert.equal(f.queue[0].setup.role, "raid_medic");
  assert.equal(f.queue[0].options.beforeSpawn(f.proto("medic", "replacement")), true);
  assert.equal(f.api.raidCommitted(f.memory), 4200);
  f.api.settleRaidSpawn(f.memory, "replacement", C.OK);
  f.memory.supportEnergy = 5800;
  assert.equal(f.api.reserveRaidSpawn(f.memory, "tank", f.proto("tank")), false);
  assert.equal(f.memory.stopReason, undefined);
  assert.equal(f.api.raidCommitted(f.memory), 10000);
});

test("an attrition army keeps fighting when no new body fits the remaining budget", () => {
  const f = fixture("attrition");
  f.memory.budget = 30000;
  f.memory.supportEnergy = 29170;
  f.memory.phase = "draining";
  f.memory.reinforcements = true;
  for (const role of ["medic", "tank", "interceptor"]) f.creep(role);
  f.overlord.init();
  f.overlord.run();
  assert.equal(f.queue.length, 0);
  assert.equal(f.memory.stopReason, undefined);
  assert.equal(f.memory.status.remaining, 830);
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
  for (const group of Object.values(f.overlord.groups) as TestScope[][]) group.length = 0;
  f.scope.Game.creeps = {};
  f.overlord.init();
  f.overlord.run();
  assert.equal(f.memory.phase, "complete");
  assert.equal(f.memory.stopReason, "budget limit");
});

test("reinforced breakers may stage before the window but enter only after towers and defenders are clear", () => {
  const f = fixture("attrition");
  f.memory.budget = 30000;
  f.memory.phase = "draining";
  f.memory.reinforcements = true;
  for (const role of f.api.RAID_ROLES.filter((r: string) => r !== "breaker" && r !== "hauler")) {
    f.creep(role);
    f.api.reserveRaidSpawn(f.memory, role, f.proto(role));
    f.api.settleRaidSpawn(f.memory, f.proto(role).name, C.OK);
  }
  // The demolition budget must not be consumed by early tank relief.
  f.scope.Game.creeps.raid_tank_0.ticksToLive = 499;
  f.target.enemies.push(f.enemy(C.ATTACK));
  f.overlord.init();
  assert.equal(f.queue[0].setup.role, "raid_breaker");
  assert.equal(f.queue[0].options.beforeSpawn(f.proto("breaker")), true);
  f.api.settleRaidSpawn(f.memory, f.proto("breaker").name, C.OK);
  f.creep("breaker");
  f.overlord.run();
  assert.ok(
    f.calls.some((c) => c.role === "breaker" && c.destination?.x === 2 && c.destination?.y === 24),
  );
  assert.ok(
    !f.calls.some(
      (c) =>
        c.role === "breaker" &&
        (c.action === "dismantle" || c.destination?.roomName === f.memory.target),
    ),
  );
  f.tower.store.energy = 0;
  f.target.enemies = [];
  f.memory.coldSince = 90;
  f.calls.length = 0;
  f.overlord.run();
  assert.ok(
    f.calls.some((c) => c.role === "breaker" && c.destination?.roomName === f.memory.target),
  );
  assert.equal(f.memory.stopReason, undefined);
});

test("attrition blocks demolition recruitment while defenders remain despite empty towers", () => {
  const f = fixture();
  f.memory.tactics = "attrition";
  f.memory.phase = "breaching";
  f.memory.lastSeen = 99;
  f.memory.coldSince = 80;
  f.tower.store.energy = 0;
  for (const role of ["medic", "tank", "interceptor"]) {
    f.creep(role);
    f.api.reserveRaidSpawn(f.memory, role, f.proto(role));
    f.api.settleRaidSpawn(f.memory, f.proto(role).name, C.OK);
  }
  f.target.enemies.push(f.enemy(C.ATTACK));
  f.overlord.init();
  assert.equal(f.queue.length, 0);
  assert.equal(f.memory.stopReason, undefined);
  const breaker = f.creep("breaker", f.memory.target, 48, 25);
  f.overlord.run();
  assert.ok(
    f.calls.some((c) => c.role === "breaker" && c.destination?.roomName === f.staging.name),
  );
  assert.ok(!f.calls.some((c) => c.role === "breaker" && c.action === "dismantle"));
  assert.equal(breaker.hits, breaker.hitsMax);
});

test("attrition keeps pressuring through tower refills without the old no-progress abort", () => {
  const f = fixture();
  f.memory.tactics = "attrition";
  f.memory.phase = "draining";
  f.memory.drainStarted = 1;
  f.memory.lastProgress = 1;
  f.memory.minimumTowerEnergy = 0;
  f.scope.Game.time = 500;
  f.overlord.run();
  assert.equal(f.memory.phase, "draining");
  assert.equal(f.memory.stopReason, undefined);
});

test("a neutral claimer in staging does not stall the attrition tank", () => {
  const f = fixture();
  f.memory.tactics = "attrition";
  f.staging.enemies.push(f.enemy(C.CLAIM, "neutral"));
  for (const role of ["medic", "tank", "interceptor"]) f.creep(role);
  f.overlord.run();
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
});

test("an attrition tank recovers even when wounded after towers become empty", () => {
  const f = fixture();
  f.memory.tactics = "attrition";
  f.memory.phase = "breaching";
  f.memory.coldSince = 80;
  f.memory.lastSeen = 99;
  f.tower.store.energy = 0;
  const tank = f.creep("tank", f.memory.target, 48, 25);
  tank.hits -= 100;
  f.overlord.run();
  assert.equal(f.memory.stopReason, undefined);
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name));
});

test("attrition observes empty towers continuously despite a distant defender, then opens the gate", () => {
  const f = fixture();
  f.memory.tactics = "attrition";
  f.memory.phase = "draining";
  f.tower.store.energy = 0;
  f.creep("tank", f.memory.target, 48, 25);
  f.target.enemies.push(f.enemy(C.ATTACK));
  const gate = f.structure(C.STRUCTURE_RAMPART, 47, 25, 0, 441);
  f.target.structures.push(gate);
  for (let tick = 0; tick <= 5; tick++) {
    f.calls.length = 0;
    f.overlord.run();
    assert.equal(f.memory.stopReason, undefined);
    assert.ok(
      !f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name),
    );
    assert.ok(f.calls.some((c) => c.role === "tank" && c.action === "attack" && c.object === gate));
    f.scope.Game.time++;
  }
  assert.equal(f.memory.phase, "breaching");
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.x === 47));
  f.target.structures = [f.tower];
  f.calls.length = 0;
  f.overlord.run();
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.x === 30));
});

test("sub-shot tower energy residues permit the observation window but ten energy closes it", () => {
  const f = fixture("attrition");
  f.memory.phase = "draining";
  f.tower.store.energy = 6;
  f.target.structures.push(f.structure(C.STRUCTURE_TOWER, 10, 17, 9));
  f.target.enemies.push(f.enemy(C.ATTACK));
  f.creep("tank", f.memory.target, 48, 25);
  for (let tick = 0; tick <= 5; tick++) {
    f.calls.length = 0;
    f.overlord.run();
    assert.ok(
      !f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name),
    );
    f.scope.Game.time++;
  }
  assert.equal(f.memory.towerEnergy, 15);
  assert.equal(f.memory.phase, "breaching");
  f.tower.store.energy = 10;
  f.overlord.run();
  assert.equal(f.memory.phase, "draining");
  assert.equal(f.memory.coldSince, undefined);
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.staging.name));
});

test("reinforcements on the approach and hostile power creeps trigger withdrawal", () => {
  const f = fixture();
  f.staging.enemies.push(f.enemy(C.ATTACK, "Invader"));
  f.overlord.init();
  assert.equal(f.queue.length, 0);
  assert.equal(f.memory.phase, "retreating");
  const p = fixture();
  p.target.powers.push({ name: "enemyOperator", owner: { username: "pcunning" } });
  p.overlord.init();
  assert.equal(p.queue.length, 0);
  assert.equal(p.memory.phase, "retreating");
});

test("breakers require five consecutive visible empty-tower ticks and refilling closes the window", () => {
  const f = fixture();
  f.memory.phase = "draining";
  for (const role of ["medic", "tank", "interceptor"]) {
    f.creep(role);
    f.api.reserveRaidSpawn(f.memory, role, f.proto(role));
    f.api.settleRaidSpawn(f.memory, f.proto(role).name, C.OK);
  }
  f.tower.store.energy = 0;
  f.overlord.init();
  assert.equal(f.queue.length, 0);
  for (let tick = 0; tick < 5; tick++) {
    f.scope.Game.time++;
    f.overlord.init();
  }
  assert.equal(f.queue[0].setup.role, "raid_breaker");
  f.tower.store.energy = 10;
  assert.equal(f.queue[0].options.beforeSpawn(f.proto("breaker")), false);
  assert.equal(f.memory.phase, "draining");
});

test("losing target vision invalidates permission to enter or recruit a breaker", () => {
  const f = fixture();
  f.memory.phase = "breaching";
  f.memory.coldSince = 80;
  f.memory.lastSeen = 99;
  f.memory.towerEnergy = 0;
  delete f.scope.Game.rooms[f.memory.target];
  f.overlord.run();
  assert.equal(f.memory.coldSince, undefined);
});

test("wounded tank returns across the border while medic remains outside tower fire", () => {
  const f = fixture();
  f.memory.phase = "draining";
  const tank = f.creep("tank", f.memory.target, 49, 25);
  tank.hits -= 900;
  f.creep("medic");
  f.creep("interceptor");
  f.overlord.run();
  assert.ok(
    f.calls.some(
      (c) =>
        c.action === "move" &&
        c.role === "tank" &&
        c.destination.roomName === f.memory.staging.roomName,
    ),
  );
  assert.ok(
    !f.calls.some(
      (c) =>
        c.action === "move" && c.role === "medic" && c.destination.roomName === f.memory.target,
    ),
  );
});

test("a healthy tank waits for its healer and interceptor before crossing", () => {
  const f = fixture();
  f.creep("tank");
  f.overlord.run();
  assert.ok(!f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
  f.creep("medic");
  f.creep("interceptor");
  f.calls.length = 0;
  f.overlord.run();
  assert.ok(f.calls.some((c) => c.role === "tank" && c.destination?.roomName === f.memory.target));
});

test("breakers in a different room can select and approach a core tower after the gate opens", () => {
  const f = fixture();
  f.memory.phase = "breaching";
  f.tower.store.energy = 0;
  f.memory.coldSince = 80;
  f.memory.lastSeen = 99;
  f.creep("breaker");
  f.overlord.run();
  assert.ok(
    f.calls.some((c) => c.role === "breaker" && c.destination?.roomName === f.memory.target),
  );
});

test("safe mode after queueing cancels actual recruitment and orders every unit home", () => {
  const f = fixture();
  f.creep("tank");
  f.creep("interceptor");
  f.overlord.init();
  assert.equal(f.queue.length, 1);
  f.target.controller.safeMode = 20000;
  assert.equal(f.queue[0].options.beforeSpawn(f.proto("medic")), false);
  f.overlord.run();
  assert.equal(f.api.raidCommitted(f.memory), 0);
  assert.equal(f.memory.phase, "retreating");
  assert.ok(
    f.calls.filter((c) => c.action === "move").every((c) => c.destination.roomName === "E58S42"),
  );
  f.target.controller.safeMode = 0;
  f.queue.length = 0;
  f.overlord.init();
  assert.equal(f.queue.length, 0);
});

test("protected loot waits for demolition instead of terminating prematurely", () => {
  const f = fixture();
  f.target.structures = [];
  f.memory.phase = "looting";
  f.memory.coldSince = 80;
  f.memory.lastSeen = 99;
  const terminal = f.structure(C.STRUCTURE_TERMINAL, 8, 17);
  terminal.store.U = 500;
  f.target.structures.push(terminal, f.structure(C.STRUCTURE_RAMPART, 8, 17));
  f.creep("hauler");
  f.overlord.run();
  assert.equal(f.memory.phase, "looting");
  assert.equal(f.memory.stopReason, undefined);
});

test("returning cargo unloads before recycling, and spent energy is not refunded", () => {
  const f = fixture();
  f.memory.phase = "retreating";
  const unit = f.creep("hauler", "E58S42", 23, 40);
  unit.store.U = 100;
  let recycled = 0;
  f.colony.spawns.push({ pos: unit.pos, recycleCreep: () => recycled++ });
  f.overlord.run();
  assert.equal(recycled, 0);
  assert.equal(f.memory.delivered.U, 100);
  unit.store.U = 0;
  f.overlord.run();
  assert.equal(recycled, 1);
});

const hatcherySource = classMembers("src/hiveClusters/hatchery.ts", "Hatchery", [
  "generateCreepName",
  "spawnCreep",
  "canSpawn",
  "generateProtoCreep",
  "spawnHighestPriorityCreep",
]);
function realHatchery(f: ReturnType<typeof fixture>, request: TestScope, result = C.OK) {
  const scope = {
    ...f.scope,
    ERR_ROOM_ENERGY_CAPACITY_NOT_ENOUGH: -20,
    ERR_SPECIFIED_SPAWN_BUSY: -21,
    ERR_SPAWN_REQUEST_CANCELLED: -22,
    MEM: { COLONY: "C", OVERLORD: "O", STATS: "S" },
    log: { error: () => {}, debug: () => {} },
    Overmind: { overlords: { "raid>raid": { memory: {} } } },
  };
  const code = ts.transpileModule(`class Hatchery {${hatcherySource}}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2024 },
  }).outputText;
  const H = new Function("scope", `with(scope){${code};return Hatchery}`)(scope);
  let actualSpawns = 0;
  const spawn = {
    id: "spawn",
    pos: { roomName: "E58S42" },
    spawnCreep: (_body: unknown, _name: string) => {
      actualSpawns++;
      assert.ok(f.api.raidCommitted(f.memory) <= 10000);
      if (request.overlord) assert.ok(f.api.raidCommitted(f.memory) > 0);
      return result;
    },
  };
  const hatchery = Object.assign(new H(), {
    colony: f.colony,
    room: { energyCapacityAvailable: 2300 },
    availableSpawns: [spawn],
    energyStructures: [],
    productionPriorities: [590],
    productionQueue: { 590: [request] },
  });
  request.overlord ||= { ref: "raid>raid", colony: f.colony };
  return { hatchery, actualSpawns: () => actualSpawns };
}

test("actual hatchery commits the reservation before spawn and records success exactly once", () => {
  const f = fixture();
  f.overlord.init();
  f.overlord.ref = "raid>raid";
  const r = realHatchery(f, f.queue[0]);
  assert.equal(r.hatchery.spawnHighestPriorityCreep(), C.OK);
  assert.equal(r.actualSpawns(), 1);
  assert.equal(f.api.raidCommitted(f.memory), 2100);
  assert.equal(f.memory.receipts[0].state, "spawned");
});

test("actual hatchery cancellation neither calls spawn nor prevents a lower-priority economy request", () => {
  const f = fixture();
  f.overlord.init();
  f.overlord.ref = "raid>raid";
  const r = realHatchery(f, f.queue[0]);
  f.api.stopRaid(f.memory, "cancelled");
  r.hatchery.productionPriorities.push(600);
  r.hatchery.productionQueue[600] = [
    {
      priority: 600,
      overlord: { ref: "raid>raid", colony: f.colony },
      setup: { role: "worker", create: () => ({ body: [C.MOVE], boosts: [] }) },
    },
  ];
  // The independent economy spawn must not rely on a raid reservation.
  r.hatchery.availableSpawns[0].spawnCreep = () => C.OK;
  assert.equal(r.hatchery.spawnHighestPriorityCreep(), C.OK);
  assert.equal(f.memory.receipts.length, 0);
});

test("actual failed hatchery spawn releases the reservation and returns its spawn", () => {
  const f = fixture();
  f.overlord.init();
  f.overlord.ref = "raid>raid";
  const r = realHatchery(f, f.queue[0], C.ERR_NOT_ENOUGH_ENERGY);
  assert.equal(r.hatchery.spawnHighestPriorityCreep(), C.ERR_NOT_ENOUGH_ENERGY);
  assert.equal(f.api.raidCommitted(f.memory), 0);
  assert.equal(f.memory.receipts[0].state, "failed");
  assert.equal(r.hatchery.availableSpawns.length, 1);
});
