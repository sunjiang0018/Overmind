import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import type { TestScope } from "./helpers/types";
import { constants } from "./helpers/constants";
import * as native from "../src/utilities/native";
import { createStore } from "./helpers/store";

function load(file: string, deps: TestScope, scope: TestScope = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2024,
      useDefineForClassFields: false,
      experimentalDecorators: true,
    },
  }).outputText;
  const out: TestScope = {};
  const globals = { ...constants, ...scope };
  new Function("scope", `with(scope){return function(exports,require){${code}}}`)(globals)(
    out,
    (n: string) =>
      n.endsWith("profiler/decorator")
        ? { profile: <T>(x: T) => x }
        : n.endsWith("utilities/native")
          ? native
          : deps[n] || {},
  );
  return out;
}

test("reclaimed colonies initialize retained defense memory between global resets", () => {
  const retained = { persistent: true, colonyDefense: { enabled: true, protectController: false } };
  const scope = {
    Game: { time: 101 },
    LATEST_GLOBAL_RESET_TICK: 100,
    Memory: { colonies: { E57S45: retained } },
    global: {},
  };
  const { Colony } = load(
    "src/Colony.ts",
    { "./memory/Memory": load("src/memory/Memory.ts", {}, scope) },
    scope,
  );
  Colony.prototype.build = () => {};
  const colony = new Colony(0, "E57S45", []);
  assert.equal(colony.memory, retained);
  assert.deepEqual(colony.memory.outposts, {});
  assert.deepEqual(colony.memory.defcon, { level: 0, tick: -Infinity });
  assert.deepEqual(colony.memory.expansionData, { possibleExpansions: {}, expiration: 0 });
  assert.equal(colony.memory.maxLevel, 0);
  colony.memory.maxLevel = 3;
  const rebuilt = new Colony(0, "E57S45", []);
  assert.equal(rebuilt.memory.maxLevel, 3);
  assert.equal(rebuilt.memory.persistent, true);
  assert.deepEqual(rebuilt.memory.colonyDefense, { enabled: true, protectController: false });
});

function defense() {
  let threats: TestScope[] = [],
    claims: TestScope[] = [];
  class Position {
    constructor(
      public x: number,
      public y: number,
      public roomName: string,
    ) {}
    isEqualTo(p: Position) {
      return p.x === this.x && p.y === this.y && p.roomName === this.roomName;
    }
  }
  const scope: TestScope = {
    Game: {
      time: 100,
      map: {
        getRoomTerrain: () => ({ get: (x: number, y: number) => (x === 40 && y === 40 ? 1 : 0) }),
      },
    },
    RoomPosition: Position,
  };
  const roomDeps = {
    getRoomDangerousPlayerHostiles: () => threats,
    getRoomClaimingPlayerHostiles: () => claims,
    getRoomPlayerHostiles: () => [...threats, ...claims],
  };
  const f = load("src/strategy/colonyDefense.ts", { "../game/Room": roomDeps }, scope);
  const colony: TestScope = {
    name: "E57S45",
    level: 1,
    memory: { colonyDefense: { enabled: true, rampartHits: 2500000 } },
    controller: {
      my: true,
      level: 1,
      pos: new Position(41, 41, "E57S45"),
      safeModeAvailable: 1,
      ticksToDowngrade: 20000,
    },
    room: {},
    spawns: [],
    towers: [],
    roomPlanner: {
      memory: {
        mapsByLevel: {
          2: {
            container: [
              { x: 23, y: 20 },
              { x: 4, y: 30 },
            ],
          },
        },
      },
    },
  };
  return {
    f,
    colony,
    scope,
    roomDeps,
    threats: (xs: TestScope[]) => (threats = xs),
    claims: (xs: TestScope[]) => (claims = xs),
  };
}

test("colony-only safe mode covers pre-spawn combat and early pure CLAIM approaches", () => {
  const r = defense();
  r.threats([{}]);
  assert.equal(r.f.colonySafeModeReason(r.colony), "colony invasion");
  r.colony.memory.colonyDefense = undefined;
  assert.equal(r.f.colonySafeModeReason(r.colony), undefined);
  r.colony.memory.colonyDefense = { enabled: true };
  r.threats([]);
  r.claims([{ pos: { getRangeTo: () => 5 } }]);
  assert.equal(r.f.colonySafeModeReason(r.colony), "controller approach");
  r.claims([{ pos: { getRangeTo: () => 6 } }]);
  assert.equal(r.f.colonySafeModeReason(r.colony), undefined);
});

test("safe mode checks charges, cooldown, controller attack block and downgrade threshold", () => {
  const r = defense();
  r.threats([{}]);
  for (const patch of [
    { my: false },
    { safeMode: 10 },
    { safeModeAvailable: 0 },
    { safeModeCooldown: 1 },
    { upgradeBlocked: 1 },
    { ticksToDowngrade: 4999 },
  ]) {
    const controller = { ...r.colony.controller, ...patch };
    assert.equal(r.f.colonySafeModeReason({ ...r.colony, controller }), undefined);
  }
  assert.equal(
    r.f.colonySafeModeReason({
      ...r.colony,
      controller: { ...r.colony.controller, ticksToDowngrade: 5000 },
    }),
    "colony invasion",
  );
});

test("critical shields cover every passable controller neighbor, spawn and mining buffers", () => {
  const r = defense();
  r.colony.spawns = [{ pos: { x: 27, y: 30 } }];
  r.colony.memory.colonyDefense.workstations = [
    { x: 39, y: 41 },
    { x: 39, y: 43 },
  ];
  const positions = r.f.colonyCriticalRamparts(r.colony);
  assert.equal(positions[0].x, 27);
  assert.equal(positions[0].y, 30);
  assert.equal(
    positions.filter((p: TestScope) => Math.max(Math.abs(p.x - 41), Math.abs(p.y - 41)) === 1)
      .length,
    7,
  );
  assert.ok(!positions.some((p: TestScope) => p.x === 41 && p.y === 41));
  assert.ok(positions.some((p: TestScope) => p.x === 23 && p.y === 20));
  assert.ok(positions.some((p: TestScope) => p.x === 4 && p.y === 30));
  assert.ok(positions.some((p: TestScope) => p.x === 39 && p.y === 41));
  assert.ok(positions.some((p: TestScope) => p.x === 39 && p.y === 43));
  assert.equal(r.f.colonyRampartTarget({ ...r.colony, level: 1 }), 0);
  assert.equal(r.f.colonyRampartTarget({ ...r.colony, level: 2 }), 300000);
  assert.equal(r.f.colonyRampartTarget({ ...r.colony, level: 3 }), 1000000);
  assert.equal(r.f.colonyRampartTarget({ ...r.colony, level: 4 }), 2500000);
});

test("parent safety, core roles, reserve and CPU each independently stop new aid", () => {
  const r = defense(),
    capacity = {
      energy: 200000,
      reserve: 150000,
      bootstrapping: false,
      threatened: false,
      hasQueen: true,
      hasMiners: true,
      bucket: 5000,
    };
  assert.equal(r.f.hasColonySupportCapacity(capacity), true);
  for (const patch of [
    { energy: 154999 },
    { bootstrapping: true },
    { threatened: true },
    { hasQueen: false },
    { hasMiners: false },
    { bucket: 499 },
  ]) {
    assert.equal(r.f.hasColonySupportCapacity({ ...capacity, ...patch }), false);
  }
});

test("colony activation is attempted once per tick and the parent's old Larva behavior is preserved", () => {
  const r = defense();
  r.threats([{}]);
  let attempts = 0;
  r.colony.controller.activateSafeMode = () => {
    attempts++;
    return constants.OK;
  };
  const out = load(
    "src/Overseer.ts",
    {
      "./strategy/colonyDefense": r.f,
      "./game/Room": r.roomDeps,
      "./Colony": { ColonyStage: { Larva: 0 } },
      "./utilities/utils": { onPublicServer: () => true },
    },
    r.scope,
  );
  const overseer = Object.create(out.Overseer.prototype);
  overseer.handleSafeMode(r.colony);
  overseer.handleSafeMode(r.colony);
  assert.equal(attempts, 1);
  overseer.handleSafeMode({ ...r.colony, stage: 0, memory: {} });
  assert.equal(attempts, 1);
});

test("task and combat groups keep working when the first unit is still spawning", () => {
  for (const [file, name, deps] of [
    ["src/overlords/Overlord.ts", "Overlord", {}],
    ["src/overlords/CombatOverlord.ts", "CombatOverlord", { "./Overlord": { Overlord: class {} } }],
  ] as [string, string, TestScope][]) {
    const out = load(file, deps),
      group = Object.create(out[name].prototype);
    let handled = 0,
      ran = 0;
    group.autoRun(
      [
        { spawning: true },
        { spawning: false, isIdle: true, hasValidTask: false, run: () => ran++ },
      ],
      () => handled++,
    );
    assert.equal(handled, 1);
    assert.equal(ran, name === "Overlord" ? 1 : 0);
  }
});

