import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { constants } from "./helpers/constants";
import type { TestScope } from "./helpers/types";

const plan = JSON.parse(fs.readFileSync("plans/E57S45/plan.json", "utf8"));

function runtime(my = true, level = 5, shard = "shard3") {
  const code = ts.transpileModule(fs.readFileSync("src/roomPlanner/roomOverrides.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  let terrainReads = 0;
  const game = {
    shard: { name: shard },
    time: 100,
    map: {
      getRoomTerrain: () => {
        terrainReads++;
        return { get: () => 0 };
      },
    },
  };
  const deps: TestScope = {
    "../utilities/packrat": { packCoordList: (positions: unknown) => JSON.stringify(positions) },
    "./layouts/E57S45": { E57S45_PLAN: { ...plan, version: "E57S45-terrain-v4" } },
    "./layouts/E58S42": { E58S42_PLAN: {} },
  };
  const out: TestScope = {};
  new Function("scope", `with(scope){return function(exports,require){${code}}}`)({
    ...constants,
    Game: game,
  })(out, (name: string) => deps[name] || {});
  const memory: TestScope = {};
  const colony = {
    name: "E57S45",
    controller: { my, level },
    memory: {},
    room: { find: () => [] },
  };
  return {
    install: () => out.installRoomOverride(colony, memory),
    colony,
    memory,
    terrainReads: () => terrainReads,
  };
}

test("unowned E57S45 does not install anything or initiate colonization", () => {
  const r = runtime(false);
  r.install();
  assert.deepEqual(r.memory, {});
  assert.deepEqual(r.colony.memory, {});
  assert.equal(r.terrainReads(), 0);
});

test("future owned E57S45 gets staged roads and the three opt-in logistics policies", () => {
  const r = runtime();
  r.install();
  assert.deepEqual(r.memory.logisticsPolicy, plan.logisticsPolicy);
  assert.equal(r.memory.installedLevel, 5);
  assert.equal(r.memory.active, false);
  assert.deepEqual(
    r.memory.mapsByLevel[5].link.map(({ x, y }: { x: number; y: number }) => ({ x, y })),
    plan.stages["5"].link,
  );
  assert.equal(
    JSON.parse((r.colony.memory as TestScope).roadPlanner.roadCoordsPacked.E57S45).length,
    plan.stages["5"].road.length,
  );
  r.install();
  assert.equal(r.terrainReads(), 1, "same version and RCL do not reinstall");
});

test("controller level-up refreshes infrastructure and enables the second mine link", () => {
  const r = runtime(true, 5);
  r.install();
  r.colony.controller.level = 6;
  r.install();
  assert.equal(r.memory.installedLevel, 6);
  assert.equal(r.memory.mapsByLevel[6].link.length, 3);
  assert.equal(r.terrainReads(), 2);
});

test("an older local template is refreshed even at the same controller level", () => {
  const r = runtime(true, 5);
  r.memory.customLayout = "E57S45-terrain-v3";
  r.memory.installedLevel = 5;
  r.install();
  assert.equal(r.memory.customLayout, "E57S45-terrain-v4");
  assert.equal(r.terrainReads(), 1);
  assert.deepEqual(
    r.memory.mapsByLevel[5].road.map(({ x, y }: { x: number; y: number }) => ({ x, y })),
    plan.stages["5"].road,
  );
});

test("the profile is restricted to the intended shard", () => {
  const r = runtime(true, 5, "shard2");
  r.install();
  assert.deepEqual(r.memory, {});
  assert.equal(r.terrainReads(), 0);
});
