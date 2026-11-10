import { createStore } from "./helpers/store";
import type { TestScope } from "./helpers/types";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { constants } from "./helpers/constants";

import * as native from "../src/utilities/native";

function loadModule(file: string, deps: TestScope = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2024,
      useDefineForClassFields: false,
      experimentalDecorators: true,
    },
  }).outputText;
  const out: TestScope = {};
  new Function("scope", `with(scope){return function(exports,require){${code}}}`)(constants)(
    out,
    (n: string) => deps[n] || {},
  );
  return out;
}

const queenDelivery = loadModule("src/overlords/core/queenDelivery.ts", {
  "../../tasks/instances/transfer": { transferTaskName: "transfer" },
  "../../game/RoomStructures": {
    getRoomContainers: (room: TestScope) => room.containers,
    getRoomLinks: (room: TestScope) => room.links,
  },
});

function runtime() {
  const assigned: TestScope[] = [],
    ran: TestScope[] = [],
    parked: unknown[][] = [];
  let request: { target: TestScope } | undefined;
  const queen: TestScope = {
    room: { containers: [], links: [] },
    actionLog: {},
    memory: {},
    store: createStore({ energy: 95 }, 1500),
    pos: { x: 30, y: 38 },
    get task() {
      return this._task;
    },
    set task(task) {
      this._task = task;
      assigned.push(task);
    },
    get hasValidTask() {
      if (this._task && !this._task.valid()) this._task = null;
      return !!this._task;
    },
    get isIdle() {
      return !this.hasValidTask;
    },
    run() {
      ran.push(this.task);
    },
    goTo: (...args: unknown[]) => parked.push(args),
  };
  queen.pos.findClosestByRange = (targets: TestScope[]) => targets[0];
  const Tasks = {
    transfer: (target: TestScope) => ({
      name: "transfer",
      target,
      valid: () => queen.store.energy > 0 && target.energy < target.capacity,
    }),
    withdraw: (target: TestScope) => ({
      name: "withdraw",
      target,
      valid: () => queen.store.getFreeCapacity() > 0 && target.energy > 0,
    }),
    recharge: () => null,
  };
  const deps: TestScope = {
    "../Overlord": { Overlord: class {} },
    "./queenDelivery": queenDelivery,
    "../../profiler/decorator": { profile: <T>(x: T) => x },
    "../../game/Structures": {
      getStoredEnergy: (target: TestScope) => target.energy,
      isStructureEmpty: (target: TestScope) => target.energy === 0,
      isStructureFull: (target: TestScope) => target.energy === target.capacity,
    },
    "../../tasks/Tasks": { Tasks },
  };
  const out = loadModule("src/overlords/core/queen.ts", deps);
  const overlord = Object.create(out.QueenOverlord.prototype);
  Object.assign(overlord, {
    queens: [queen],
    hatchery: {
      batteries: [],
      idlePos: { x: 27, y: 40 },
      transportRequests: { getPrioritizedClosestRequest: () => request },
    },
  });
  return {
    overlord,
    queen,
    assigned,
    ran,
    parked,
    Tasks,
    request: (target?: TestScope) => {
      request = target ? { target } : undefined;
    },
  };
}

test("queen keeps its delivery while closer requests change along the route", () => {
  const r = runtime();
  const north = { id: "north", x: 28, y: 37, energy: 0, capacity: 50 };
  const south = { id: "south", x: 30, y: 41, energy: 0, capacity: 50 };
  r.request(north);
  r.overlord.run();
  const delivery = r.queen.task;
  for (const target of [south, north, south, north]) {
    r.request(target);
    r.overlord.run();
    assert.equal(r.queen.task, delivery);
  }
  assert.equal(r.assigned.length, 1, "moving must not replace a valid delivery");
  assert.equal(r.ran.length, 5);
  assert.equal(r.parked.length, 0);
});

test("queen selects another delivery when its target has been filled by another creep", () => {
  const r = runtime();
  const first = { energy: 0, capacity: 50 },
    next = { energy: 0, capacity: 50 };
  r.request(first);
  r.overlord.run();
  first.energy = first.capacity;
  r.request(next);
  r.overlord.run();
  assert.equal(r.queen.task.target, next);
  assert.equal(r.assigned.length, 2);
});