function support() {
  const r = defense();
  let enemies = [{ pos: { getRangeTo: () => 2 } }];
  const repairs: string[] = [],
    requests: TestScope[] = [];
  const rampart: TestScope = { id: "shield", my: true, hits: 100000, pos: { getRangeTo: () => 0 } };
  rampart.pos.isEqualTo = (p: TestScope) => p === rampart.pos;
  rampart.pos.lookFor = () => [];
  const notifications: string[] = [];
  const deps: TestScope = {
    "../Overlord": { Overlord: class {} },
    "../../creepSetups/setups": { Roles: { scout: "changeling" } },
    "../../console/log": { log: { notify: (s: string) => notifications.push(s) } },
    "../../directives/Notifier": { NotifierPriority: { Critical: 0 } },
    "../../movement/Movement": { Movement: { combatMove() {} } },
    "../../creepSetups/CreepSetup": {
      CreepSetup: class {
        constructor(public role: string) {}
      },
    },
    "../../strategy/colonyDefense": { ...r.f, colonyCriticalRamparts: () => [rampart.pos] },
    "../../game/Room": {
      getRoomDangerousPlayerHostiles: () => enemies,
      getRoomPlayerHostiles: r.roomDeps.getRoomPlayerHostiles,
    },
    "../../game/RoomStructures": { getRoomRamparts: () => [rampart] },
    "../../utilities/utils": {
      minBy: <T>(xs: T[], fn: (x: T) => number) => xs.slice().sort((a, b) => fn(a) - fn(b))[0],
    },
    "../../intel/CombatIntel": { CombatIntel: { getRangedAttackDamage: () => 100 } },
  };
  const game: TestScope = { time: 100, rooms: {} };
  const out = load("src/overlords/colonization/support.ts", deps, {
    Game: game,
    RoomPosition: r.scope.RoomPosition,
    Overmind: { colonies: { E57S45: r.colony } },
  });
  const o = Object.create(out.ColonySupportOverlord.prototype);
  Object.assign(o, {
    colony: { name: "E58S42", assets: { energy: 200000 } },
    directive: { memory: {}, alert() {} },
    pos: { roomName: "E57S45" },
    builders: [],
    haulers: [],
    guards: [],
    scouts: [],
    wishlist: (n: number, setup: TestScope, opts: TestScope) =>
      requests.push({ n, role: setup.role, ...opts }),
    requestCreep: (_setup: TestScope, opts: TestScope) => requests.push(opts),
    lifetimeFilter: (units: TestScope[]) => units,
  });
  r.colony.level = 2;
  r.colony.controller.level = 2;
  r.colony.controller.ticksToDowngrade = 10000;
  r.colony.roomPlanner.barrierPlanner = { barrierShouldBeHere: () => true };
  const builder: TestScope = {
    name: "builder",
    spawning: false,
    room: { name: "E57S45" },
    store: { energy: 450 },
    inRampart: true,
    safelyInRoom: () => true,
    flee: () => assert.fail("shielded repairer must not abandon protection"),
    creep: {
      repair: (s: TestScope) => {
        repairs.push(s.id);
        return constants.OK;
      },
    },
  };
  return {
    ...r,
    o,
    builder,
    repairs,
    requests,
    notifications,
    game,
    rampart,
    clearEnemies: () => {
      enemies = [];
    },
  };
}

test("a lone relief builder resumes upgrading after initial shields instead of fortifying forever", () => {
  const r = support();
  r.clearEnemies();
  r.colony.room.find = () => [];
  r.o.builders = [r.builder];
  let upgraded = 0;
  r.builder.creep.upgradeController = () => {
    upgraded++;
    return constants.OK;
  };
  r.o.handleBuilder(r.builder, r.colony, 0);
  assert.equal(upgraded, 1);
  assert.deepEqual(r.repairs, []);
});

test("shielded aid repairers continue countering incoming damage", () => {
  const r = support();
  r.o.handleBuilder(r.builder, r.colony, 0);
  assert.deepEqual(r.repairs, ["shield"]);
});

test("unprotected repairers flee instead of standing in hostile ranged fire", () => {
  const r = support();
  let fled = 0;
  r.builder.inRampart = false;
  r.builder.flee = () => {
    fled++;
    return true;
  };
  r.o.handleBuilder(r.builder, r.colony, 0);
  assert.equal(fled, 1);
  assert.deepEqual(r.repairs, []);
});

test("support stops all requests when parent is constrained and uses spare priority otherwise", () => {
  const r = support();
  r.o.canSupport = () => false;
  r.o.init();
  assert.equal(r.requests.length, 0);
  r.o.canSupport = () => true;
  r.o.init();
  assert.ok(r.requests.length > 0);
  assert.ok(r.requests.every((x) => x.priority >= 947));
});

test("local logistics supplies active aid builders even while new parent support is paused", () => {
  const r = support();
  const inputs: TestScope[] = [];
  r.o.builders = [r.builder];
  r.builder.store.getFreeCapacity = () => 50;
  r.builder.getActiveBodyparts = () => 2;
  r.colony.logisticsNetwork = {
    requestInput: (target: TestScope, opts: TestScope) => inputs.push({ target, ...opts }),
  };
  r.o.canSupport = () => false;
  r.o.init();
  assert.equal(r.requests.length, 0);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].target, r.builder);
  assert.equal(inputs[0].dAmountdt, 2);
});

test("a tower disabled by controller downgrade does not reduce the sentinel requirement", () => {
  const r = support();
  r.o.canSupport = () => true;
  r.colony.towers = [{ store: { energy: 1000 }, isActive: () => false }];
  r.o.init();
  assert.equal(r.o.directive.memory.status.requiredGuardDamage, 480);
  r.colony.towers[0].isActive = () => true;
  r.o.init();
  assert.equal(r.o.directive.memory.status.requiredGuardDamage, 330);
});

test("focus target prioritizes controller attackers before a weakened ranged unit", () => {
  const r = defense();
  const ranged = { id: "r", hits: 100, pos: { getRangeTo: () => 2 }, getActiveBodyparts: () => 0 };
  const claimer = {
    id: "c",
    hits: 3800,
    pos: { getRangeTo: () => 4 },
    getActiveBodyparts: (p: string) => (p === constants.CLAIM ? 18 : 0),
  };
  r.threats([ranged]);
  r.claims([claimer]);
  assert.equal(r.f.colonyDefenseTarget(r.colony), claimer);
});

test("reference siege buffer and repair floor cover the recorded peak, within RCL limits", () => {
  const report = JSON.parse(fs.readFileSync("plans/E57S45/defense/attack-history.json", "utf8"));
  assert.equal(report.peak.damage, 1570);
  // Full 1500-tick wave, ignoring all kills, with an allowance for barrier decay.
  assert.ok(2500000 > report.peak.damage * 1500 + 15000);
  assert.ok(2 * 9 * constants.REPAIR_POWER > report.peak.damage);
  // Three KO-boosted 10-RANGED sentinels beat the most pessimistic combined healing,
  // even while all raw damage is reduced by XGHO2. Actual field readiness is reported separately.
  assert.ok(3 * 10 * constants.RANGED_ATTACK_POWER * 2 * 0.3 > 132);
});

test("controller shielding can be deferred without suppressing the original southern perimeter", () => {
  const r = defense();
  r.colony.memory.colonyDefense.protectController = false;
  r.colony.memory.colonyDefense.priorityRamparts = [{ x: 28, y: 45 }];
  r.colony.memory.colonyDefense.perimeterRamparts = [
    { x: 42, y: 43 },
    { x: 40, y: 41 },
  ];
  const positions = r.f.colonyCriticalRamparts(r.colony);
  assert.equal(positions[0].x, 28);
  assert.equal(positions[0].y, 45);
  assert.equal(r.f.isControllerRampartDeferred(r.colony, { x: 40, y: 41 }), true);
  assert.equal(r.f.isControllerRampartDeferred(r.colony, { x: 39, y: 42 }), true);
  assert.equal(r.f.isControllerRampartDeferred(r.colony, { x: 42, y: 43 }), false);
  assert.ok(
    !positions.some((p: TestScope) => Math.max(Math.abs(p.x - 41), Math.abs(p.y - 41)) <= 1),
  );
  assert.equal(
    r.f.isControllerRampartDeferred({ ...r.colony, memory: {} }, { x: 40, y: 41 }),
    false,
  );
});

test("south warning distinguishes enemies, clear vision and loss of vision, with throttled notices", () => {
  const r = support();
  r.o.directive.memory.warningRoom = "E57S46";
  r.game.rooms.E57S46 = {};
  r.threats([{ owner: { username: "lp136" }, name: "ra" }]);
  r.o.runEarlyWarning();
  assert.equal(r.o.directive.memory.warning.visible, true);
  assert.deepEqual(r.o.directive.memory.warning.hostiles, ["lp136/ra"]);
  assert.equal(r.notifications.length, 1);
  r.o.runEarlyWarning();
  assert.equal(r.notifications.length, 1);
  delete r.game.rooms.E57S46;
  r.o.runEarlyWarning();
  assert.equal(r.o.directive.memory.warning.visible, false);
  assert.equal(r.notifications.length, 2);
  r.o.runEarlyWarning();
  assert.equal(r.notifications.length, 2);
});

test("guards still fire at a local enemy when the colony-wide focus is out of range", () => {
  const r = support();
  const far = {
    id: "c",
    hits: 3800,
    range: 20,
    pos: { getRangeTo: () => 2 },
    getActiveBodyparts: (p: string) => (p === constants.CLAIM ? 18 : 0),
  };
  const near = {
    id: "r",
    hits: 2000,
    range: 2,
    pos: { getRangeTo: () => 10 },
    getActiveBodyparts: () => 0,
  };
  r.threats([far, near]);
  const shots: TestScope[] = [];
  r.o.handleGuard(
    {
      spawning: false,
      hasValidTask: false,
      needsBoosts: false,
      inRampart: true,
      memory: {},
      safelyInRoom: () => true,
      pos: { getRangeTo: (c: TestScope) => c.range || 0 },
      rangedAttack: (c: TestScope) => shots.push(c),
    },
    r.colony,
    new Set(),
  );
  assert.deepEqual(shots, [near]);
});

