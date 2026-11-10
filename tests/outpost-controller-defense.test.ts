import type { TestScope } from "./helpers/types";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { constants } from "./helpers/constants";
import { createGameRuntime } from "./helpers/game-runtime";
test("claim threat recognizes active enemy CLAIM while excluding allies, NPCs and carriers", () => {
  const creep = (name: string, claims: number) => ({
    owner: { username: name },
    getActiveBodyparts: (part: BodyPartConstant) => (part === constants.CLAIM ? claims : 0),
  });
  const enemies = [creep("enemy", 2), creep("enemy", 0), creep("ally", 2), creep("Invader", 2)];
  const r = {
    find: (_type: number, opts: { filter: (creep: unknown) => boolean }) =>
      enemies.filter(opts.filter),
  };
  const rt = createGameRuntime(
    {},
    { "../utilities/utils": { isAlly: (n: string) => n === "ally", onPublicServer: () => true } },
  );
  assert.deepEqual(rt.load("Room").getRoomClaimingPlayerHostiles(r), [enemies[0]]);
});
function defender(
  claims: number,
  ownRanged = 0,
  enemy = { attack: 0, ranged: 0, heal: 0 },
  inspect?: (subject: TestScope) => void,
  opts: {
    hostiles?: number;
    persistent?: boolean;
    safeSince?: number;
    idlePos?: Coord;
    controllerGuard?: boolean;
  } = {},
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
  const out: TestScope = {},
    setups = {
      hydralisks: { noHeal: "ranged", default: "ranged" },
      zerglings: { default: "melee", healing: "melee" },
      transfusers: { default: "heal" },
    };
  const deps: TestScope = {
    "../CombatOverlord": { CombatOverlord: class {} },
    "../../profiler/decorator": { profile: <T>(x: T) => x },
    "../../game/Room": {
      getRoomClaimingPlayerHostiles: () => Array(claims).fill({ pos: { x: 7, y: 11 } }),
      getRoomDangerousPlayerHostiles: () => [],
      getRoomHostiles: () => Array(opts.hostiles ?? 1).fill({}),
    },
    "../../creepSetups/setups": {
      Roles: { melee: "zergling", ranged: "hydralisk", healer: "healer" },
      CombatSetups: setups,
    },
    "../../targeting/GoalFinder": {
      GoalFinder: { skirmishGoals: () => ({ avoid: ["danger-zone"] }) },
    },
    "../../movement/Movement": {
      Movement: {
        combatMove: (z: TestScope, approach: unknown[], avoid: unknown[]) =>
          z.testCombatMove(approach, avoid),
      },
    },
    "../../intel/CombatIntel": {
      CombatIntel: { getMyCombatPotentials: () => ({ attack: 0, ranged: ownRanged, heal: 0 }) },
    },
  };
  new Function(
    "exports",
    "require",
    "RANGED_ATTACK",
    "Game",
    "CREEP_LIFE_TIME",
    "RoomPosition",
    code,
  )(
    out,
    (n: string) => deps[n] || {},
    constants.RANGED_ATTACK,
    { time: 200 },
    constants.CREEP_LIFE_TIME,
    class {
      constructor(
        public x: number,
        public y: number,
        public roomName: string,
      ) {}
    },
  );
  const o = Object.create(out.OutpostDefenseOverlord.prototype);
  Object.assign(o, {
    directive: {
      memory: {
        persistent: !!opts.persistent,
        safeSince: opts.safeSince ?? 0,
        idlePos: opts.idlePos,
        controllerGuard: opts.controllerGuard,
      },
    },
    room: {},
    spawnGroup: { colonies: [{ room: { energyCapacityAvailable: 2300 } }] },
    zerglings: [],
    hydralisks: [],
    healers: [],
    getEnemyPotentials: () => enemy,
    reassignIdleCreeps: () => false,
  });
  const requests: string[] = [];
  o.requestCreep = (s: string) => requests.push(s);
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
    const calls: unknown[][] = [];
    const memory = { _go: { path: "stale" } };
    o.handleCombat({
      memory,
      room: { name: "remote" },
      getActiveBodyparts: () => 1,
      needsToRecover: () => false,
      pos: { findClosestByRange: (xs: TestScope[]) => xs[0], inRangeTo: () => false },
      autoRanged: (xs: unknown[]) => calls.push(["attack", xs.length]),
      healSelfIfPossible() {},
      testCombatMove: (approach: unknown[], avoid: unknown[]) =>
        calls.push(["move", approach, avoid]),
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
test("an idle position does not change the original peacetime reinforcement policy", () =>
  assert.deepEqual(
    defender(0, 0, undefined, undefined, {
      persistent: true,
      hostiles: 0,
      idlePos: { x: 25, y: 48 },
    }),
    [],
  ));
test("an idle position changes only idle movement and preserves medic actions", () => {
  for (const doingMedic of [false, true]) {
    defender(
      0,
      7,
      undefined,
      (o) => {
        o.pos = { roomName: "E58S44" };
        o.room = { name: "E58S44" };
        const calls: unknown[][] = [];
        const memory: TestScope = { role: "hydralisk" };
        o.handleCombat({
          memory,
          room: { name: "E58S44" },
          getActiveBodyparts: () => 7,
          needsToRecover: () => false,
          pos: { findClosestByRange: () => undefined },
          doMedicActions: (room: string) => {
            calls.push(["medic", room]);
            return doingMedic;
          },
          goTo: (target: RoomPosition, options: unknown) =>
            calls.push(["move", target.x, target.y, target.roomName, options]),
        });
        assert.deepEqual(
          calls,
          doingMedic
            ? [["medic", "E58S44"]]
            : [
                ["medic", "E58S44"],
                ["move", 25, 48, "E58S44", { range: 0 }],
              ],
        );
        assert.equal(memory._go, undefined);
      },
      { persistent: true, hostiles: 0, idlePos: { x: 25, y: 48 } },
    );
  }
});
test("a sentry leaves its post to pursue ordinary hostiles using normal skirmishing", () => {
  defender(
    0,
    7,
    undefined,
    (o) => {
      o.pos = { roomName: "E58S44" };
      const memory: TestScope = { role: "hydralisk", _go: { priority: 0 } };
      const calls: string[] = [];
      o.handleCombat({
        memory,
        room: { name: "E58S44" },
        getActiveBodyparts: () => 7,
        needsToRecover: () => false,
        pos: { findClosestByRange: () => undefined },
        autoSkirmish: (room: string) => calls.push(room),
      });
      assert.deepEqual(calls, ["E58S44"]);
      assert.equal(memory._go, undefined);
    },
    { persistent: true, idlePos: { x: 25, y: 48 } },
  );
});
test("a sentry pursues controller attackers instead of staying at the entrance", () => {
  defender(
    1,
    7,
    undefined,
    (o) => {
      o.pos = { roomName: "E58S44" };
      const memory: TestScope = { role: "hydralisk", _go: { priority: 0 } };
      const calls: string[] = [];
      o.handleCombat({
        memory,
        room: { name: "E58S44" },
        getActiveBodyparts: () => 7,
        needsToRecover: () => false,
        pos: { findClosestByRange: (targets: unknown[]) => targets[0] },
        autoRanged: () => calls.push("attack"),
        healSelfIfPossible() {},
        testCombatMove: () => calls.push("pursue"),
      });
      assert.deepEqual(calls, ["attack", "pursue"]);
      assert.equal(memory._go, undefined);
    },
    { persistent: true, idlePos: { x: 25, y: 48 } },
  );
});
test("controller guard ignores medic duties and non-CLAIM hostiles, retaining self-healing", () => {
  for (const hostiles of [0, 1]) {
    defender(
      0,
      7,
      undefined,
      (o) => {
        o.pos = { roomName: "E58S44" };
        const calls: unknown[][] = [];
        o.handleCombat({
          memory: { role: "hydralisk" },
          room: { name: "E58S44" },
          getActiveBodyparts: () => 7,
          needsToRecover: () => false,
          pos: { findClosestByRange: () => undefined },
          healSelfIfPossible: () => calls.push(["selfHeal"]),
          goTo: (target: RoomPosition, options: unknown) =>
            calls.push(["move", target.x, target.y, target.roomName, options]),
        });
        assert.deepEqual(calls, [["selfHeal"], ["move", 25, 48, "E58S44", { range: 0 }]]);
      },
      { controllerGuard: true, hostiles, idlePos: { x: 25, y: 48 } },
    );
  }
});
test("controller guard pursues CLAIM threats with normal threat avoidance", () => {
  defender(
    1,
    7,
    undefined,
    (o) => {
      o.pos = { roomName: "E58S44" };
      const memory: TestScope = { role: "hydralisk", _go: { path: "old" } };
      const calls: unknown[][] = [];
      o.handleCombat({
        memory,
        room: { name: "E58S44" },
        getActiveBodyparts: () => 7,
        needsToRecover: () => false,
        pos: { findClosestByRange: (targets: unknown[]) => targets[0] },
        autoRanged: (targets: unknown[], mass: boolean) =>
          calls.push(["attack", targets.length, mass]),
        healSelfIfPossible: () => calls.push(["selfHeal"]),
        testCombatMove: (approach: unknown[], avoid: unknown[]) =>
          calls.push(["pursue", approach, avoid]),
      });
      assert.deepEqual(calls, [
        ["attack", 1, false],
        ["selfHeal"],
        ["pursue", [{ pos: { x: 7, y: 11 }, range: 3 }], ["danger-zone"]],
      ]);
      assert.equal(memory._go, undefined);
    },
    { controllerGuard: true, idlePos: { x: 25, y: 48 } },
  );
});
test("controller guard retains self-preservation without taking medic tasks", () => {
  defender(
    1,
    7,
    undefined,
    (o) => {
      const calls: string[] = [];
      const memory: TestScope = { role: "hydralisk", _go: { path: "old" } };
      o.handleCombat({
        memory,
        needsToRecover: () => true,
        healSelfIfPossible: () => calls.push("selfHeal"),
        recover: () => calls.push("recover"),
      });
      assert.deepEqual(calls, ["selfHeal", "recover"]);
      assert.equal(memory._go, undefined);
    },
    { controllerGuard: true },
  );
});
test("persistent outpost does not repeatedly spawn when a ranged defender already exists", () =>
  assert.deepEqual(defender(0, 1, undefined, undefined, { persistent: true }), []));

function runHydralisks(o: TestScope, atSpawn = false, crossRoom = false) {
  const returning: string[] = [],
    guarding: string[] = [];
  const recycled: string[] = [];
  const spawn = { recycleCreep: (creep: TestScope) => recycled.push(creep.name) };
  o.colony = { spawns: [spawn] };
  o.hydralisks = [341, 537, 984].map((ticksToLive, i) => ({
    name: `hydralisk_${i}`,
    creep: { name: `hydralisk_${i}` },
    ticksToLive,
    getActiveBodyparts: () => 7,
    pos: { findClosestByRange: () => (crossRoom ? null : spawn), isNearTo: () => atSpawn },
    goTo: () => returning.push(`hydralisk_${i}`),
  }));
  o.autoRun = (zs: TestScope[], handler: (z: TestScope) => void) => zs.forEach(handler);
  o.handleCombat = (z: TestScope) => guarding.push(z.name);
  o.run();
  return { returning, guarding, recycled };
}

test("quiet persistent E58S44 returns two surplus hydralisks and keeps the youngest sentry", () => {
  defender(
    0,
    21,
    undefined,
    (o) => {
      const { returning, guarding } = runHydralisks(o);
      assert.deepEqual(returning, ["hydralisk_0", "hydralisk_1"]);
      assert.deepEqual(guarding, ["hydralisk_2"]);
    },
    { persistent: true, hostiles: 0 },
  );
});

test("a satisfied defense does not absorb idle fighters on every tick", () => {
  defender(
    1,
    7,
    undefined,
    (o) => {
      const adopted: string[] = [];
      o.reassignIdleCreeps = (role: string) => {
        adopted.push(role);
        return true;
      };
      o.init();
      assert.deepEqual(adopted, []);
    },
    { persistent: true },
  );
});

test("surplus defenders are recycled at the home spawn", () => {
  defender(
    0,
    21,
    undefined,
    (o) => {
      const { recycled, guarding } = runHydralisks(o, true);
      assert.deepEqual(recycled, ["hydralisk_0", "hydralisk_1"]);
      assert.deepEqual(guarding, ["hydralisk_2"]);
    },
    { persistent: true, hostiles: 0 },
  );
});

test("surplus defenders can select a home spawn in a different room", () => {
  defender(
    0,
    21,
    undefined,
    (o) => {
      const { returning, guarding } = runHydralisks(o, false, true);
      assert.deepEqual(returning, ["hydralisk_0", "hydralisk_1"]);
      assert.deepEqual(guarding, ["hydralisk_2"]);
    },
    { persistent: true, hostiles: 0 },
  );
});

test("active threats, recent fighting and lost vision each prevent downsizing", () => {
  for (const scenario of ["hostiles", "recent", "noVision", "temporary", "unknownSafety"]) {
    defender(
      0,
      21,
      undefined,
      (o) => {
        if (scenario === "noVision") o.room = undefined;
        if (scenario === "unknownSafety") delete o.directive.memory.safeSince;
        const { returning, recycled, guarding } = runHydralisks(o);
        assert.deepEqual(returning, [], scenario);
        assert.deepEqual(recycled, [], scenario);
        assert.equal(guarding.length, 3, scenario);
      },
      {
        persistent: scenario !== "temporary",
        hostiles: scenario === "hostiles" ? 1 : 0,
        safeSince: scenario === "recent" ? 100 : 0,
      },
    );
  }
});

test("returning defenders rejoin combat when a threat reappears", () => {
  defender(
    1,
    21,
    undefined,
    (o) => {
      const { guarding, returning, recycled } = runHydralisks(o);
      assert.equal(guarding.length, 3);
      assert.deepEqual(returning, []);
      assert.deepEqual(recycled, []);
    },
    { persistent: true },
  );
});

test("outpost defense still requests reinforcements when one hydralisk is insufficient", () => {
  assert.deepEqual(defender(0, 7, { attack: 0, ranged: 10, heal: 0 }), ["ranged"]);
});

test("a ranged shortfall adopts only a ranged idle creep before requesting a spawn", () => {
  defender(
    1,
    0,
    undefined,
    (o) => {
      const adopted: string[] = [];
      o.reassignIdleCreeps = (role: string) => {
        adopted.push(role);
        return true;
      };
      o.requestCreep = () => assert.fail("an idle ranged defender already filled the shortfall");
      o.init();
      assert.deepEqual(adopted, ["hydralisk"]);
    },
    { persistent: true },
  );
});

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
  const out: TestScope = {},
    scope: TestScope = { ...constants, Game: { time: 200 } },
    deps: TestScope = {
      "../Directive": { Directive: class {} },
      "../../profiler/decorator": { profile: <T>(x: T) => x },
      "../../game/Room": { getRoomHostiles: () => [], getRoomCreeps: () => [] },
    };
  new Function("scope", `with(scope){return function(exports,require){${code}}}`)(scope)(
    out,
    (n: string) => deps[n] || {},
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