test("queen recharges after using up its delivery energy", () => {
  const r = runtime();
  r.request({ energy: 0, capacity: 50 });
  r.overlord.run();
  r.queen.store.energy = 0;
  const link = (r.overlord.hatchery.link = { energy: 776, capacity: 800 });
  r.overlord.run();
  assert.equal(r.queen.task.name, "withdraw");
  assert.equal(r.queen.task.target, link);
});

test("queen completes a valid recharge before choosing a new delivery", () => {
  const r = runtime(),
    link = { energy: 776, capacity: 800 };
  r.queen.task = r.Tasks.withdraw(link);
  const recharge = r.queen.task;
  r.request({ energy: 0, capacity: 50 });
  r.overlord.run();
  assert.equal(r.queen.task, recharge);
  r.queen.store.energy = r.queen.store.getCapacity();
  r.overlord.run();
  assert.equal(r.queen.task.name, "transfer");
});

test("queen replans a recharge if its source becomes empty", () => {
  const r = runtime();
  r.queen.store.energy = 0;
  const previous = { energy: 100, capacity: 800 },
    next = { energy: 776, capacity: 800 };
  r.queen.task = r.Tasks.withdraw(previous);
  previous.energy = 0;
  r.overlord.hatchery.link = next;
  r.overlord.run();
  assert.equal(r.queen.task.target, next);
});

test("queen returns to the hatchery when no valid work or recharge source exists", () => {
  const r = runtime();
  r.queen.store.energy = 0;
  r.overlord.run();
  assert.equal(r.ran.length, 0);
  assert.deepEqual(r.parked, [[r.overlord.hatchery.idlePos]]);
});

function bufferedRuntime() {
  const r = runtime();
  r.overlord.colony = { roomPlanner: { memory: { logisticsPolicy: { queenBufferFirst: true } } } };
  r.queen.store.energy = 0;
  return r;
}

test("buffered queen takes a full load from a container before an 800-energy link", () => {
  const r = bufferedRuntime();
  const battery = { energy: 2000, capacity: 2000 };
  r.overlord.hatchery.batteries = [battery];
  r.overlord.hatchery.link = { energy: 800, capacity: 800 };
  r.overlord.run();
  assert.equal(r.queen.task.target, battery);
});

test("buffered queen uses a link if it can fill the requested remaining capacity", () => {
  const r = bufferedRuntime();
  r.queen.store.energy = 900;
  r.overlord.hatchery.batteries = [{ energy: 100, capacity: 2000 }];
  const link = (r.overlord.hatchery.link = { energy: 800, capacity: 800 });
  r.overlord.rechargeActions(r.queen);
  assert.equal(r.queen.task.target, link);
});

test("buffered queen uses available partial energy instead of waiting for a full buffer", () => {
  const r = bufferedRuntime();
  const battery = { energy: 1000, capacity: 2000 };
  r.overlord.hatchery.batteries = [battery];
  r.overlord.hatchery.link = { energy: 800, capacity: 800 };
  r.overlord.run();
  assert.equal(r.queen.task.target, battery);
  r.queen.task = null;
  battery.energy = 0;
  r.overlord.run();
  assert.equal(r.queen.task.target, r.overlord.hatchery.link);
});

test("buffered queen retains a valid recharge while the other source refills", () => {
  const r = bufferedRuntime();
  const battery = { energy: 2000, capacity: 2000 };
  r.overlord.hatchery.batteries = [battery];
  r.overlord.run();
  const task = r.queen.task;
  r.overlord.hatchery.link = { energy: 800, capacity: 800 };
  r.overlord.run();
  assert.equal(r.queen.task, task);
});