test("the southern cut closes both south exits to core workstations under eight-direction movement", () => {
  const plan = JSON.parse(fs.readFileSync("plans/E57S45/defense/southern-front.json", "utf8"));
  const fixture = JSON.parse(fs.readFileSync("scripts/fixtures/E57S45.json", "utf8"));
  const blocked = new Set(plan.southernCut.map((p: TestScope) => `${p.x}:${p.y}`));
  const seen = new Set<string>(),
    queue: { x: number; y: number }[] = [];
  for (let x = 0; x < 50; x++)
    if (!(Number(fixture.terrain[49 * 50 + x]) & 1)) {
      queue.push({ x, y: 49 });
      seen.add(`${x}:49`);
    }
  for (let i = 0; i < queue.length; i++)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const x = queue[i].x + dx,
          y = queue[i].y + dy,
          key = `${x}:${y}`;
        if (
          x < 0 ||
          x > 49 ||
          y < 0 ||
          y > 49 ||
          seen.has(key) ||
          blocked.has(key) ||
          Number(fixture.terrain[y * 50 + x]) & 1
        )
          continue;
        seen.add(key);
        queue.push({ x, y });
      }
  for (const pos of ["27:30", "23:20", "4:30", "40:42"]) assert.equal(seen.has(pos), false, pos);
  assert.equal(plan.southernCut.length, 11);
});

test("southern guards stage at their assigned entrance while shields are being built", () => {
  const r = support();
  r.rampart.hits = 0;
  r.o.directive.memory.defenseAnchors = [
    { x: 28, y: 44 },
    { x: 15, y: 43 },
  ];
  const moves: TestScope[] = [];
  r.o.handleGuard(
    {
      spawning: false,
      hasValidTask: false,
      needsBoosts: false,
      inRampart: false,
      memory: {},
      safelyInRoom: () => true,
      pos: { getRangeTo: () => 0 },
      flee: () => false,
      goTo: (pos: TestScope) => moves.push(pos),
    },
    r.colony,
    new Set(),
    1,
  );
  assert.equal(moves[0].x, 15);
  assert.equal(moves[0].y, 43);
});

test("a small local relief miner does not delay the first full-size construction reinforcement", () => {
  const r = support();
  r.o.canSupport = () => true;
  r.o.builders = [r.builder];
  r.builder.store.getFreeCapacity = () => 0;
  r.builder.getActiveBodyparts = () => 2;
  r.o.init();
  assert.equal(r.requests.find((x) => x.role === "colonyBuilder")?.priority, 947);
});

test("native colony workers switch ordinary construction to the southern defense, while parent behavior stays unchanged", () => {
  const policyFunctions = defense().f;
  const out = load("src/overlords/core/worker.ts", {
    "../../utilities/colonyRetreat": { runColonyRetreat: () => false },
    "../../strategy/colonyDefense": policyFunctions,
    "../../strategy/southGate": { mobilized: () => false },
    "../Overlord": { Overlord: class {} },
    "../../tasks/Tasks": { Tasks: { build: (target: TestScope) => ({ name: "build", target }) } },
    "../../tasks/instances/build": { buildTaskName: "build" },
    "../../utilities/outpostDevelopment": {
      developmentPositionKey: (p: TestScope) => `${p.x}:${p.y}`,
    },
    "../../game/RoomPosition": {
      roomPositionFindClosestByMultiRoomRange: (_p: unknown, xs: TestScope[]) => xs[0],
    },
    "../../priorities/priorities_structures": {
      BuildPriorities: [constants.STRUCTURE_EXTENSION, constants.STRUCTURE_RAMPART],
    },
  });
  const south = { id: "south", structureType: constants.STRUCTURE_RAMPART, pos: { x: 28, y: 45 } },
    extension = {
      id: "extension",
      structureType: constants.STRUCTURE_EXTENSION,
      pos: { x: 30, y: 31 },
    };
  const worker: TestScope = { task: { name: "build", target: extension }, pos: {} };
  const o = Object.create(out.WorkerOverlord.prototype);
  Object.assign(o, {
    colony: { memory: { colonyDefense: { enabled: true, priorityRamparts: [south.pos] } } },
    constructionSites: [extension, south],
    workers: [worker],
    autoRun() {},
  });
  o.run();
  assert.equal(Boolean(worker.task), false);
  o.buildActions(worker);
  assert.equal(worker.task.target, south);
  o.colony.memory.colonyDefense.southDefenseSchedule = { armedAt: 100 };
  worker.task = { name: "build", target: extension };
  o.run();
  assert.equal(worker.task.target, extension);
  o.buildActions(worker);
  assert.equal(worker.task.target, extension);
  o.colony.memory = {};
  o.buildActions(worker);
  assert.equal(worker.task.target, extension);
});

test("scheduled south defense ignores historical attacks and waits for actual safe mode", () => {
  const r = defense();
  r.colony.memory.colonyDefense.southDefenseSchedule = { armedAt: 100, remainingThreshold: 2500 };
  r.f.updateSouthDefenseSchedule(r.colony);
  assert.equal(r.f.isSouthDefenseActive(r.colony), false);
  r.scope.Game.time = 101;
  r.threats([{}]);
  r.f.updateSouthDefenseSchedule(r.colony);
  const schedule = r.colony.memory.colonyDefense.southDefenseSchedule;
  assert.equal(schedule.attackSeenAt, 101);
  // An accepted activation intent, or an activation blocked by cooldown, is insufficient.
  r.colony.memory.colonyDefense.lastSafeModeResult = constants.OK;
  r.colony.controller.safeModeCooldown = 1000;
  r.scope.Game.time = 20000;
  r.threats([]);
  r.f.updateSouthDefenseSchedule(r.colony);
  assert.equal(schedule.safeModeSeenAt, undefined);
  assert.equal(r.f.isSouthDefenseActive(r.colony), false);
});

test("observed safe mode mobilizes only at the expiry threshold and stays mobilized afterward", () => {
  const r = defense();
  r.colony.memory.colonyDefense.southDefenseSchedule = { armedAt: 100, remainingThreshold: 2500 };
  r.threats([{}]);
  r.f.updateSouthDefenseSchedule(r.colony);
  r.scope.Game.time = 101;
  r.colony.controller.safeMode = constants.SAFE_MODE_DURATION - 1;
  r.f.updateSouthDefenseSchedule(r.colony);
  const schedule = r.colony.memory.colonyDefense.southDefenseSchedule;
  assert.equal(schedule.safeModeEndsAt, 100 + constants.SAFE_MODE_DURATION);
  assert.equal(r.f.isSouthDefenseActive(r.colony), false);
  r.scope.Game.time = schedule.safeModeEndsAt - 2501;
  r.colony.controller.safeMode = 2501;
  r.f.updateSouthDefenseSchedule(r.colony);
  assert.equal(r.f.isSouthDefenseActive(r.colony), false);
  r.scope.Game.time++;
  r.colony.controller.safeMode = 2500;
  r.f.updateSouthDefenseSchedule(r.colony);
  assert.equal(r.f.isSouthDefenseActive(r.colony), true);
  const activated = schedule.mobilizedAt;
  r.scope.Game.time = schedule.safeModeEndsAt + 1;
  r.colony.controller.safeMode = undefined;
  r.threats([]);
  r.f.updateSouthDefenseSchedule(r.colony);
  assert.equal(schedule.mobilizedAt, activated);
  assert.equal(r.f.isSouthDefenseActive(r.colony), true);
});

test("a safe mode that predates the new attack does not satisfy the schedule", () => {
  const r = defense();
  r.colony.memory.colonyDefense.southDefenseSchedule = { armedAt: 100 };
  r.threats([{}]);
  r.colony.controller.safeMode = 1000;
  r.f.updateSouthDefenseSchedule(r.colony);
  assert.equal(r.colony.memory.colonyDefense.southDefenseSchedule.safeModeSeenAt, undefined);
  assert.equal(r.f.isSouthDefenseActive(r.colony), false);
});

test("a missed expiry-window tick still mobilizes from a previously observed safe mode", () => {
  const r = defense();
  r.colony.memory.colonyDefense.southDefenseSchedule = {
    armedAt: 100,
    attackSeenAt: 100,
    safeModeSeenAt: 101,
    safeModeEndsAt: 20100,
  };
  r.scope.Game.time = 20200;
  r.f.updateSouthDefenseSchedule(r.colony);
  assert.equal(r.f.isSouthDefenseActive(r.colony), true);
});

test("waiting aid builders use native worker tasks without clearing their current job", () => {
  const r = support();
  r.colony.memory.colonyDefense.southDefenseSchedule = { armedAt: 100 };
  const task = { name: "upgrade" };
  r.builder.task = task;
  const delegated: TestScope[] = [];
  r.colony.overlords = { work: { runSupportWorker: (w: TestScope) => delegated.push(w) } };
  r.o.handleBuilder(r.builder, r.colony, 0);
  assert.deepEqual(delegated, [r.builder]);
  assert.equal(r.builder.task, task);
  assert.deepEqual(r.repairs, []);
});

test("waiting support does not order a southern garrison but still requests economic reinforcements", () => {
  const r = support();
  r.o.canSupport = () => true;
  r.colony.memory.colonyDefense.southDefenseSchedule = { armedAt: 100 };
  r.o.init();
  assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0].role, "colonyBuilder");
  assert.equal(r.o.directive.memory.status.southDefense, "waiting-attack");
});

