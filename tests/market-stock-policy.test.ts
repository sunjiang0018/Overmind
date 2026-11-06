import { classMembers } from "./helpers/source";
import type { TestScope } from "./helpers/types";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
function load(file: string, name: string, methods: string[], context: TestScope) {
  const src = `class ${name}{${classMembers(file, name, methods)}};globalThis.Subject=${name};`;
  vm.runInNewContext(
    ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2024 } }).outputText,
    context,
  );
  return context.Subject;
}
function network() {
  const ctx: TestScope = {
    getRoomMineral: (r: TestScope) => r.mineral,
    Abathur: { isBaseMineral: (r: string) => ["H", "O", "X"].includes(r) },
    TN_STATE: { activeRequestor: 1 },
  };
  const N = load(
      "src/logistics/TerminalNetwork_v2.ts",
      "TerminalNetworkV2",
      ["isLocallyProduced", "shouldKeepBuyOrder"],
      ctx,
    ),
    n = new N();
  n.colonyStates = { home: {} };
  let target = 7000;
  n.thresholds = () => ({ target });
  const c: TestScope = {
    name: "home",
    assets: { H: 0 },
    room: { mineral: { mineralType: "H", mineralAmount: 0, pos: {} } },
    extractors: [{ pos: { isEqualTo: () => true }, isActive: () => true }],
  };
  return { n, c, target: (x: number) => (target = x) };
}
test("self-produced mineral waits through regeneration without passive purchase", () => {
  const { n, c } = network();
  assert.equal(n.isLocallyProduced(c, "H"), true);
  assert.equal(n.shouldKeepBuyOrder(c, "H"), false);
  assert.equal(n.isLocallyProduced(c, "O"), false);
});
test("insufficient nonlocal minerals retain buy orders; target reached cancels", () => {
  const { n, c } = network();
  c.assets.O = 6500;
  assert.equal(n.shouldKeepBuyOrder(c, "O"), true);
  c.assets.O = 7000;
  assert.equal(n.shouldKeepBuyOrder(c, "O"), false);
});
test("explicit urgent local request survives until its actual target is met", () => {
  const { n, c, target } = network();
  n.colonyStates.home.H = 1;
  target(10000);
  c.assets.H = 8000;
  assert.equal(n.shouldKeepBuyOrder(c, "H"), true);
  c.assets.H = 10000;
  assert.equal(n.shouldKeepBuyOrder(c, "H"), false);
});
test("local mineral without a working extractor can still be bought", () => {
  const { n, c } = network();
  c.extractors = [];
  assert.equal(n.shouldKeepBuyOrder(c, "H"), true);
});
test("order cleanup cancels excess and self-produced purchases without touching useful buys or sales", () => {
  const { n, c } = network();
  c.assets.O = 7000;
  c.assets.X = 100;
  const orders = [
    { id: "local", type: "buy", resourceType: "H" },
    { id: "enough", type: "buy", resourceType: "O" },
    { id: "needed", type: "buy", resourceType: "X" },
    { id: "sale", type: "sell", resourceType: "H" },
    { id: "pixel", type: "buy", resourceType: "pixel", roomName: undefined },
  ].map((o) => ({ roomName: "home", active: true, remainingAmount: 1000, created: 100, ...o }));
  const cancelled: string[] = [],
    ctx = {
      Game: {
        time: 110,
        market: {
          orders: Object.fromEntries(orders.map((o) => [o.id, o])),
          cancelOrder: (id: string) => {
            cancelled.push(id);
            return 0;
          },
        },
      },
      Overmind: { colonies: { home: c }, terminalNetwork: n },
      ORDER_BUY: "buy",
      OK: 0,
      RESOURCES_ALL: ["H", "O", "X"],
    };
  const T = load("src/logistics/TradeNetwork.ts", "TraderJoe", ["cleanOrders"], ctx);
  T.settings = { market: { orders: { timeout: 500000, cleanupAmount: 100 } } };
  const t = new T();
  t.memory = { canceledOrders: [] };
  t.notify = () => {};
  t.cleanOrders();
  assert.deepEqual(cancelled, ["local", "enough"]);
});