for (const bufferFirst of [false, true]) {
  test(`queen finishes a partial refill across two buffers (bufferFirst=${bufferFirst})`, () => {
    const r = bufferFirst ? bufferedRuntime() : runtime();
    r.queen.store.energy = 0;
    r.queen.store.H = 100;
    const link = (r.overlord.hatchery.link = { energy: 800, capacity: 800 });
    const battery = { energy: 700, capacity: 2000 };
    r.overlord.hatchery.batteries = [battery];
    r.request({ energy: 0, capacity: 50 });
    for (const source of [link, battery]) {
      r.overlord.run();
      assert.equal(r.queen.task.name, "withdraw");
      assert.equal(r.queen.task.target, source);
      const amount = Math.min(r.queen.store.getFreeCapacity(), source.energy);
      r.queen.store.energy += amount;
      source.energy -= amount;
      r.queen.task = null; // successful one-shot withdraw
    }
    r.overlord.run();
    assert.equal(r.queen.store.energy, 1400);
    assert.equal(battery.energy, 100);
    assert.equal(r.queen.task.name, "transfer");
    assert.equal(r.queen.memory.queenRecharging, undefined);
  });
}

test("queen delivers a partial load as soon as its last buffer runs dry", () => {
  const r = runtime();
  r.queen.store.energy = 0;
  const link = (r.overlord.hatchery.link = { energy: 200, capacity: 800 });
  r.overlord.run();
  r.queen.store.energy = link.energy;
  link.energy = 0;
  r.queen.task = null;
  r.request({ energy: 0, capacity: 50 });
  r.overlord.run();
  assert.equal(r.queen.task.name, "transfer");
  assert.equal(r.queen.memory.queenRecharging, undefined);
});

function bunkerSupplyPlan(
  stores: TestScope[],
  resources: Record<string, number>,
  requests: [string, number][],
) {
  const deps: TestScope = {
    "../Overlord": { Overlord: class {} },
    "./queenDelivery": queenDelivery,
    "../../profiler/decorator": { profile: <T>(x: T) => x },
    "../../utilities/native": native,
    "../../utilities/utils": loadModule("src/utilities/utils.ts", { "./native": native }),
    "../../movement/Pathing": { Pathing: { distance: (_from: number, to: number) => to } },
    "../../tasks/Tasks": {
      Tasks: {
        transfer: (target: TestScope, resource: string, amount: number) => [
          "transfer",
          target.id,
          resource,
          amount,
        ],
        withdraw: (target: TestScope, resource = "energy", amount?: number) => [
          "withdraw",
          target.id,
          resource,
          amount,
        ],
        chain: (tasks: unknown[]) => tasks,
      },
    },
  };
  const { BunkerQueenOverlord } = loadModule("src/overlords/core/queen_bunker.ts", deps);
  const overlord = Object.create(BunkerQueenOverlord.prototype);
  const supply = requests.map(([resourceType, amount]) => ({
    target: { id: "lab" },
    resourceType,
    amount,
  }));
  overlord.storeStructures = stores;
  overlord.colony = {
    transportRequests: { supply: { 1: supply } },
    terminal: stores.find((s) => s.structureType == "terminal"),
  };
  overlord.assignments = { queen: { lab: true } };
  return overlord.buildSupplyTaskManifest({
    name: "queen",
    pos: 0,
    store: createStore(resources, 1500),
  });
}

test("bunker queen loads ordered minerals, then fills spare capacity from link and container", () => {
  const stores = [
    { id: "link", structureType: "link", pos: 1, store: { energy: 800 } },
    { id: "battery", structureType: "container", pos: 2, store: { energy: 700 } },
    { id: "terminal", structureType: "terminal", pos: 3, store: { H: 100 } },
  ];
  assert.deepEqual(
    bunkerSupplyPlan(stores, { energy: 0 }, [
      ["energy", 50],
      ["H", 100],
    ]),
    [
      ["withdraw", "terminal", "H", 100],
      ["withdraw", "link", "energy", undefined],
      ["withdraw", "battery", "energy", undefined],
      ["transfer", "lab", "energy", 50],
      ["transfer", "lab", "H", 100],
    ],
  );
  assert.deepEqual(bunkerSupplyPlan(stores, { energy: 1350 }, [["energy", 50]]), [
    ["transfer", "lab", "energy", 50],
  ]);
});

test("bunker queen unloads only the surplus energy that would block a mineral order", () => {
  const terminal = { id: "terminal", structureType: "terminal", pos: 1, store: { H: 150 } };
  assert.deepEqual(bunkerSupplyPlan([terminal], { energy: 1450 }, [["H", 150]]), [
    ["transfer", "terminal", "energy", 100],
    ["withdraw", "terminal", "H", 150],
    ["transfer", "lab", "H", 150],
  ]);
});