test("waiting support creates no extra fortification sites and observed mobilization commits the lone builder", () => {
  const r = support();
  r.colony.memory.colonyDefense.southDefenseSchedule = { armedAt: 100 };
  r.colony.room.find = () => [];
  r.o.maintainSites(r.colony);
  r.clearEnemies();
  r.o.builders = [r.builder];
  r.colony.memory.colonyDefense.southDefenseSchedule.mobilizedAt = 100;
  r.o.handleBuilder(r.builder, r.colony, 0);
  assert.deepEqual(r.repairs, ["shield"]);
});

test("recalled workers route outside the flee boundary and resume normal work only at home", () => {
  const hostile = { pos: { x: 22, y: 24 } };
  class Position {
    constructor(
      public x: number,
      public y: number,
      public roomName: string,
    ) {}
  }
  const f = load(
    "src/utilities/colonyRetreat.ts",
    {
      "../game/Room": { getRoomDangerousHostiles: () => [hostile] },
    },
    { RoomPosition: Position },
  );
  let home = false,
    range = 6,
    moves = 0,
    flees = 0;
  const worker: TestScope = {
    memory: { colonyRetreatRoom: "E58S42", _go: { path: "unsafe" } },
    room: { name: "E57S45" },
    pos: { getRangeTo: () => range },
    safelyInRoom: () => home,
    flee(_h: unknown, _f: unknown, opts: TestScope) {
      flees++;
      assert.equal(opts.fleeRange, 6);
    },
    goToRoom(target: string, opts: TestScope) {
      moves++;
      assert.equal(target, "E58S42");
      assert.equal(this.memory._go, undefined);
      assert.equal(opts.pathOpts.obstacles.length, 121);
      assert.ok(
        opts.pathOpts.obstacles.every(
          (p: Position) => Math.max(Math.abs(p.x - 22), Math.abs(p.y - 24)) <= 5,
        ),
      );
    },
  };
  assert.equal(f.runColonyRetreat(worker), true);
  assert.equal(moves, 1);
  assert.equal(flees, 0);
  range = 4;
  assert.equal(f.runColonyRetreat(worker), true);
  assert.equal(moves, 1);
  assert.equal(flees, 1);
  home = true;
  assert.equal(f.runColonyRetreat(worker), false);
  assert.equal(worker.memory.colonyRetreatRoom, undefined);
  assert.equal(f.runColonyRetreat({ memory: {} }), false);
});

test("observation-only rooms are excluded from outposts without disabling scouting or other rooms", () => {
  const scope: TestScope = {
    Memory: { rooms: { E57S46: { expansionDisabled: true } } },
    Game: { flags: {}, map: { describeExits: () => ({ 1: "E57S45" }) } },
    Overmind: { cache: { outpostFlags: [] }, colonies: {} },
  };
  const policy = load("src/strategy/roomExpansionPolicy.ts", {}, scope);
  assert.equal(policy.isRoomExpansionBlocked("E57S46"), true);
  assert.equal(policy.isRoomExpansionBlocked("E58S45"), false);
  const out = load(
    "src/Overseer.ts",
    {
      "./strategy/roomExpansionPolicy": policy,
      "./utilities/utils": { onPublicServer: () => true },
      "./utilities/Cartographer": {
        ROOMTYPE_CONTROLLER: "controller",
        Cartographer: {
          findRoomsInRange: () => ["E57S46", "E58S45"],
          roomType: () => "controller",
        },
      },
      "./intel/RoomIntel": {
        RoomIntel: {
          roomOwnedBy: () => undefined,
          roomReservedBy: () => undefined,
          isRoomAccessible: () => true,
        },
      },
    },
    scope,
  );
  const o = Object.create(out.Overseer.prototype);
  assert.deepEqual(o.computePossibleOutposts({ room: { name: "E57S45" }, roomNames: ["E57S45"] }), [
    "E58S45",
  ]);
  scope.Memory.rooms.E57S46.expansionDisabled = false;
  assert.equal(policy.isRoomExpansionBlocked("E57S46"), false);
});

test("a withdrawn colony stays excluded until its cooldown deadline without affecting permanent blocks", () => {
  const scope: TestScope = {
    Memory: {
      rooms: { E57S45: { expansionDisabledUntil: 200 }, E57S46: { expansionDisabled: true } },
    },
    Game: { time: 199, flags: {} },
  };
  const policy = load("src/strategy/roomExpansionPolicy.ts", {}, scope);
  assert.equal(policy.isRoomExpansionBlocked("E57S45"), true);
  scope.Game.time = 200;
  assert.equal(policy.isRoomExpansionBlocked("E57S45"), false);
  assert.equal(policy.isRoomExpansionBlocked("E57S46"), true);
});

test("observation-only rooms are excluded from colony expansion even with a cached high score", () => {
  const scope: TestScope = {
    Memory: { rooms: { E57S46: { expansionDisabled: true } } },
    Game: { flags: {} },
  };
  const policy = load("src/strategy/roomExpansionPolicy.ts", {}, scope);
  const out = load(
    "src/strategy/ExpansionPlanner.ts",
    {
      "./roomExpansionPolicy": policy,
      "../assimilation/decorator": { assimilationLocked: <T>(v: T) => v },
      "../Colony": { getAllColonies: () => [] },
    },
    scope,
  );
  const o = Object.create(out.ExpansionPlanner.prototype);
  assert.equal(
    o.getBestExpansionRoomFor({
      memory: { expansionData: { possibleExpansions: { E57S46: 9999 } } },
    }),
    undefined,
  );
});

function southDefense() {
  const game: TestScope = {
    time: 100,
    shard: { name: "shard3" },
    rooms: { E58S44: { enemies: [] }, E58S43: { enemies: [] }, E58S42: { enemies: [] } },
  };
  const resources = load("src/resources/map_resources.ts", {});
  const combat = load("src/intel/CombatIntel.ts", { "../resources/map_resources": resources });
  const pos = (x: number, y: number) => ({
    x,
    y,
    roomName: "E58S42",
    getRangeTo(other: TestScope) {
      const p = other.pos || other;
      return Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
    },
    isNearTo(other: TestScope) {
      return this.getRangeTo(other) <= 1;
    },
    isEqualTo(other: TestScope) {
      return this.getRangeTo(other) === 0;
    },
    inRangeTo(other: TestScope, range: number) {
      return this.getRangeTo(other) <= range;
    },
    lookFor: () => [],
    getDirectionTo: (_p: TestScope) => constants.BOTTOM,
  });
  const strategy = load(
    "src/strategy/southGate.ts",
    {
      "../resources/map_resources": resources,
      "../intel/CombatIntel": combat,
      "../game/cache": load("src/game/cache.ts", {}, { Game: game }),
      "../game/Room": {
        getRoomPlayerHostiles: (room: TestScope) => room.enemies,
        getRoomDroppedEnergy: (room: TestScope) => room.drops || [],
        getRoomCreeps: (room: TestScope) => room.mine || [],
      },
      "../game/RoomStructures": { getRoomRamparts: (room: TestScope) => room.walls },
      "../matrix/MatrixLib": {
        MatrixLib: {
          getMatrix: () => ({
            clone: () => {
              const costs = new Uint8Array(2500);
              return {
                get: (x: number, y: number) => costs[50 * y + x],
                set: (x: number, y: number, v: number) => (costs[50 * y + x] = v),
              };
            },
          }),
        },
      },
    },
    { Game: game, PathFinder: { search: (...args: unknown[]) => game.search(...args) } },
  );
  const requests: TestScope[] = [];
  const { SouthGateOverlord } = load(
    "src/overlords/defense/southGate.ts",
    {
      "../Overlord": { Overlord: class {} },
      "../../creepSetups/CreepSetup": {
        CreepSetup: class {
          constructor(
            public role: string,
            public bodySetup: TestScope,
          ) {}
        },
      },
      "../../strategy/southGate": strategy,
    },
    { Game: game },
  );
  const o = Object.create(SouthGateOverlord.prototype);
  o.colony = {
    name: "E58S42",
    memory: {},
    controller: {},
    towers: [{ pos: pos(25, 29), my: true, isActive: () => true, store: { energy: 1000 } }],
    room: {
      walls: [],
      enemies: [],
      energyCapacityAvailable: 2300,
      find: () => [pos(15, 49), pos(39, 49)],
    },
  };
  o.rangers = [];
  o.guards = [];
  o.snipers = [];
  o.trucks = [];
  o.breakers = [];
  o.colony.assets = { XUH2O: 1200, XKHO2: 300 };
  o.colony.tombstones = [];
  o.colony.room.drops = [];
  o.colony.overlords = { logistics: { transporters: [] } };
  o.wishlist = (n: number, setup: TestScope, opts: TestScope) =>
    requests.push({ n, role: setup.role, priority: opts.priority });
  const enemy = {
    id: "siege-unit-1",
    name: "breaker",
    owner: { username: "attacker" },
    pos: pos(24, 24),
    body: [
      { type: "work", hits: 100, boost: "XZH2O" },
      ...Array(4).fill({ type: "heal", hits: 100, boost: "XLHO2" }),
    ],
    getActiveBodyparts: (_part: string) => 0,
  };
  const orders = () => {
    requests.length = 0;
    o.init();
    return requests.map((r) => r.role);
  };
  return { game, o, requests, enemy, strategy, orders, pos };
}

