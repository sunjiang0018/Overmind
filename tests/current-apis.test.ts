import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { test } from "vite-plus/test";
import { constants } from "./helpers/constants";
import { classMembers } from "./helpers/source";
import { createStore } from "./helpers/store";
import { createGameRuntime } from "./helpers/game-runtime";
import type { TestScope } from "./helpers/types";

function evaluate(source: string, scope: TestScope) {
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("scope", `with (scope) { ${code} }`)(scope);
}

function creep(store: ReturnType<typeof createStore>, power = false): TestScope {
  const object: TestScope = {
    id: "creep-id",
    name: "worker",
    store,
    memory: {},
    body: [],
    room: { name: "W1N1" },
    pos: {},
    ticksToLive: 100,
    shard: "shard3",
    ...(power ? { powers: {} } : {}),
  };
  for (const key of ["carry", "carryCapacity"]) {
    Object.defineProperty(object, key, {
      get() {
        throw new Error(`Deprecated ${key} accessed`);
      },
    });
  }
  return object;
}

test("creep wrappers construct and refresh using only the live Store API", () => {
  for (const power of [false, true]) {
    const initial = creep(createStore({ energy: 10 }, 50), power);
    const next = creep(createStore({ energy: 20 }, 100), power);
    const scope: TestScope = {
      ...constants,
      global: {},
      initial,
      Game: { creeps: { worker: next }, powerCreeps: { worker: next } },
      getRoomObjectRef: (object: TestScope) => object.id,
      isPowerCreep: (object: TestScope) => !!object.powers,
    };
    const base = classMembers(
      "src/zerg/AnyZerg.ts",
      "AnyZerg",
      (member) => ts.isConstructorDeclaration(member) || member.name?.getText() === "refresh",
    );
    const refresh = classMembers("src/zerg/PowerZerg.ts", "PowerZerg", ["refresh"]);
    const wrapper = evaluate(
      `class Base { ${base} } class Power extends Base { ${refresh} } return new ${power ? "Power" : "Base"}(initial);`,
      scope,
    );
    assert.equal(wrapper.store, initial.store);
    assert.equal(wrapper.store.getCapacity(), 50);
    wrapper.refresh();
    assert.equal(wrapper.store, next.store);
    assert.equal(wrapper.store.getCapacity(), 100);
    assert.equal(Object.hasOwn(wrapper, "carry"), false);
    assert.equal(Object.hasOwn(wrapper, "carryCapacity"), false);
  }
});

test("structure helpers distinguish shared cargo capacity from resource-specific capacity", () => {
  const api = createGameRuntime().load("Structures");
  const container = { structureType: "container", store: createStore({ energy: 7, H: 3 }, 10) };
  assert.equal(api.isStructureFull(container), true);
  assert.equal(api.isStructureEmpty(container), false);
  const spawn = { structureType: "spawn", store: createStore({ energy: 0 }, { energy: 300 }) };
  assert.equal(api.isStructureFull(spawn), false);
  assert.equal(api.isStructureEmpty(spawn), true);
  spawn.store.energy = 300;
  assert.equal(api.isStructureFull(spawn), true);
  assert.equal(api.getEnergyCapacity(spawn), 300);
  const nuker = {
    store: createStore(
      { energy: 100, G: 20, power: 50, ops: 5 },
      { energy: 300, G: 100, power: 200, ops: 100 },
    ),
  };
  assert.equal(api.getStoredGhodium(nuker), 20);
  assert.equal(api.getGhodiumCapacity(nuker), 100);
  assert.equal(api.getStoredPower(nuker), 50);
  assert.equal(api.getPowerCapacity(nuker), 200);
  assert.equal(api.getStoredOps(nuker), 5);
  assert.equal(api.getOpsCapacity(nuker), 100);
  assert.equal(
    api.getStructureLinkStoreCapacity({ store: createStore({ energy: 200 }, { energy: 800 }) }),
    800,
  );
});

test("product labs unload full or incorrect minerals while empty labs keep loading", () => {
  const requests: TestScope[] = [];
  const probe = evaluate(
    `class Probe { ${classMembers("src/hiveClusters/evolutionChamber.ts", "EvolutionChamber", ["registerProductLabRequests"])} } return new Probe();`,
    {
      Priority: { NormalLow: 1 },
      LabStatus: { UnloadingLabs: 4 },
    },
  );
  probe.memory = { activeReaction: { mineralType: "OH" }, status: 3 };
  probe.transportRequests = { requestOutput: (lab: TestScope) => requests.push(lab) };
  const lab = (mineralType: string | undefined, amount: number) => ({
    mineralType,
    store: createStore(mineralType ? { [mineralType]: amount, energy: 2000 } : { energy: 2000 }, {
      energy: 2000,
      OH: 3000,
      ZK: 3000,
    }),
  });
  const full = lab("OH", 3000),
    wrong = lab("ZK", 10),
    partial = lab("OH", 100),
    empty = lab(undefined, 0);
  probe.registerProductLabRequests([empty, partial, full, wrong]);
  assert.deepEqual(requests, [full, wrong]);
  requests.length = 0;
  probe.memory.status = 4;
  probe.registerProductLabRequests([empty, partial]);
  assert.deepEqual(requests, [partial]);
});

test("packed IDs and position lists preserve persisted encodings after moving to slice", () => {
  class Position {
    constructor(
      public x: number,
      public y: number,
      public roomName: string,
    ) {}
  }
  const code = ts.transpileModule(fs.readFileSync("src/utilities/packrat.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: TestScope = {};
  new Function("exports", "RoomPosition", "PERMACACHE", code)(exports, Position, {});
  const { packId, unpackId, packIdList, unpackIdList } = exports;
  const ids = ["000000000000000000000000", "0123456789abcdef01234567", "ffffffffffffffffffffffff"];
  assert.deepEqual(
    Array.from(packId(ids[1]) as string, (char) => char.charCodeAt(0)),
    [0x0123, 0x4567, 0x89ab, 0xcdef, 0x0123, 0x4567],
  );
  for (const id of ids) assert.equal(unpackId(packId(id)), id);
  assert.deepEqual(unpackIdList(packIdList(ids)), ids);
  assert.deepEqual(unpackIdList(""), []);
  const positions = [new Position(0, 0, "W1N1"), new Position(49, 49, "W1N1")];
  assert.deepEqual(exports.unpackPosList(exports.packPosList(positions)), positions);
  assert.deepEqual(exports.unpackPosList(""), []);
});
