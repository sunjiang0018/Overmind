const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const constants = require("@screeps/common/lib/constants");
const native = require("./helpers/native-helpers.cjs");
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
function method(file, className, name) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const cls = source.statements.find((n) => ts.isClassDeclaration(n) && n.name.text === className);
  return cls.members.find((n) => n.name && n.name.getText(source) === name).getText(source);
}
function load(
  source,
  scope,
  requireModule = () => {
    throw Error("Unexpected dependency");
  },
) {
  const exports = {};
  new Function("scope", `with(scope){return function(exports,require){${compile(source)}\n}}`)(
    scope,
  )(exports, requireModule);
  return exports;
}
test("transport predictions leave read-only live cargo unchanged for energy and mineral loads", () => {
  const scope = {
    ...native,
    getRoomObjectRef: (o) => o.id,
    minMax: (n, min, max) => Math.min(max, Math.max(min, n)),
    isResource: () => false,
    getStoreContents: (store) => Object.entries(store),
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
  const original = Object.freeze({ energy: 100 });
  const transport = { task: { target: { id: "source" } }, carry: original, carryCapacity: 1000 };
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

function transporterHarness(energy, predicted = 0, choices = []) {
  const storage = { id: "storage", pos: { x: 24, y: 40 } };
  const target = { id: "requestTarget", store: { energy: 0 } };
  const request = { id: "0", target, multiplier: 1, resourceType: "energy", amount: -256 };
  const calls = { park: 0, invalidate: 0 };
  const Tasks = Object.fromEntries(
    ["transfer", "transferAll", "withdraw", "withdrawAll", "pickup"].map((name) => [
      name,
      (target) => ({
        name,
        target,
        fork(child) {
          child.parent = this;
          return child;
        },
      }),
    ]),
  );
  const scope = {
    ...native,
    ...constants,
    Tasks,
    getRoomObjectRef: (target) => target.id,
    roomPositionFindClosestByMultiRoomRange: (pos, targets) => targets[0],
    isResource: () => false,
    isTombstone: () => false,
    isRuin: () => false,
    isDirective: () => false,
    isAnyZerg: () => false,
    deref: (id) => (id === storage.id ? storage : target),
  };
  const Transport = load(
    `export class Transport {${["handleTransporter", "handleSmolTransporter"]
      .map((name) => method("src/overlords/core/transporter.ts", "TransportOverlord", name))
      .join("\n")}}`,
    scope,
  ).Transport;
  const colony = {
    storage,
    logisticsNetwork: {
      transporterPreferences: () => [request],
      bufferChoices: () => choices,
      predictedRequestAmount: () => predicted,
      invalidateCache: () => calls.invalidate++,
    },
  };
  const overlord = Object.assign(new Transport(), { colony });
  const transporter = {
    name: "transport",
    carry: { energy },
    carryCapacity: 1200,
    hasMineralsInCarry: false,
    pos: {},
    task: null,
    park() {
      calls.park++;
    },
  };
  return { overlord, transporter, calls, storage, target };
}

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
  minerals.transporter.carry.H = 100;
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