function gateBattle() {
  const r = southDefense(),
    { o, game, pos, enemy } = r;
  const room = game.rooms.E58S42;
  Object.assign(room, o.colony.room, { name: "E58S42", getEventLog: () => room.events || [] });
  o.colony.room = room;
  room.walls = [24, 25, 30, 31, 32, 33, 34].map((x) => ({
    id: "wall-" + x,
    pos: pos(x, 47),
    my: true,
    hits: x === 25 ? 1558721 : x === 32 ? 1859301 : 1998121,
    hitsMax: 10000000,
  }));
  Object.assign(o, { guards: [], rangers: [], menders: [], scouts: [], memory: {} });
  o.colony.labs = [];
  enemy.getActiveBodyparts = (p: string) => (p === constants.WORK ? 35 : 0);
  return { ...r, room };
}

test("a gate guard holds the attacked eastern rampart across exit feints and strikes on reentry", () => {
  const { game, o, room, enemy, pos } = gateBattle();
  const moves: number[] = [],
    attacks: string[] = [];
  const guardPos = pos(32, 47);
  const move = (target: TestScope) => moves.push((target.pos || target).x);
  const creep = {
    pos: guardPos,
    body: [],
    moveTo: move,
    attack: (c: TestScope) => attacks.push(c.id),
  };
  o.guards = [{ pos: guardPos, room, creep, goTo: move, memory: {} }];
  // E58S42, ticks 84243589–592: a dismantler touches the cut, bounces through y=49, then reenters.
  for (const y of [48, 49, undefined, 48, 49, undefined, 48]) {
    game.time++;
    enemy.pos = pos(y === 49 ? 34 : 33, y ?? 0);
    room.enemies = y === undefined ? [] : [enemy];
    room.events =
      y === 48 ? [{ event: constants.EVENT_ATTACK, data: { targetId: "wall-32" } }] : [];
    o.run();
  }
  assert.deepEqual(moves, [], "an exit feint must not pull a guard off an effective post");
  assert.equal(attacks.length, 3);
});

test("an existing south ranger orders only T3, holds until it is ready, boosts and returns to its post", () => {
  const { game, o, room, pos, enemy } = gateBattle();
  const body = Array.from({ length: 10 }, () => ({ type: "ranged_attack", hits: 100, boost: "" }));
  const moves: string[] = [],
    orders: unknown[] = [];
  const lab = {
    pos: pos(28, 32),
    mineralType: "XKHO2",
    store: { XKHO2: 299, energy: 200 },
    boostCreep() {
      for (const p of body) p.boost = "XKHO2";
      return constants.OK;
    },
  };
  const unit = {
    pos: pos(31, 47),
    memory: {},
    creep: {
      body,
      rangedAttack() {},
      moveTo(p: TestScope) {
        moves.push("post:" + p.x);
      },
    },
    goTo(dest: TestScope) {
      assert.equal(dest, lab);
      moves.push("lab");
    },
  };
  o.colony.evolutionChamber = { requestBoosts: (order: unknown) => orders.push(order) };
  o.colony.assets = { KO: 3200, KHO2: 240, XKHO2: 300 };
  o.rangers = [unit];
  o.colony.labs = [lab];
  enemy.pos = pos(34, 49);
  room.enemies = [enemy];
  room.events = [{ event: constants.EVENT_ATTACK, data: { targetId: "wall-32" } }];
  o.init();
  o.run();
  assert.deepEqual(orders, [{ XKHO2: 300 }]);
  assert.deepEqual(moves, []);
  game.time++;
  room.enemies = [];
  room.events = [];
  lab.store.XKHO2 = 300;
  o.init();
  o.run();
  assert.deepEqual(orders, [{ XKHO2: 300 }, { XKHO2: 300 }]);
  assert.deepEqual(moves, ["lab"]);
  game.time++;
  unit.pos = pos(28, 33);
  o.run();
  assert.equal(body.filter((p) => p.boost === "XKHO2").length, 10);
  game.time++;
  o.init();
  o.run();
  assert.equal(orders.length, 2);
  assert.deepEqual(moves, ["lab", "post:31"]);
});

test("a south ranger holds a covering rampart through exit feints and shifts for a new breach", () => {
  const { game, o, room, pos, enemy, strategy } = gateBattle();
  const moves: number[] = [],
    shots: string[] = [];
  const unit = {
    pos: pos(31, 47),
    memory: {},
    creep: {
      rangedAttack(c: TestScope) {
        shots.push(c.id);
      },
      moveTo(p: TestScope) {
        moves.push(p.x);
      },
    },
  };
  const front = room.walls.find((w: TestScope) => w.pos.x === 32);
  for (const present of [true, false, true, false]) {
    game.time++;
    enemy.pos = pos(34, 49);
    room.enemies = present ? [enemy] : [];
    strategy.defendSouthGate(unit, o.colony, front, 3);
  }
  assert.deepEqual(moves, []);
  assert.equal(shots.length, 2);
  game.time++;
  enemy.pos = pos(24, 48);
  room.enemies = [enemy];
  strategy.defendSouthGate(unit, o.colony, room.walls[0], 3);
  assert.ok(moves.length === 1 && moves[0] <= 27);
  game.time++;
  room.enemies = [];
  strategy.defendSouthGate(unit, o.colony, room.walls[0], 3);
  assert.equal(moves[1], moves[0], "keep the intercept destination while en route");
});

test("the home recall sends all hydralisks to the spawn and recycles only adjacent ones", () => {
  const { o, pos } = gateBattle();
  const actions: string[] = [];
  const spawn = {
    pos: pos(26, 31),
    recycleCreep(c: TestScope) {
      actions.push("recycle " + c.name);
    },
  };
  const units = [false, true].map((near, i) => ({
    name: "hydralisk_" + i,
    pos: { findClosestByRange: () => spawn, isNearTo: () => near },
    moveTo(target: TestScope) {
      assert.equal(target, spawn);
      actions.push("return " + i);
    },
  }));
  o.colony.memory.pauseHydralisks = true;
  o.colony.spawns = [spawn];
  o.colony.getCreepsByRole = (role: string) => {
    assert.equal(role, "hydralisk");
    return units;
  };
  o.run();
  assert.deepEqual(actions, ["return 0", "recycle hydralisk_1"]);
});

test("one explicit T3 sniper order survives quiet ticks, ignores a KO veteran and never buys twice", () => {
  const { o, requests, game } = gateBattle();
  o.colony.memory.orderSouthSniper = true;
  o.rangers = [{ creep: { body: [{ type: "ranged_attack", hits: 100, boost: "KO" }] } }];
  o.colony.assets = { KO: 3200, KHO2: 1000, XKHO2: 0, UH2O: 600 };
  o.init();
  assert.ok(!requests.some((r) => r.role === "southSniper"));
  game.time++;
  o.colony.assets.XKHO2 = 300;
  o.init();
  assert.equal(requests.filter((r) => r.role === "southSniper").length, 1);
  o.snipers = [
    { creep: { body: Array(10).fill({ type: "ranged_attack", hits: 100, boost: "XKHO2" }) } },
  ];
  game.time++;
  o.init();
  assert.equal(o.colony.memory.orderSouthSniper, undefined);
  assert.equal(requests.filter((r) => r.role === "southSniper").length, 1);
});
test("a full south mender keeps repairing the damaged wall while the dismantler exits", () => {
  const { game, o, room, enemy, pos } = gateBattle();
  const repairs: number[] = [],
    moves: number[] = [];
  const spot = pos(31, 44);
  const creep = {
    pos: spot,
    room,
    body: [],
    memory: {},
    store: createStore({ energy: 200 }, 200),
    repair(wall: TestScope) {
      if (!spot.inRangeTo(wall, 3)) return constants.ERR_NOT_IN_RANGE;
      repairs.push(wall.pos.x);
      return constants.OK;
    },
    moveTo: (p: TestScope) => moves.push((p.pos || p).x),
  };
  o.menders = [{ pos: spot, room, memory: {}, creep }];
  for (const present of [true, false, true, false]) {
    game.time++;
    enemy.pos = pos(32, 48);
    room.enemies = present ? [enemy] : [];
    room.events = present ? [{ event: constants.EVENT_ATTACK, data: { targetId: "wall-32" } }] : [];
    o.run();
  }
  assert.deepEqual(repairs, [32, 32, 32, 32]);
  assert.deepEqual(moves, []);
});

