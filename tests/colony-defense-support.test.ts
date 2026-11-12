import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import type { TestScope } from "./helpers/types";
import { constants } from "./helpers/constants";
import * as native from "../src/utilities/native";

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
