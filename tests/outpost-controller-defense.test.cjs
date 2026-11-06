const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  ts = require("typescript"),
  C = require("@screeps/common/lib/constants");
const { createGameRuntime } = require("./helpers/game-runtime.cjs");
test("claim threat recognizes active enemy CLAIM while excluding allies, NPCs and carriers", () => {
  const creep = (name, claims) => ({
    owner: { username: name },
    getActiveBodyparts: (part) => (part === C.CLAIM ? claims : 0),
  });
  const enemies = [creep("enemy", 2), creep("enemy", 0), creep("ally", 2), creep("Invader", 2)];
  const r = { find: (_, opts) => enemies.filter(opts.filter) };
  const rt = createGameRuntime(
    {},
    { "../utilities/utils": { isAlly: (n) => n === "ally", onPublicServer: () => true } },
  );
  assert.deepEqual(rt.load("Room").getRoomClaimingPlayerHostiles(r), [enemies[0]]);
});
function defender(
  claims,
  ownRanged = 0,
  enemy = { attack: 0, ranged: 0, heal: 0 },
  inspect,
  opts = {},
) {
  const code = ts.transpileModule(
    fs.readFileSync("src/overlords/defense/outpostDefense.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2024,
        useDefineForClassFields: false,
        experimentalDecorators: true,
      },
    },
  ).outputText;
  const out = {},
    setups = {
      hydralisks: { noHeal: "ranged", default: "ranged" },
      zerglings: { default: "melee", healing: "melee" },
      transfusers: { default: "heal" },
    };
  const deps = {
    "../CombatOverlord": { CombatOverlord: class {} },
    "../../profiler/decorator": { profile: (x) => x },
    "../../game/Room": {
      getRoomClaimingPlayerHostiles: () => Array(claims).fill({ pos: { x: 7, y: 11 } }),
      getRoomDangerousPlayerHostiles: () => [],
      getRoomHostiles: () => Array(opts.hostiles ?? 1).fill({}),
    },
    "../../creepSetups/setups": { Roles: {}, CombatSetups: setups },
    "../../targeting/GoalFinder": {
      GoalFinder: { skirmishGoals: () => ({ avoid: ["danger-zone"] }) },
    },
    "../../movement/Movement": {
      Movement: { combatMove: (z, approach, avoid) => z.testCombatMove(approach, avoid) },
    },
    "../../intel/CombatIntel": {
      CombatIntel: { getMyCombatPotentials: () => ({ attack: 0, ranged: ownRanged, heal: 0 }) },
    },
  };
  new Function("exports", "require", "RANGED_ATTACK", code)(
    out,
    (n) => deps[n] || {},
    C.RANGED_ATTACK,
  );
  const o = Object.create(out.OutpostDefenseOverlord.prototype);
  Object.assign(o, {
    directive: { memory: { persistent: !!opts.persistent } },
    room: {},
    spawnGroup: { colonies: [{ room: { energyCapacityAvailable: 2300 } }] },
    zerglings: [],
    hydralisks: [],
    healers: [],
    getEnemyPotentials: () => enemy,
    reassignIdleCreeps: () => false,
  });
  const requests = [];
  o.requestCreep = (s) => requests.push(s);
  o.init();
  inspect?.(o);
  return requests;
}
test("CLAIM-only contest requests a ranged defender despite zero enemy combat potential", () =>
  assert.deepEqual(defender(1), ["ranged"]));
test("one existing ranged defender satisfies the CLAIM-only floor", () =>
  assert.deepEqual(defender(1, 1), []));
test("carriers alone do not request defenders", () => assert.deepEqual(defender(0), []));
test("existing safety cutoff remains in force against overwhelming combat forces", () =>
  assert.deepEqual(defender(1, 0, { attack: 200, ranged: 0, heal: 0 }), []));

test("CLAIM focus keeps threat avoidance and invalidates the stale travel path", () => {
  defender(1, 1, undefined, (o) => {
    o.pos = { roomName: "remote" };
    const calls = [];
    const memory = { _go: { path: "stale" } };
    o.handleCombat({
      memory,
      room: { name: "remote" },
      getActiveBodyparts: () => 1,
      needsToRecover: () => false,
      pos: { findClosestByRange: (xs) => xs[0], inRangeTo: () => false },
      autoRanged: (xs) => calls.push(["attack", xs.length]),
      healSelfIfPossible() {},
      testCombatMove: (approach, avoid) => calls.push(["move", approach, avoid]),
    });
    assert.deepEqual(calls, [
      ["attack", 1],
      ["move", [{ pos: { x: 7, y: 11 }, range: 3 }], ["danger-zone"]],
    ]);
    assert.equal(memory._go, undefined);
  });
});

test("ordinary skirmishing also drops goTo paths before direct movement", () => {
  defender(0, 1, undefined, (o) => {
    o.pos = { roomName: "remote" };
    const memory = { _go: { path: "old" } };
    let moved = false;
    o.handleCombat({
      memory,
      pos: { findClosestByRange: () => undefined },
      room: { name: "remote" },
      getActiveBodyparts: () => 1,
      needsToRecover: () => false,
      autoSkirmish: () => (moved = true),
    });
    assert.equal(memory._go, undefined);
    assert.equal(moved, true);
  });
});

test("persistent contested outpost replaces a dead defender even against carriers alone", () =>
  assert.deepEqual(defender(0, 0, undefined, undefined, { persistent: true }), ["ranged"]));
test("persistent outpost stops reinforcements when enemies leave", () =>
  assert.deepEqual(defender(0, 0, undefined, undefined, { persistent: true, hostiles: 0 }), []));
test("persistent outpost does not repeatedly spawn when a ranged defender already exists", () =>
  assert.deepEqual(defender(0, 1, undefined, undefined, { persistent: true }), []));

test("persistent defense keeps its monitoring flag through quiet periods", () => {
  const code = ts.transpileModule(
    fs.readFileSync("src/directives/defense/outpostDefense.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2024,
        useDefineForClassFields: false,
        experimentalDecorators: true,
      },
    },
  ).outputText;
  const out = {},
    scope = { ...C, Game: { time: 200 } },
    deps = {
      "../Directive": { Directive: class {} },
      "../../profiler/decorator": { profile: (x) => x },
      "../../game/Room": { getRoomHostiles: () => [], getRoomCreeps: () => [] },
    };
  new Function("scope", `with(scope){return function(exports,require){${code}}}`)(scope)(
    out,
    (n) => deps[n] || {},
  );
  for (const persistent of [true, false]) {
    const d = Object.create(out.DirectiveOutpostDefense.prototype);
    d.memory = { persistent, safeSince: 0 };
    d.room = {};
    let removed = false;
    d.remove = () => (removed = true);
    d.run();
    assert.equal(removed, !persistent);
  }
});