test("a ranged drainer in the middle gap is intercepted from the west rampart; towers wait for the guard", () => {
  const { game, o, strategy, room, pos, enemy, requests } = gateBattle();
  // E58S42 at 84244013: 5 XKHO2 RANGED, 6 XGHO2 TOUGH, 29 XLHO2 HEAL, 10 MOVE.
  const parts = (n: number, type: string, boost: string) =>
    Array.from({ length: n }, () => ({ type, boost, hits: 100 }));
  const drainer = {
    ...enemy,
    pos: pos(22, 48),
    hits: 5000,
    body: [
      ...parts(5, "ranged_attack", "XKHO2"),
      ...parts(6, "tough", "XGHO2"),
      ...parts(29, "heal", "XLHO2"),
      ...parts(10, "move", "XZHO2"),
    ],
    getActiveBodyparts: (p: string) => (p === "ranged_attack" ? 5 : p === "heal" ? 29 : 0),
  };
  room.enemies = [drainer];
  room.events = [{ event: constants.EVENT_ATTACK, data: { targetId: "wall-25" } }];
  room.walls.push({ id: "wall-21", pos: pos(21, 47), my: true, hits: 1999000 });
  o.colony.towers = [pos(25, 41), pos(32, 37)].map((p) => ({
    pos: p,
    my: true,
    isActive: () => true,
    store: { energy: 600 },
  }));
  const moves: number[] = [],
    shots: string[] = [];
  const guard = {
    spawning: false,
    pos: pos(25, 47),
    body: parts(20, "attack", "UH2O"),
    getActiveBodyparts: (p: string) => (p === "attack" ? 20 : 0),
    moveTo: (p: TestScope) => moves.push((p.pos || p).x),
    attack() {},
  };
  room.mine = [guard];
  o.guards = [{ pos: guard.pos, room, creep: guard, memory: {}, goTo: guard.moveTo }];
  const { SporeCrawler } = load(
    "src/hiveClusters/sporeCrawler.ts",
    {
      "./_HiveCluster": { HiveCluster: class {} },
      "../strategy/southGate": strategy,
      "../game/Room": { getRoomCreeps: () => room.mine, getRoomHostiles: () => room.enemies },
    },
    { Game: game },
  );
  const tower = Object.assign(Object.create(SporeCrawler.prototype), {
    colony: o.colony,
    room,
    pos: { findClosestByRange: () => null },
    attack: (target: TestScope) => shots.push(target.id),
    preventStructureDecay() {},
  });
  o.colony.overlords = { work: { nukeDefenseRamparts: [] } };
  tower.run();
  assert.deepEqual(shots, [], "tower damage alone is fully healed on this tile");
  o.run();
  assert.deepEqual(moves, [21], "the wall being shot is three tiles from the attacker");
  game.time++;
  guard.pos = o.guards[0].pos = pos(21, 47);
  tower.run();
  assert.deepEqual(shots, [], "1360 damage after armor still falls short of 1392 healing");
  assert.equal(strategy.needsGateRanger(o.colony), true);
  o.init();
  assert.ok(requests.some((r) => r.role === "southSniper" && r.n === 1));
  const ranger = {
    spawning: false,
    pos: pos(25, 47),
    body: parts(10, "ranged_attack", ""),
    rangedAttack: () => constants.OK,
  };
  room.mine.push(ranger);
  game.time++;
  assert.equal(strategy.gateTowerTarget(o.colony)?.id, drainer.id);
  tower.run();
  assert.deepEqual(
    shots,
    [drainer.id],
    "resume fire immediately when ranged support tips the balance",
  );
  game.time++;
  drainer.pos = pos(22, 49);
  guard.pos = pos(22, 48);
  assert.equal(
    strategy.gateTowerTarget(o.colony),
    undefined,
    "save the volley when a healthy target can escape this tick",
  );
  game.time++;
  drainer.hits = 250;
  assert.equal(
    strategy.gateTowerTarget(o.colony)?.id,
    drainer.id,
    "finish an exposed target at the exit",
  );
});

test("two melee guards can focus a boosted dismantler with a 29-part medic at the middle gap", () => {
  const { game, o, room, strategy, pos, enemy, requests } = gateBattle();
  const parts = (n: number, type: string, boost: string) =>
    Array.from({ length: n }, () => ({ type, boost, hits: 100 }));
  const mk = (name: string, x: number, body: TestScope[]) => ({
    ...enemy,
    id: name,
    name,
    pos: pos(x, 48),
    body,
    hits: 5000,
    getActiveBodyparts: (type: string) => body.filter((p) => p.type === type).length,
  });
  const breaker = mk("breaker", 23, [
    ...parts(11, "tough", "XGHO2"),
    ...parts(29, "work", "XZH2O"),
    ...parts(10, "move", "XZHO2"),
  ]);
  const medic = mk("medic", 22, [
    ...parts(10, "tough", "XGHO2"),
    ...parts(1, "ranged_attack", "XKHO2"),
    ...parts(29, "heal", "XLHO2"),
    ...parts(10, "move", "XZHO2"),
  ]);
  room.enemies = [breaker, medic];
  room.events = [{ event: constants.EVENT_ATTACK, data: { targetId: "wall-24" } }];
  o.colony.towers = [pos(25, 41), pos(32, 37)].map((pos) => ({
    pos,
    my: true,
    isActive: () => true,
    store: { energy: 900 },
  }));
  const moves: number[][] = [];
  const guards = [24, 27].map((x) => {
    const body = x === 24 ? parts(20, "attack", "UH2O") : parts(24, "attack", "XUH2O");
    const p = pos(x, 47);
    return {
      pos: p,
      room,
      memory: {},
      creep: {
        pos: p,
        hits: 3000,
        hitsMax: 3000,
        body,
        getActiveBodyparts: (t: string) => (t === "attack" ? 20 : 0),
        attack() {},
        moveTo(dest: TestScope, opts: TestScope) {
          assert.equal(opts.maxRooms, 1);
          moves.push([dest.x, dest.y]);
        },
      },
    };
  });
  o.guards = [guards[0]];
  o.colony.assets.XUH2O = 720;
  room.getPositionAt = pos;
  const wall = room.walls[0];
  wall.pos.lookFor = () => [guards[0].creep];
  game.map = { getRoomTerrain: () => ({ get: () => 0 }) };
  room.mine = [guards[0].creep, { pos: pos(26, 47), body: parts(10, "ranged_attack", "KO") }];
  o.init();
  assert.ok(requests.some((r) => r.role === "southBreaker" && r.n === 1));
  o.breakers = [guards[1]];
  assert.equal(strategy.gateTowerTarget(o.colony), undefined);
  o.run();
  assert.ok(
    moves.some(([x, y]) => [22, 23].includes(x) && y === 47),
    "the second guard needs its own reachable attack position",
  );
  const [x, y] = moves.at(-1)!;
  guards[1].pos = guards[1].creep.pos = pos(x, y);
  room.mine.push(guards[1].creep);
  game.time++;
  assert.equal(strategy.gateTowerTarget(o.colony)?.id, breaker.id);
  room.enemies = [medic];
  game.time++;
  room.walls.push({ id: "west", pos: pos(21, 47), my: true, hits: 2000000 });
  room.walls.at(-1).pos.lookFor = () => [guards[0].creep];
  moves.length = 0;
  strategy.defendSouthGate(guards[1], o.colony, wall, 1, true);
  assert.ok(
    moves.length === 0 || moves.some(([x, y]) => [22, 23].includes(x) && y === 47),
    "keep striking the medic after its patient dies",
  );
  room.enemies = [breaker, medic];
  medic.body.splice(10, 0, ...parts(12, "attack", "XUH2O"));
  game.time++;
  moves.length = 0;
  o.run();
  assert.ok(
    !moves.some(([mx, my]) => [22, 23].includes(mx) && my === 47),
    "do not hold an exposed tile against a lethal counterattack",
  );
});

test("a gate hauler picks up loose energy during the siege and unloads it after the alert clears", () => {
  const { game, o, strategy, room, pos, enemy } = gateBattle();
  const storage = { pos: pos(24, 40), store: createStore({ energy: 5000 }, 10000) };
  room.storage = o.colony.storage = storage;
  o.colony.towers[0].store.energy = 1000;
  game.rooms.E58S44.enemies = [enemy];
  const pile = {
    id: "inside",
    pos: pos(28, 45),
    amount: 917,
    resourceType: constants.RESOURCE_ENERGY,
  };
  room.drops = [pile, { ...pile, id: "outside", pos: pos(26, 48), amount: 1922 }];
  const actions: string[] = [];
  const spot = pos(27, 44);
  const creep = {
    room,
    name: "transport_1",
    pos: spot,
    memory: {},
    store: createStore({ energy: 0 }, 1500),
    withdraw: () => {
      actions.push("withdraw");
      return constants.ERR_NOT_IN_RANGE;
    },
    pickup: (drop: TestScope) => {
      actions.push(drop.id);
      return constants.OK;
    },
    transfer: (site: TestScope) => {
      actions.push(site === storage ? "bank" : "supply");
      return constants.OK;
    },
    moveTo() {},
  };
  const unit = {
    creep,
    room,
    pos: spot,
    store: creep.store,
    memory: creep.memory,
    name: creep.name,
  };
  o.colony.overlords = { logistics: { transporters: [unit] } };
  room.find = (kind: number) => (kind === constants.FIND_EXIT_BOTTOM ? [pos(34, 49)] : []);
  assert.equal(strategy.supplySouthGate(o.colony, unit), true);
  assert.deepEqual(actions, ["inside"]);
  game.time++;
  game.rooms.E58S44.enemies = [];
  room.drops = [];
  creep.store.energy = 917;
  creep.pos = pos(25, 40);
  assert.equal(strategy.supplySouthGate(o.colony, unit), true);
  assert.deepEqual(actions, ["inside", "bank"]);
});

