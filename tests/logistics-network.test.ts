import { createStore } from "./helpers/store";
import { classMembers } from "./helpers/source";
import type { TestScope } from "./helpers/types";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import ts from "typescript";
import { constants } from "./helpers/constants";
import * as native from "../src/utilities/native";
const compile = (source: string) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
function method(file: string, className: string, name: string) {
  return classMembers(file, className, [name]);
}
function load(
  source: string,
  scope: TestScope,
  requireModule = () => {
    throw Error("Unexpected dependency");
  },
) {
  const exports: TestScope = {};
  new Function("scope", `with(scope){return function(exports,require){${compile(source)}\n}}`)(
    scope,
  )(exports, requireModule);
  return exports;
}
test("transport predictions leave read-only live cargo unchanged for energy and mineral loads", () => {
  const scope: TestScope = {
    ...native,
    getRoomObjectRef: (o: { id: string }) => o.id,
    minMax: (n: number, min: number, max: number) => Math.min(max, Math.max(min, n)),
    isResource: () => false,
    getStoreContents: (store: Record<string, number>) => Object.entries(store),
  };
  const Network = load(
    `export class Network {${method("src/logistics/LogisticsNetwork.ts", "LogisticsNetwork", "computePredictedTransporterCarry")}}`,
    scope,
  ).Network;
  const net = Object.assign(new Network(), {
    targetToRequest: { source: 0 },
    requests: [{ resourceType: "energy" }],
    predictedRequestAmount: () => -200,
  });
  const original = Object.freeze(createStore({ energy: 100 }, 1000));
  const transport = { task: { target: { id: "source" } }, store: original };
  assert.deepEqual(net.computePredictedTransporterCarry(transport), { energy: 300 });
  assert.deepEqual(original, { energy: 100 });
  net.requests[0] = { resourceType: "all", target: { store: { energy: 100, H: 100 } } };
  assert.deepEqual(net.computePredictedTransporterCarry(transport), { energy: 200, H: 100 });
  assert.deepEqual(original, { energy: 100 });
  net.predictedRequestAmount = () => -2000;
  assert.deepEqual(net.computePredictedTransporterCarry(transport), { energy: 550, H: 450 });
  net.requests[0] = { resourceType: "energy" };
  assert.deepEqual(net.computePredictedTransporterCarry(transport), { energy: 1000 });
  net.predictedRequestAmount = () => 2000;
  assert.deepEqual(net.computePredictedTransporterCarry(transport), { energy: 0 });
  assert.deepEqual(original, { energy: 100 });
});

test("a singleton logistics request can be assigned without a precomputed rate cache", () => {
  const Network = load(
    `export class Network {${["transporterPreferences", "invalidateCache"]
      .map((name) => method("src/logistics/LogisticsNetwork.ts", "LogisticsNetwork", name))
      .join("\n")}}`,
    native,
  ).Network;
  const request = { id: "0" },
    transport = { name: "transport_1" };
  const net = Object.assign(new Network(), {
    requests: [request],
    cache: {
      nextAvailability: { transport_1: [5, {}] },
      predictedTransporterCarry: { transport_1: { energy: 500 } },
      resourceChangeRate: {},
    },
    resourceChangeRate: () => 1,
  });
  assert.equal(net.transporterPreferences(transport)[0], request);
  assert.doesNotThrow(() => net.invalidateCache(transport, request));
  assert.deepEqual(net.cache.nextAvailability, {});
  assert.deepEqual(net.cache.predictedTransporterCarry, {});
  net.cache.resourceChangeRate["0"] = { transport_1: 12, transport_2: 5 };
  net.invalidateCache(transport, request);
  assert.deepEqual(net.cache.resourceChangeRate["0"], { transport_2: 5 });
});

