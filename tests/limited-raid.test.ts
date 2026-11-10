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

function fixture() {
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
    constructor(directive: TestScope) {
      this.memory = directive.memory.raid;
      this.colony = directive.colony;
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
  const creep = (role: string, roomName = "E58S44", x = 2, y = 25) => {
    const name = `raid_${role}_0`,
      body = api.raidBody(role);
    const unit: TestScope = {
      name,
      body: body.map((type: string) => ({ type, hits: 100 })),
      pos: new Position(x, y, roomName),
      room: scope.Game.rooms[roomName],
      memory: {},
      spawning: false,
      ticksToLive: 1400,
      hits: body.length * 100,
      hitsMax: body.length * 100,
      store: makeStore(),
    };
    unit.getActiveBodyparts = (part: string) => body.filter((p: string) => p === part).length;
    unit.goTo = (destination: TestScope, options: TestScope) =>
      calls.push({ action: "move", role, destination, options });
    unit.creep = Object.fromEntries(
      ["attack", "rangedAttack", "heal", "rangedHeal", "dismantle", "withdraw", "transfer"].map(
        (action) => [
          action,
          (object: TestScope, ...args: unknown[]) => {
            calls.push({ action, role, object, args });
            return unit.pos.isNearTo(object) ? C.OK : C.ERR_NOT_IN_RANGE;
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

test("the complete unboosted wave costs 9480 and every fixed body fits RCL6", () => {
  const f = fixture();
  assert.equal(
    f.api.RAID_ROLES.reduce(
      (n: number, role: string) => n + f.api.raidBodyCost(f.api.raidBody(role)),
      0,
    ),
    9480,
  );
  for (const role of f.api.RAID_ROLES) {
    assert.ok(f.api.raidBody(role).length <= 50);
    assert.ok(f.api.raidBodyCost(f.api.raidBody(role)) <= 2300);
  }
  assert.equal(f.api.raidBody("tank").at(-1), C.MOVE);
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