test("collect a southern spill from a free shield without entering the firing lane or displacing the guard", () => {
  const { game, o, strategy, room, pos, enemy } = gateBattle();
  const bank = { pos: pos(24, 40), store: createStore({ energy: 5000 }, 10000) };
  o.colony.storage = room.storage = bank;
  const east = room.walls.find((w: TestScope) => w.pos.x === 32);
  o.colony.memory.southWatch = { tick: game.time, front: { wall: east.id, seen: game.time } };
  const medic = {
    ...enemy,
    pos: pos(34, 49),
    getActiveBodyparts: (p: string) => (p === constants.RANGED_ATTACK ? 5 : 0),
  };
  room.enemies = [medic];
  room.drops = [
    { id: "spill", pos: pos(33, 48), amount: 2017, resourceType: constants.RESOURCE_ENERGY },
  ];
  room.find = () => [];
  const wall = room.walls.find((w: TestScope) => w.pos.x === 33);
  const collector = {
    name: "truck",
    room,
    pos: pos(32, 46),
    store: createStore({ energy: 0 }, 1500),
    memory: {},
  };
  let picked = 0,
    moved = 0;
  const creep = {
    ...collector,
    move: () => moved++,
    pickup: () => {
      picked++;
      return constants.OK;
    },
  };
  const unit = { ...collector, creep };
  o.colony.overlords = { logistics: { transporters: [unit] } };
  game.search = (_from: TestScope, goal: TestScope, opts: TestScope) => {
    const m = opts.roomCallback(room.name);
    assert.equal(opts.maxRooms, 1);
    assert.equal(goal.range, 1);
    assert.equal(m.get(33, 48), 255, "never put the collector on the spill outside");
    assert.equal(m.get(33, 46), 255, "avoid the exposed ranged attack zone");
    assert.equal(m.get(32, 47), 255, "leave the active guard post free");
    assert.notEqual(m.get(33, 47), 255, "a free friendly shield provides pickup range");
    return { incomplete: false, path: [wall.pos] };
  };
  assert.equal(strategy.supplySouthGate(o.colony, unit), true);
  assert.equal(moved, 1);
  game.time++;
  unit.pos = creep.pos = wall.pos;
  assert.equal(strategy.supplySouthGate(o.colony, unit), true);
  assert.equal(picked, 1);
});

test("spare menders recover separate drops even with no transporters or active contact, then bank them", () => {
  const { game, o, room, pos } = gateBattle();
  const bank = { pos: pos(24, 40), store: createStore({ energy: 1000 }, 10000) };
  room.storage = o.colony.storage = bank;
  room.drops = [
    { id: "small", pos: pos(26, 48), amount: 51 },
    { id: "large", pos: pos(33, 48), amount: 300 },
  ];
  o.colony.overlords = { logistics: { transporters: [] } };
  const picked: string[] = [],
    banked: string[] = [];
  const make = (name: string, x: number) => {
    const c = {
      name,
      room,
      pos: pos(x, 47),
      memory: {},
      body: [],
      store: createStore({}, 200),
      pickup(d: TestScope) {
        picked.push(d.id);
        return constants.OK;
      },
      transfer(target: TestScope) {
        assert.equal(target, bank);
        banked.push(name);
        return constants.OK;
      },
      repair: () => constants.OK,
      withdraw: () => constants.OK,
      moveTo() {},
    };
    return { name, pos: c.pos, room, creep: c, store: c.store, memory: c.memory };
  };
  const workers = [make("repair", 24), make("collector1", 25), make("collector2", 33)];
  o.menders = workers;
  o.run();
  assert.deepEqual(picked.sort(), ["large", "small"]);
  game.time++;
  room.drops = [];
  for (const w of workers.slice(1)) {
    w.store.energy = 50;
    w.pos = w.creep.pos = pos(25, 40);
  }
  o.run();
  assert.deepEqual(banked.sort(), ["collector1", "collector2"]);
});

test("the recovery truck fills the production pool from cargo and refuels when empty", () => {
  const { o, pos, strategy } = gateBattle();
  const spawn = { pos: pos(29, 40), isActive: () => true, store: createStore({ energy: 10 }, 300) };
  const bank = { pos: pos(24, 40), store: createStore({ energy: 5000 }, 10000) };
  o.colony.spawns = [spawn];
  o.colony.extensions = [];
  o.colony.storage = bank;
  const spot = { ...pos(28, 40), findClosestByPath: (xs: unknown[]) => xs[0] };
  const store = createStore({ energy: 290 }, 1200);
  const unit = {
    pos: spot,
    store,
    creep: {
      transfer(s: unknown) {
        assert.equal(s, spawn);
        store.energy = 0;
        return constants.OK;
      },
      withdraw(s: unknown) {
        assert.equal(s, bank);
        store.energy = 1200;
        return constants.OK;
      },
    },
  };
  assert.ok(strategy.supplyGateSpawn(o.colony, unit));
  assert.equal(store.energy, 0);
  assert.ok(strategy.supplyGateSpawn(o.colony, unit));
  assert.equal(store.energy, 1200);
});

test("a collector keeps its pile around a detour instead of oscillating between closer piles", () => {
  const { o, room, pos, game, strategy } = gateBattle();
  const first = { id: "spawn", pos: pos(28, 40), amount: 1500 },
    second = { id: "north", pos: pos(34, 25), amount: 850 };
  room.drops = [first, second];
  const c = { pos: pos(25, 39), memory: {}, store: createStore({ energy: 0 }, 200), move() {} };
  const chosen: number[] = [];
  game.search = (_start: TestScope, goal: TestScope) => {
    chosen.push(goal.pos.x);
    return { incomplete: false, path: [pos(23, 38)] };
  };
  assert.ok(strategy.recoverGateCargo(o.colony, { creep: c }));
  game.time++;
  c.pos = pos(25, 30);
  assert.ok(strategy.recoverGateCargo(o.colony, { creep: c }));
  assert.deepEqual(chosen, [28, 28]);
  room.drops = [second];
  game.time++;
  assert.ok(strategy.recoverGateCargo(o.colony, { creep: c }));
  assert.equal(chosen[2], 34);
});

test("a collector crossing a safe rampart can finish the approach to a nonadjacent spill", () => {
  const { o, room, pos, game, strategy } = gateBattle();
  room.drops = [{ id: "east-spill", pos: pos(33, 48), amount: 900 }];
  const src = pos(30, 47),
    directions: number[] = [];
  const unit = {
    creep: {
      pos: src,
      memory: {},
      store: createStore({}, 1200),
      move: (d: number) => directions.push(d),
    },
  };
  game.search = () => ({ incomplete: false, path: [pos(31, 47), pos(32, 47)] });
  assert.equal(strategy.recoverGateCargo(o.colony, unit), true);
  assert.equal(directions.length, 1);
});

test("a home without carriers dispatches a recovery truck and banks energy from recycled defenders", () => {
  const { o, room, pos, requests } = gateBattle();
  const tomb = { pos: pos(28, 40), store: { energy: 1450 }, ticksToDecay: 75 };
  const bank = { pos: pos(24, 40), store: createStore({ energy: 1 }, 10000) };
  o.colony.storage = room.storage = bank;
  o.colony.tombstones = [tomb];
  o.init();
  assert.ok(requests.some((r) => r.role === "southRecovery"));
  const c = {
    pos: pos(28, 39),
    memory: {},
    store: createStore({ energy: 0 }, 1200),
    withdraw(t: TestScope) {
      assert.equal(t, tomb);
      this.store.energy = 1200;
      return constants.OK;
    },
    transfer(t: TestScope) {
      assert.equal(t, bank);
      this.store.energy = 0;
      return constants.OK;
    },
  };
  o.trucks = [{ creep: c, pos: c.pos }];
  o.run();
  assert.equal(c.store.energy, 1200);
  o.run();
  assert.equal(c.store.energy, 0);
});
test("a south mender waits at the repair line for incoming energy but can refuel without a supplier", () => {
  const { game, o, room, strategy, pos, enemy } = gateBattle();
  game.rooms.E58S44.enemies = [enemy];
  const bank = { pos: pos(24, 40), store: createStore({ energy: 5000 }, 10000) };
  const wall = room.walls.find((w: TestScope) => w.pos.x === 32);
  o.colony.storage = room.storage = bank;
  const truck = {
    room,
    name: "transport_3",
    pos: pos(28, 40),
    memory: {},
    store: createStore({ energy: 1500 }, 1500),
  };
  o.colony.overlords = { logistics: { transporters: [truck] } };
  const moves: number[] = [];
  const atWall = pos(31, 44);
  const c = {
    room,
    name: "southMender_0",
    pos: atWall,
    memory: { role: "southMender" },
    store: createStore({ energy: 0 }, 200),
    withdraw: () => constants.ERR_NOT_IN_RANGE,
    moveTo: (p: TestScope) => moves.push((p.pos || p).x),
  };
  const unit = { creep: c, room, pos: atWall, memory: c.memory, store: c.store, goTo: c.moveTo };
  strategy.supplyWallWorker(o.colony, unit, wall);
  assert.deepEqual(moves, [], "do not walk away from the inbound carrier");
  game.time += 30;
  o.colony.overlords.logistics.transporters = [];
  strategy.supplyWallWorker(o.colony, unit, wall);
  assert.deepEqual(moves, [24], "loss of supply must not strand the mender");
});

test("E58S44 or E58S43 combat contact reserves the first spawn slot for the home guard", () => {
  const { game, o, requests, enemy, strategy } = southDefense();
  for (const room of ["E58S44", "E58S43"]) {
    requests.length = 0;
    o.init();
    assert.deepEqual(
      requests.map((r) => r.role),
      ["southLookout"],
    );
    game.time++;
    requests.length = 0;
    game.rooms[room].enemies = [enemy];
    o.init();
    assert.deepEqual(
      requests.sort((a, b) => a.priority - b.priority).map((r) => [r.role, r.n]),
      [
        ["southGuard", 1],
        ["southMender", 4],
        ["southLookout", 1],
      ],
    );
    assert.equal(o.colony.memory.southWatch.contactRoom, room);
    game.rooms[room].enemies = [];
    game.time++;
    assert.equal(strategy.mobilized(o.colony), false);
    assert.equal(o.colony.memory.southWatch.contactName, enemy.name);
  }
  assert.equal(strategy.isSiegeUnit({ body: [{ type: "move", hits: 100 }] }), false);
});

