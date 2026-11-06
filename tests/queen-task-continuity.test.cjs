const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const constants = require("@screeps/common/lib/constants");

function runtime() {
  const code = ts.transpileModule(fs.readFileSync("src/overlords/core/queen.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2024,
      useDefineForClassFields: false,
      experimentalDecorators: true,
    },
  }).outputText;
  const assigned = [],
    ran = [],
    parked = [];
  let request;
  const queen = {
    carry: { energy: 95 },
    carryCapacity: 1500,
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
    goTo: (...args) => parked.push(args),
  };
  queen.pos.findClosestByRange = (targets) => targets[0];
  const Tasks = {
    transfer: (target) => ({
      name: "transfer",
      target,
      valid: () => queen.carry.energy > 0 && target.energy < target.capacity,
    }),
    withdraw: (target) => ({
      name: "withdraw",
      target,
      valid: () => queen.carry.energy < queen.carryCapacity && target.energy > 0,
    }),
    recharge: () => null,
  };
  const deps = {
    "../Overlord": { Overlord: class {} },
    "../../profiler/decorator": { profile: (x) => x },
    "../../game/Structures": {
      getStoredEnergy: (target) => target.energy,
      isStructureEmpty: (target) => target.energy === 0,
      isStructureFull: (target) => target.energy === target.capacity,
    },
    "../../tasks/Tasks": { Tasks },
  };
  const out = {};
  new Function("scope", `with(scope){return function(exports,require){${code}}}`)(constants)(
    out,
    (n) => deps[n] || {},
  );
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
    request: (target) => {
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
  r.queen.carry.energy = 0;
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
  r.queen.carry.energy = r.queen.carryCapacity;
  r.overlord.run();
  assert.equal(r.queen.task.name, "transfer");
});

test("queen replans a recharge if its source becomes empty", () => {
  const r = runtime();
  r.queen.carry.energy = 0;
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
  r.queen.carry.energy = 0;
  r.overlord.run();
  assert.equal(r.ran.length, 0);
  assert.deepEqual(r.parked, [[r.overlord.hatchery.idlePos]]);
});
