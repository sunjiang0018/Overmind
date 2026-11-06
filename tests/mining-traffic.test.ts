import { classMembers } from "./helpers/source";
import type { TestScope } from "./helpers/types";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { constants } from "./helpers/constants";
function methods(file: string, className: string, names: string[], scope: TestScope) {
  const body = classMembers(file, className, names);
  const code = ts.transpileModule(`class ${className} {${body}}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function("scope", `with(scope){${code};return ${className};}`)(scope);
}
function pos(x: number, y: number, roomName = "E58S42") {
  return {
    x,
    y,
    roomName,
    isEqualTo(p: { x: number; y: number; roomName: string }) {
      return this.x === p.x && this.y === p.y && this.roomName === p.roomName;
    },
    isNearTo(p: { x: number; y: number; roomName: string }) {
      return (
        this.roomName === p.roomName &&
        Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y)) <= 1
      );
    },
  };
}
function movement() {
  const source = ts.createSourceFile(
    "Movement.ts",
    fs.readFileSync("src/movement/Movement.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((n) => [...n.declarationList.declarations])
    .find((n) => n.name.getText(source) === "MovePriorities");
  assert.ok(declaration?.initializer);
  const Roles = { manager: "manager", drone: "drone", transport: "transport", worker: "worker" };
  const MovePriorities = new Function(
    "Roles",
    `return (${declaration.initializer.getText(source)});`,
  )(Roles);
  const Overmind = { overlords: { mine: { harvestPos: pos(27, 29) } } };
  const scope: TestScope = {
    Roles,
    MovePriorities,
    Overmind,
    MEM: { OVERLORD: "O" },
    normalizeAnyZerg: <T>(x: T) => x,
    isPowerZerg: () => false,
    isAnyZerg: () => false,
  };
  return {
    Movement: methods(
      "src/movement/Movement.ts",
      "Movement",
      ["getPushPriority", "shouldPush"],
      scope,
    ),
    Overmind,
  };
}
test("transport and worker traffic cannot displace an assigned miner, even asleep or with stale path data", () => {
  const { Movement } = movement();
  const miner = {
    my: true,
    pos: pos(27, 29),
    memory: { role: "drone", O: "mine", sleepUntil: 500, _go: { path: "227722" } },
  };
  for (const role of ["transport", "worker", "drone"]) {
    assert.equal(Movement.shouldPush({ memory: { role } }, miner), false);
  }
  miner.pos = pos(26, 30);
  assert.equal(Movement.shouldPush({ memory: { role: "transport" } }, miner), true);
  miner.pos = pos(27, 29, "E58S43");
  assert.equal(Movement.shouldPush({ memory: { role: "transport" } }, miner), true);
  miner.memory.O = "missing";
  assert.doesNotThrow(() => Movement.getPushPriority(miner));
});
test("zero movement priorities survive defaults for managers and explicit overrides", () => {
  const { Movement } = movement();
  assert.equal(Movement.getPushPriority({ memory: { role: "manager" } }), 0);
  assert.equal(Movement.getPushPriority({ memory: { role: "worker", _go: { priority: 0 } } }), 0);
  assert.equal(Movement.getPushPriority({ memory: { role: "unknown" } }), 10);
});
test("paths avoid source containers without blocking access or overwriting impassable tiles", () => {
  class CostMatrix {
    data = new Map<string, number>();
    set(x: number, y: number, value: number) {
      this.data.set(`${x},${y}`, value);
    }
    get(x: number, y: number) {
      return this.data.get(`${x},${y}`) || 0;
    }
  }
  const source = { pos: pos(28, 28) };
  const mining = { pos: pos(27, 29) },
    hatchery = { pos: pos(27, 40) };
  const blocker = { pos: pos(27, 29), blocking: true };
  let structures: TestScope[] = [];
  const scope: TestScope = {
    ...constants,
    PathFinder: { CostMatrix },
    normalizePos: (x: TestScope) => x.pos || x,
    getRoomRoads: () => [mining, hatchery],
    getRoomSources: () => [source],
    getRoomContainers: () => [mining, hatchery],
    getRoomStructures: () => structures,
    getRoomConstructionSites: () => [],
    getRoomHostileConstructionSites: () => [],
    getRoomPortals: () => [],
    isStructureWalkable: (s: TestScope) => !s.blocking,
    isConstructionSiteWalkable: () => true,
    isAlly: () => false,
  };
  const MatrixLib = methods(
    "src/matrix/MatrixLib.ts",
    "MatrixLib",
    ["generateCostMatrixForRoom", "block"],
    scope,
  );
  const opts = {
    terrainCosts: { plainCost: 2, swampCost: 10 },
    roadCost: 1,
    obstacles: "",
    swarmWidth: 1,
    swarmHeight: 1,
  };
  let matrix = MatrixLib.generateCostMatrixForRoom({ name: "E58S42" }, opts);
  assert.ok(matrix.get(27, 29) > matrix.get(27, 40));
  assert.ok(matrix.get(27, 29) < 255, "miner must still be able to reach its station");
  assert.equal(matrix.get(27, 40), 1, "hatchery supply roads remain unrestricted");
  structures = [blocker];
  matrix = MatrixLib.generateCostMatrixForRoom({ name: "E58S42" }, opts);
  assert.equal(matrix.get(27, 29), 255);
});