test("guard and mender recruitment both require a live T3 threat that can withstand the home towers", () => {
  const { game, o, enemy, orders, pos, strategy } = southDefense();
  const part = (type: string, boost?: string, hits = 100) => ({ type, boost, hits });
  const recruitsFor = (body: TestScope[], room = "E58S44", allies: TestScope[] = []) => {
    game.time++;
    for (const r of Object.values(game.rooms) as TestScope[]) r.enemies = [];
    game.rooms[room].enemies = [{ ...enemy, body }, ...allies];
    // Labs may ask before the south gate overlord records this tick.
    const combat = strategy.mobilized(o.colony);
    const roles = orders();
    assert.equal(combat, roles.includes("southGuard"));
    assert.equal(roles.includes("southMender"), roles.includes("southGuard"));
    return roles.includes("southGuard");
  };
  const work = part("work"),
    t3 = part("work", "XZH2O");
  // Recorded passer at tick 84235207, even if the last tower has no shot.
  o.colony.towers[0].store.energy = 9;
  assert.equal(recruitsFor([work, part("move")]), false);
  assert.equal(recruitsFor([work, part("heal", "LHO2")]), false);
  assert.equal(recruitsFor([work, part("heal", "XLHO2", 0)]), false);
  assert.equal(recruitsFor([t3]), true);
  o.colony.towers[0].store.energy = 10;
  assert.equal(recruitsFor([t3]), false);
  const healer = (x: number, count: number, boost = "XLHO2") => ({
    ...enemy,
    id: "medic",
    name: "medic",
    pos: pos(x, 24),
    body: Array(count).fill(part("heal", boost)),
  });
  // At the gate: 150 damage. Three close HEALs restore 144; four restore 192.
  assert.equal(recruitsFor([t3], "E58S44", [healer(25, 3)]), false);
  assert.equal(recruitsFor([t3], "E58S44", [healer(25, 4)]), true);
  assert.equal(recruitsFor([t3], "E58S44", [healer(27, 4)]), true); // the T3 medic itself can tank
  assert.equal(recruitsFor([t3], "E58S44", [healer(25, 5, "LHO2")]), true);
  assert.equal(recruitsFor([t3], "E58S44", [healer(27, 5, "LHO2")]), false);
  assert.equal(recruitsFor([t3, ...healer(24, 2).body]), false); // self-heal counted only once
  assert.equal(recruitsFor([part("tough", "XGHO2"), t3, part("heal", "XLHO2")]), true);
  assert.equal(recruitsFor([t3, part("tough", "XGHO2"), part("heal", "XLHO2")]), false);
  assert.equal(recruitsFor([t3], "E58S42", [healer(25, 4)]), false); // 600 at actual position
  assert.equal(recruitsFor([t3], "E58S43", [healer(25, 4)]), true);
  o.colony.towers.push({ ...o.colony.towers[0] });
  assert.equal(recruitsFor([t3], "E58S43", [healer(25, 4)]), false); // recent alarm still active
});

test("ordinary players are recorded without mobilizing or diverting a hauler", () => {
  const { game, o, enemy, strategy, orders } = southDefense();
  o.colony.memory.southWatch = {
    tick: 99,
    lastContact: 99,
    contactName: "legacy",
    contactRoom: "E58S44",
  };
  assert.equal(strategy.mobilized(o.colony), false);
  for (const type of ["move", "carry", "work", "attack"]) {
    game.time++;
    const name = "passing-" + type;
    game.rooms.E58S44.enemies = [{ ...enemy, name, body: [{ type, hits: 100 }] }];
    assert.deepEqual(orders(), ["southLookout"]);
    const watch = o.colony.memory.southWatch;
    assert.equal(watch.contactName, name);
    assert.equal(watch.lastContact, game.time);
    assert.equal(strategy.mobilized(o.colony), false);
    assert.equal(strategy.supplySouthGate(o.colony, { room: { name: o.colony.name } }), false);
  }
});

test("safe mode clears southern combat orders and only fresh sightings can restart them", () => {
  const { game, o, enemy, strategy, orders } = southDefense();
  game.rooms.E58S44.enemies = [enemy];
  assert.ok(orders().includes("southGuard"));
  game.time++;
  o.colony.controller.safeMode = 2;
  assert.equal(strategy.mobilized(o.colony), false);
  assert.deepEqual(orders(), ["southLookout"]);
  assert.equal(o.colony.memory.southWatch.lastContact, game.time);
  assert.equal(o.colony.memory.southWatch.outerSeen, game.time);
  game.time++;
  game.rooms.E58S44.enemies = [];
  delete o.colony.controller.safeMode;
  assert.deepEqual(orders(), ["southLookout"]);
  game.rooms.E58S43.enemies = [enemy];
  o.colony.controller.safeMode = 1;
  assert.deepEqual(orders(), ["southLookout"]);
  game.time++;
  delete o.colony.controller.safeMode;
  assert.deepEqual(orders(), ["southLookout", "southGuard", "southMender"]);
});

test("losing a westbound unit stops recruitment, but clearing its contact requires northern visibility", () => {
  const { game, o, enemy, orders, pos } = southDefense();
  enemy.pos = pos(0, 25);
  game.rooms.E58S44.enemies = [enemy];
  assert.ok(orders().includes("southGuard"));
  game.time++;
  delete game.rooms.E58S43;
  game.rooms.E58S44.enemies = [];
  assert.deepEqual(orders(), ["southLookout"]);
  assert.equal(o.colony.memory.southWatch.contactName, enemy.name);
  game.time++;
  game.rooms.E58S43 = { enemies: [] };
  assert.deepEqual(orders(), ["southLookout"]);

  assert.equal(o.colony.memory.southWatch.contactName, undefined);

  // A lost tick of outer vision alone cannot establish which exit was taken.
  game.time++;
  game.rooms.E58S44.enemies = [enemy];
  assert.ok(orders().includes("southGuard"));
  game.time++;
  delete game.rooms.E58S44;
  assert.deepEqual(orders(), ["southLookout"]);
  game.time++;
  game.rooms.E58S44 = { enemies: [] };
  assert.deepEqual(orders(), ["southLookout"]);
  assert.equal(o.colony.memory.southWatch.contactName, enemy.name);
  game.rooms.E57S44 = {};
  game.getObjectById = (id: string) => id === enemy.id && { pos: { roomName: "E57S44" } };
  assert.deepEqual(orders(), ["southLookout"]);
  assert.equal(o.colony.memory.southWatch.contactName, undefined);
});

test("one western departure keeps other contacts, including an unresolved northbound unit", () => {
  const { game, o, enemy, orders, pos } = southDefense();
  const westbound = { ...enemy, id: "second", name: "escort", pos: pos(0, 25) };
  enemy.pos = pos(21, 0);
  game.rooms.E58S44.enemies = [westbound, enemy];
  assert.ok(orders().includes("southGuard"));
  game.time++;
  game.rooms.E58S44.enemies = [];
  assert.deepEqual(orders(), ["southLookout"]);
  assert.equal(o.colony.memory.southWatch.contactName, enemy.name);
  game.time++;
  game.rooms.E58S43.enemies = [enemy];
  assert.ok(orders().includes("southMender"));
  assert.equal(o.colony.memory.southWatch.contactRoom, "E58S43");
});

test("a hauler caught south of the wall can cross back inside when the alarm starts", () => {
  const { game, o, enemy, strategy } = southDefense();
  game.rooms.E58S44.enemies = [enemy];
  const moves: TestScope[] = [];
  const room = { name: "E58S42", storage: { store: { energy: 5000 }, pos: { x: 24, y: 40 } } };
  const creep = {
    pos: { x: 23, y: 48 },
    room,
    store: { energy: 0 },
    withdraw: () => constants.ERR_NOT_IN_RANGE,
    moveTo: (target: TestScope, opts: TestScope) => moves.push({ target, opts }),
  };
  o.colony.storage = room.storage;
  assert.equal(strategy.supplySouthGate(o.colony, { creep, room }), true);
  assert.equal(moves[0].target, room.storage);
  assert.equal(moves[0].opts.costCallback, undefined);
});

test("the gate reactor preserves repair stock after the guard consumes its boost during combat", () => {
  const runtime = load("src/hiveClusters/evolutionChamber.ts", {
    "./_HiveCluster": { HiveCluster: class {} },
    "../strategy/southGate": {
      protectsSouthGate: () => true,
      mobilized: () => true,
      guardRole: "southGuard",
      rangerBoosts: ["XKHO2", "KHO2", "KO"],
      guardBoost: "UH2O",
      repairBoost: "LH",
    },
  });
  const chamber = Object.create(runtime.EvolutionChamber.prototype);
  const first = { id: "first" },
    second = { id: "second" },
    output = { store: { UH2O: 0 } };
  const supply: unknown[][] = [];
  Object.assign(chamber, {
    colony: {
      assets: { UH2O: 0, LH: 1920 },
      getCreepsByRole: () => [{ body: [{ boost: "UH2O" }] }],
    },
    reagentLabs: [first, second],
    productLabs: [output],
    boostingLabs: [output],
    terminal: { store: { UH2O: 0 } },
    neededBoosts: {},
    terminalNetwork: { lockResource() {} },
    stockSouthLab: (...args: unknown[]) => supply.push(args),
  });
  assert.equal(chamber.prepareSouthLabs(), true);
  assert.ok(
    supply.some(([lab, resource, amount]) => lab === first && resource === "LH" && amount === 1920),
  );
  assert.equal(chamber.southReactor, undefined);
});