test("bunker queen draws only the outstanding order quantity from storage", () => {
  const storage = { id: "storage", structureType: "storage", pos: 1, store: { energy: 9000 } };
  assert.deepEqual(bunkerSupplyPlan([storage], { energy: 30 }, [["energy", 50]]), [
    ["withdraw", "storage", "energy", 20],
    ["transfer", "lab", "energy", 50],
  ]);
});

test("bunker queen leaves a split buffer withdrawal uncapped if the buffer refills en route", () => {
  const stores = [
    { id: "link", structureType: "link", pos: 1, store: { energy: 500 } },
    { id: "storage", structureType: "storage", pos: 2, store: { energy: 300 } },
  ];
  assert.deepEqual(bunkerSupplyPlan(stores, { energy: 0 }, [["energy", 700]]), [
    ["withdraw", "storage", "energy", 200],
    ["withdraw", "link", "energy", undefined],
    ["transfer", "lab", "energy", 700],
  ]);
});

function passingQueen(energy: number) {
  const r = runtime();
  const withdrawals: TestScope[] = [];
  r.queen.store.energy = energy;
  r.queen.pos.isNearTo = (pos: TestScope) =>
    Math.max(Math.abs(pos.x - r.queen.pos.x), Math.abs(pos.y - r.queen.pos.y)) <= 1;
  r.queen.withdraw = (source: TestScope, resource: string) => {
    assert.equal(resource, "energy");
    withdrawals.push(source);
    r.queen.actionLog.withdraw = true;
  };
  r.queen.run = () => {
    r.queen.actionLog.move = true;
  };
  r.request({ energy: 0, capacity: 50, structureType: "extension" });
  return { ...r, withdrawals };
}

test("moving queen below 40% keeps its delivery and fills from one adjacent buffer", () => {
  const r = passingQueen(599);
  const distant = { pos: { x: 32, y: 38 }, store: { energy: 2000 } };
  const small = { pos: { x: 30, y: 38 }, store: { energy: 40 } };
  const link = { pos: { x: 31, y: 39 }, store: { energy: 800 } };
  r.queen.store.H = 150; // leaves 751 space at the time of withdraw
  r.queen.room = { containers: [distant, small], links: [link] };
  r.overlord.run();
  assert.deepEqual(r.withdrawals, [link]);
  assert.equal(r.queen.task.name, "transfer");
  assert.equal(r.assigned.length, 1);
  assert.equal(r.queen.memory.queenRecharging, undefined);
});

test("passing refill skips 40%, full mixed cargo, cargo actions and deposit trips", () => {
  const r = passingQueen(600);
  r.queen.room.containers = [{ pos: r.queen.pos, store: { energy: 1000 } }];
  r.overlord.run();
  r.queen.store.energy = 599;
  r.queen.store.H = 901;
  r.overlord.run();
  r.queen.store.H = 0;
  r.queen.actionLog.transfer = true;
  r.overlord.run();
  r.queen.actionLog.transfer = false;
  r.queen.task = r.Tasks.transfer({ energy: 0, capacity: 2000, structureType: "storage" });
  r.overlord.run();
  assert.deepEqual(r.withdrawals, []);
});

test("bunker queen takes the largest partial load after a movement tick", () => {
  const r = passingQueen(20);
  const battery = { pos: r.queen.pos, store: { energy: 350 } };
  r.queen.room = { containers: [battery], links: [{ pos: r.queen.pos, store: { energy: 200 } }] };
  r.queen.task = r.Tasks.transfer({ energy: 0, capacity: 50, structureType: "spawn" });
  const { BunkerQueenOverlord } = loadModule("src/overlords/core/queen_bunker.ts", {
    "../Overlord": { Overlord: class {} },
    "../../profiler/decorator": { profile: <T>(x: T) => x },
    "./queenDelivery": queenDelivery,
  });
  const bunker = Object.create(BunkerQueenOverlord.prototype);
  bunker.queens = [r.queen];
  bunker.autoRun = () => r.queen.run();
  bunker.run();
  assert.deepEqual(r.withdrawals, [battery]);
  assert.equal(r.queen.task.name, "transfer");
});