function transporterHarness(
  energy: number,
  predicted = 0,
  choices: { dQ: number; dt: number; targetRef: string }[] = [],
) {
  const storage = { id: "storage", pos: { x: 24, y: 40 } };
  const target = { id: "requestTarget", store: { energy: 0 } };
  const request = { id: "0", target, multiplier: 1, resourceType: "energy", amount: -256 };
  const calls = { park: 0, invalidate: 0 };
  const Tasks = Object.fromEntries(
    ["transfer", "transferAll", "withdraw", "withdrawAll", "pickup"].map((name) => [
      name,
      (target: TestScope, resourceType?: string) => ({
        name,
        target,
        resourceType,
        fork(child: TestScope) {
          child.parent = this;
          return child;
        },
      }),
    ]),
  );
  const scope: TestScope = {
    ...native,
    ...constants,
    Tasks,
    Roles: { worker: "worker", pioneer: "pioneer", upgrader: "upgrader" },
    getRoomObjectRef: (target: TestScope) => target.id,
    roomPositionFindClosestByMultiRoomRange: (_pos: unknown, targets: TestScope[]) => targets[0],
    isResource: () => false,
    isTombstone: () => false,
    isRuin: () => false,
    isDirective: () => false,
    isAnyZerg: () => false,
    deref: (id: string) => (id === storage.id ? storage : target),
  };
  const Transport = load(
    `export class Transport {${[
      "supplyWithoutStorage",
      "handleTransporter",
      "handleSmolTransporter",
    ]
      .map((name) => method("src/overlords/core/transporter.ts", "TransportOverlord", name))
      .join("\n")}}`,
    scope,
  ).Transport;
  const colony: TestScope = {
    name: "E57S45",
    storage,
    spawns: [],
    extensions: [],
    creeps: [],
    logisticsNetwork: {
      transporterPreferences: () => [request],
      bufferChoices: () => choices,
      predictedRequestAmount: () => predicted,
      invalidateCache: () => calls.invalidate++,
    },
  };
  const overlord = Object.assign(new Transport(), { colony });
  const transporter: TestScope = {
    name: "transport",
    store: createStore({ energy }, 1200),
    hasMineralsInCarry: false,
    pos: {},
    task: null,
    park() {
      calls.park++;
    },
  };
  return { overlord, transporter, calls, storage, target, colony };
}

function energyTarget(id: string, energy: number, capacity: number) {
  return {
    id,
    pos: { roomName: "E57S45" },
    store: { energy, getFreeCapacity: () => capacity - energy },
  };
}

function workerTarget(role = "worker", energy = 0, work = 2): TestScope {
  return {
    ...energyTarget(role, energy, 100),
    memory: { role },
    spawning: false,
    getActiveBodyparts: () => work,
  };
}

test("a full transport in a new colony delivers to Spawn despite source-only requests", () => {
  const h = transporterHarness(200, -1800, [{ dQ: 0, dt: 2, targetRef: "requestTarget" }]);
  delete h.colony.storage;
  const spawn = energyTarget("spawn", 231, 300);
  h.colony.spawns = [spawn];
  h.colony.creeps = [workerTarget()];
  h.overlord.handleSmolTransporter(h.transporter);
  assert.equal(h.transporter.task.name, "transfer");
  assert.equal(h.transporter.task.target, spawn);
  assert.equal(h.transporter.task.resourceType, "energy");
  assert.equal(h.calls.park, 0);
});

test("without Storage, transporters supply extensions after Spawn is full", () => {
  const h = transporterHarness(200);
  delete h.colony.storage;
  h.colony.spawns = [energyTarget("spawn", 300, 300)];
  const extension = energyTarget("extension", 0, 50);
  h.colony.extensions = [extension];
  h.overlord.handleTransporter(h.transporter, undefined);
  assert.equal(h.transporter.task.target, extension);
});

test("without Storage, transporters feed hungry workers even while workers are recharging", () => {
  for (const role of ["worker", "pioneer", "upgrader"]) {
    const h = transporterHarness(200);
    delete h.colony.storage;
    h.colony.spawns = [energyTarget("spawn", 300, 300)];
    const worker = workerTarget(role);
    worker.memory.task = { name: "withdraw" };
    h.colony.creeps = [worker];
    h.overlord.handleSmolTransporter(h.transporter);
    assert.equal(h.transporter.task.target, worker);
    assert.equal(h.transporter.task.resourceType, "energy");
  }
});

