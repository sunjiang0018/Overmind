import type { TestScope } from "./helpers/types";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
function runtime() {
  const code = ts.transpileModule(fs.readFileSync("src/overlords/defense/npcDefense.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2024,
      useDefineForClassFields: false,
      experimentalDecorators: true,
    },
  }).outputText;
  const out: TestScope = {},
    Creep = class {};
  const deps: TestScope = {
    "../Overlord": { Overlord: class {} },
    "../../profiler/decorator": { profile: <T>(x: T) => x },
    "../../game/RoomStructures": { getRoomInvaderCore: (r: TestScope) => r.core },
    "../../game/Room": { getRoomInvaders: (r: TestScope) => r.invaders || [] },
    "../../intel/RoomIntel": { RoomIntel: { isInvasionLikely: () => false } },
    "../../creepSetups/setups": { CombatSetups: { broodlings: { default: {} } } },
    "../../game/RoomPosition": { isPositionOnEdge: (p: { y: number }) => p.y === 0 },
    "../../priorities/priorities_overlords": {
      OverlordPriority: { outpostDefense: { guard: 551 } },
    },
  };
  new Function("Creep", `return function(exports,require){${code}}`)(Creep)(
    out,
    (n: string) => deps[n] || {},
  );
  const o = Object.create(out.DefenseNPCOverlord.prototype);
  o.pos = { roomName: "target" };
  return { o, Creep };
}
test("guard combat paths stay in the defended room and still heal", () => {
  const { o, Creep } = runtime(),
    calls: any[] = [],
    g = {
      pos: { isNearTo: () => false },
      goTo: (_target: unknown, opts: TestScope) => calls.push(opts),
      healSelfIfPossible: () => calls.push("heal"),
    };
  o.combatActions(g, new Creep());
  assert.equal(calls[0].pathOpts.maxRooms, 1);
  assert.equal(calls[0].movingTarget, true);
  assert.equal(calls[1], "heal");
});
test("adjacent guards keep attacking instead of replacing attacks with movement", () => {
  const { o } = runtime();
  let attacks = 0;
  o.combatActions(
    { pos: { isNearTo: () => true }, attackAndChase: () => attacks++, healSelfIfPossible() {} },
    {},
  );
  assert.equal(attacks, 1);
});
test("reinforcements may cross rooms but arrival on an exit cannot route back out", () => {
  const { o } = runtime(),
    calls: any[] = [],
    g = {
      pos: { y: 0 },
      inSameRoomAs: () => false,
      goToRoom: (r: string, opts?: TestScope) => calls.push({ r, opts }),
    };
  o.handleGuard(g);
  assert.equal(calls[0].opts, undefined);
  g.inSameRoomAs = () => true;
  o.handleGuard(g);
  assert.equal(calls[1].opts.pathOpts.maxRooms, 1);
});

test("a level zero core alone requests a guard without requiring invader creeps", () => {
  const { o } = runtime();
  let requested;
  o.wishlist = (n: number) => (requested = n);
  o.room = { core: { level: 0 } };
  o.init();
  assert.equal(requested, 1);
  o.room = {};
  o.init();
  assert.equal(requested, 0);
  o.room = { core: { level: 3 } };
  o.init();
  assert.equal(requested, 0);
});
