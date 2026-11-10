import { createStore } from "./helpers/store";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { constants } from "./helpers/constants";
import { classMembers } from "./helpers/source";
import * as native from "../src/utilities/native";
import type { TestScope } from "./helpers/types";
import { createGameRuntime } from "./helpers/game-runtime";

function linkRuntime(storageFirst = true) {
  const code = ts.transpileModule(fs.readFileSync("src/logistics/LinkNetwork.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  }).outputText;
  const out: TestScope = {};
  const deps: TestScope = {
    "../profiler/decorator": { profile: <T>(x: T) => x },
    "../utilities/native": native,
    "../game/Structures": createGameRuntime().load("Structures"),
  };
  new Function("scope", `with(scope){return function(exports,require){${code}}}`)(constants)(
    out,
    (name: string) => deps[name] || {},
  );
  const calls: { from: string; to: string; amount: number; result: number }[] = [];
  function link(id: string, x: number, energy: number, cooldown = 0, result = constants.OK) {
    return {
      id,
      x,
      store: createStore({ energy }, { energy: 800 }),
      cooldown,
      pos: {
        findClosestByRange: (links: TestScope[]) =>
          [...links].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0],
      },
      transferEnergy(target: TestScope, amount = energy) {
        // Intents deliberately do not mutate stores: Screeps applies them later.
        calls.push({ from: id, to: target.id, amount, result });
        return result;
      },
    };
  }
  const core = link("core", 10, 0);
  const colony = {
    commandCenter: { link: core },
    roomPlanner: { memory: { logisticsPolicy: { storageLinkFirst: storageFirst } } },
  };
  return { network: new out.LinkNetwork(colony), calls, core, link };
}

test("empty storage-side link receives mine output before a hungry controller", () => {
  const r = linkRuntime();
  r.network.transmit = [r.link("mine", 0, 800)];
  r.network.receive = [r.link("controller", 1, 0)];
  r.network.run();
  assert.deepEqual(r.calls, [{ from: "mine", to: "core", amount: 800, result: constants.OK }]);
});

test("two simultaneous mines do not reserve the same storage-link capacity twice", () => {
  const r = linkRuntime();
  r.core.store.energy = 100;
  r.network.transmit = [r.link("west", 0, 800), r.link("north", 9, 800)];
  r.network.run();
  assert.deepEqual(r.calls, [{ from: "north", to: "core", amount: 700, result: constants.OK }]);
  assert.deepEqual(
    r.network.transmit.map((link: TestScope) => link.id),
    ["west"],
  );
});

test("full storage hub forwards existing surplus so controller is not starved", () => {
  const r = linkRuntime();
  r.core.store.energy = 800;
  r.network.transmit = [r.link("mine", 0, 800), r.core];
  r.network.receive = [r.link("controller", 1, 0)];
  r.network.run();
  assert.deepEqual(r.calls, [
    { from: "core", to: "controller", amount: 800, result: constants.OK },
  ]);
});

test("surplus mine output can serve secondary receivers after the hub is serviced", () => {
  const r = linkRuntime();
  r.network.transmit = [r.link("west", 0, 800), r.link("north", 9, 800)];
  r.network.receive = [r.link("hatchery", 1, 0), r.link("hatchery", 1, 0)];
  r.network.run();
  assert.deepEqual(
    r.calls.map((c) => [c.from, c.to]),
    [
      ["north", "core"],
      ["west", "hatchery"],
    ],
  );
});

test("tired senders and failed intents do not consume a receiver reservation", () => {
  const r = linkRuntime();
  r.network.transmit = [
    r.link("tired", 10, 800, 1),
    r.link("failed", 9, 800, 0, constants.ERR_BUSY),
    r.link("ready", 0, 800),
  ];
  r.network.run();
  assert.deepEqual(
    r.calls.map((c) => c.from),
    ["failed", "ready"],
  );
  assert.equal(r.network.transmit.length, 2);
});

test("colonies without the opt-in keep their existing receive-first routing", () => {
  const r = linkRuntime(false);
  r.network.transmit = [r.link("mine", 0, 800)];
  r.network.receive = [r.link("controller", 1, 0)];
  r.network.run();
  assert.equal(r.calls[0].to, "controller");
});

function miningContainer(planned: boolean, preserve = true) {
  const code = ts.transpile(
    `class Probe { ${classMembers("src/overlords/mining/miner.ts", "MiningOverlord", ["addRemoveContainer"])} }; return Probe;`,
  );
  const Probe = new Function("scope", `with(scope){${code}}`)({
    ...constants,
    log: { info() {} },
    getRoomPositionPrint: () => "",
  });
  let destroyed = 0;
  const pos = { getRangeTo: (target: TestScope) => target.range };
  const probe = Object.assign(new Probe(), {
    allowDropMining: false,
    link: {},
    container: { pos, destroy: () => destroyed++ },
    colony: {
      hatchery: { range: 23 },
      upgradeSite: { range: 37 },
      roomPlanner: {
        memory: { logisticsPolicy: { preserveMiningBuffers: preserve } },
        plannedStructurePositions: () =>
          planned ? [{ isEqualTo: (other: unknown) => other === pos }] : [],
      },
    },
  });
  probe.addRemoveContainer();
  return destroyed;
}

test("a blueprint mining buffer survives after its adjacent link is built", () => {
  assert.equal(miningContainer(true), 0);
});

test("unplanned and non-opt-in mining containers keep their previous lifecycle", () => {
  assert.equal(miningContainer(false), 1);
  assert.equal(miningContainer(true, false), 1);
});

test("a full mining link falls back to the retained buffer instead of stalling harvest", () => {
  const code = ts.transpile(
    `class Probe { ${classMembers("src/overlords/mining/miner.ts", "MiningOverlord", ["linkMiningActions"])} }; return Probe;`,
  );
  const Probe = new Function("scope", `with(scope){${code}}`)({ ...constants, Game: { time: 2 } });
  const buffer = { energy: 0 };
  const link = { store: createStore({ energy: 800 }, { energy: 800 }) };
  const miner: TestScope = {
    store: createStore({ energy: 50 }, 50),
    harvest: () => constants.OK,
    transfer(target: TestScope) {
      if (target === link) return constants.ERR_FULL;
      target.energy += this.store.energy;
      this.store.energy = 0;
      return constants.OK;
    },
  };
  const probe = Object.assign(new Probe(), {
    isSleeping: () => false,
    source: {},
    link,
    container: buffer,
    colony: { roomPlanner: { memory: { logisticsPolicy: { preserveMiningBuffers: true } } } },
  });
  probe.linkMiningActions(miner);
  assert.equal(buffer.energy, 50);
  assert.equal(miner.store.energy, 0);
  assert.equal(link.store.energy, 800);
});