test("emergency worker supply skips miners, spawning, remote, full and inactive workers", () => {
  const h = transporterHarness(200);
  delete h.colony.storage;
  const spawning = workerTarget();
  spawning.spawning = true;
  const remote = workerTarget();
  remote.pos.roomName = "E58S42";
  const eligible = workerTarget("worker", 49);
  h.colony.creeps = [
    workerTarget("drone"),
    spawning,
    remote,
    workerTarget("worker", 100),
    workerTarget("worker", 0, 0),
    workerTarget("worker", 50),
    eligible,
  ];
  h.overlord.handleSmolTransporter(h.transporter);
  assert.equal(h.transporter.task.target, eligible);
});

test("mixed cargo can still deliver its energy in a colony without Storage", () => {
  const h = transporterHarness(100);
  delete h.colony.storage;
  h.transporter.store.H = 100;
  h.transporter.hasMineralsInCarry = true;
  const worker = workerTarget();
  h.colony.creeps = [worker];
  h.overlord.handleSmolTransporter(h.transporter);
  assert.equal(h.transporter.task.name, "transfer");
  assert.equal(h.transporter.task.target, worker);
});

test("empty transports keep collecting energy instead of receiving a delivery task", () => {
  const h = transporterHarness(0, -200, [{ dQ: 200, dt: 10, targetRef: "requestTarget" }]);
  delete h.colony.storage;
  h.colony.spawns = [energyTarget("spawn", 0, 300)];
  h.overlord.handleSmolTransporter(h.transporter);
  assert.equal(h.transporter.task.name, "withdraw");
  assert.equal(h.transporter.task.target, h.target);
});

test("Storage colonies retain their existing unload behavior", () => {
  const h = transporterHarness(200);
  h.colony.spawns = [energyTarget("spawn", 0, 300)];
  h.colony.creeps = [workerTarget()];
  h.overlord.handleSmolTransporter(h.transporter);
  assert.equal(h.transporter.task.target, h.storage);
});

test("no Storage and no energy consumer leaves loaded cargo intact", () => {
  const h = transporterHarness(200);
  delete h.colony.storage;
  h.colony.spawns = [energyTarget("spawn", 300, 300)];
  h.overlord.handleSmolTransporter(h.transporter);
  assert.equal(h.transporter.task, null);
  assert.equal(h.transporter.store.energy, 200);
});

test("loaded transports return to Storage when the only request is already covered", () => {
  // Live regression: 1200 and 298 energy, one -256 output request, predicted amount 0 and no buffer choices.
  for (const energy of [1200, 298]) {
    const h = transporterHarness(energy);
    h.overlord.handleSmolTransporter(h.transporter);
    assert.equal(h.transporter.task.name, "transfer");
    assert.equal(h.transporter.task.target, h.storage);
    assert.equal(h.calls.park, 0);
    assert.equal(h.calls.invalidate, 1);
  }
});

test("unfulfillable requests unload minerals or park empty transports without zero-amount withdrawals", () => {
  const minerals = transporterHarness(0);
  minerals.transporter.store.H = 100;
  minerals.transporter.hasMineralsInCarry = true;
  minerals.overlord.handleSmolTransporter(minerals.transporter);
  assert.equal(minerals.transporter.task.name, "transferAll");
  assert.equal(minerals.transporter.task.target, minerals.storage);
  const empty = transporterHarness(0, 500, [{ dQ: 0, dt: 10, targetRef: "storage" }]);
  empty.overlord.handleSmolTransporter(empty.transporter);
  assert.equal(empty.transporter.task, null);
  assert.equal(empty.calls.park, 1);
});

test("transports continue useful pickups and deliveries instead of always returning home", () => {
  const pickup = transporterHarness(0, -200, [{ dQ: 200, dt: 10, targetRef: "requestTarget" }]);
  pickup.overlord.handleSmolTransporter(pickup.transporter);
  assert.equal(pickup.transporter.task.name, "withdraw");
  assert.equal(pickup.transporter.task.target, pickup.target);
  const delivery = transporterHarness(300, 200, [{ dQ: 200, dt: 10, targetRef: "requestTarget" }]);
  delivery.overlord.handleSmolTransporter(delivery.transporter);
  assert.equal(delivery.transporter.task.name, "transfer");
  assert.equal(delivery.transporter.task.target, delivery.target);
});
