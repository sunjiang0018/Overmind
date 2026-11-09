import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { loadBundle } from "../helpers/screeps-runtime";

const bundle = path.resolve("dist/main.js");

test("production output is a single JavaScript file with no external or dynamic imports", () => {
  assert.deepEqual(fs.readdirSync(path.dirname(bundle)), ["main.js"]);
  const source = ts.createSourceFile(
    bundle,
    fs.readFileSync(bundle, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require")))
    ) {
      imports.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.deepEqual(imports, []);
});

for (const scenario of [
  { name: "global reset, build and refresh ticks", options: {}, ticks: 3 },
  { name: "low CPU bucket suspension", options: { bucket: 99 }, ticks: 2 },
  { name: "operation at bucket threshold", options: { bucket: 100 }, ticks: 2 },
  { name: "full bucket pixel generation", options: { bucket: 10000 }, ticks: 1 },
]) {
  test(`Vite+ Pack bundle supports ${scenario.name}`, () => {
    const runtime = loadBundle(bundle, scenario.options);
    const { context } = runtime;
    assert.deepEqual(Object.keys(context.module.exports), ["loop"]);
    assert.equal(typeof context.module.exports.loop, "function");
    assert.equal(context.NO_ACTION, 1);
    assert.equal(typeof context.deref, "function");
    assert.equal(typeof context.derefRoomPosition, "function");
    assert.equal(typeof context.PERMACACHE, "object");
    assert.equal(context.Memory.build, 1);
    assert.equal(context.LATEST_GLOBAL_RESET_TICK, 1001);
    assert.equal(context.Room.prototype._refreshStructureCache, undefined);
    assert.equal(Object.getOwnPropertyDescriptor(context.RoomObject.prototype, "ref"), undefined);
    for (let i = 0; i < scenario.ticks; i++) runtime.tick();
    if (scenario.options.bucket === 10000) assert.equal(runtime.calls.pixels, 1);
    if (scenario.options.bucket === 99) assert.equal(context.Memory.tick, 1001);
    else {
      assert.equal(context.Memory.tick, 1001 + scenario.ticks);
      assert.equal(context.Overmind.exceptions.length, 0);
      assert.equal(context.PHASE, "postRun");
    }
  });
}

test("bucket recovery suspends below 100 and resumes at 100", () => {
  const runtime = loadBundle(bundle, { bucket: 99 });
  const { context } = runtime;
  context.Memory.resetBucket = true;
  const tick = context.Memory.tick;
  runtime.tick();
  assert.equal(context.Memory.tick, tick);
  assert.equal(context.Memory.resetBucket, true);
  assert.ok(runtime.logs.some((line) => line.includes("Bucket: 99/100")));

  context.Game.cpu.bucket = 100;
  runtime.tick();
  assert.equal(context.Memory.tick, tick + 1);
  assert.equal(context.Memory.resetBucket, undefined);
  assert.equal(context.PHASE, "postRun");
  assert.equal(context.Overmind.exceptions.length, 0);

  runtime.tick();
  assert.equal(context.Memory.tick, tick + 2);
});

test("repeated low bucket pauses preserve the VM and resume at 100 with multiple Spawns", () => {
  const runtime = loadBundle(bundle, { bucket: 100 });
  const { context } = runtime;
  runtime.tick();
  const brain = context.Overmind;
  const cache = context._cache;
  const tick = context.Memory.tick;
  context.Game.cpu.halt = () => assert.fail("CPU recovery must not reset the VM");
  context.Game.spawns = { first: {}, second: {} };
  for (const bucket of [0, 50, 99]) {
    context.Game.cpu.bucket = bucket;
    runtime.tick();
    assert.equal(context.Memory.tick, tick);
    assert.equal(context.Memory.resetBucket, true);
    assert.equal(context.Memory.haltTick, undefined);
  }
  context.Game.spawns = {};
  let completed = tick;
  for (const bucket of [100, 80, 99, 100, 150]) {
    context.Game.cpu.bucket = bucket;
    runtime.tick();
    if (bucket >= 100) completed++;
    assert.equal(context.Memory.tick, completed);
    assert.equal(context.Overmind, brain);
    assert.equal(context._cache, cache);
  }
  assert.equal(context.Memory.resetBucket, undefined);
  assert.equal(context.Memory.stats.persistent.lastGlobalReset, 1001);
});

test("legacy scheduled halts are discarded before recovery runs", () => {
  for (const offset of [-1, 0, 1]) {
    const runtime = loadBundle(bundle, { bucket: 100 });
    const { context } = runtime;
    context.Memory.resetBucket = true;
    context.Memory.haltTick = context.Game.time + offset;
    context.Game.cpu.halt = () => assert.fail("legacy halt must not execute");
    runtime.tick();
    assert.equal(context.Memory.haltTick, undefined);
    assert.equal(context.Memory.resetBucket, undefined);
    assert.equal(context.Memory.tick, 1002);
    assert.equal(context.PHASE, "postRun");
  }
});

test("periodic low bucket heap maintenance clears caches without halting", () => {
  const runtime = loadBundle(bundle, { bucket: 200 });
  const { context } = runtime;
  context.Game.time = 1197;
  context.Game.cpu.halt = () => assert.fail("heap maintenance must not reset the VM");
  const cache = context._cache;
  runtime.tick();
  assert.notEqual(context._cache, cache);
  assert.equal(context.Memory.build, 1);
  assert.equal(context.Memory.tick, 1002);
  assert.equal(context.Memory.stats.persistent.lastGlobalReset, 1001);
  assert.equal(context.PHASE, "postRun");
});

test("Pixel generation can drain the bucket and recover without a global reset", () => {
  const runtime = loadBundle(bundle, { bucket: 10000 });
  const { context } = runtime;
  context.Memory.settings.pixelGenerationPaused = false;
  context.Game.cpu.generatePixel = () => {
    runtime.calls.pixels++;
    context.Game.cpu.bucket = 0;
    return context.OK;
  };
  context.Game.cpu.halt = () => assert.fail("Pixel recovery must not reset the VM");
  runtime.tick();
  assert.equal(runtime.calls.pixels, 1);
  const tick = context.Memory.tick;
  for (const bucket of [0, 18, 36, 54, 72, 90]) {
    context.Game.cpu.bucket = bucket;
    runtime.tick();
    assert.equal(context.Memory.tick, tick);
  }
  for (let i = 0; i < 25; i++) {
    context.Game.cpu.bucket = 108 + 10 * i;
    runtime.tick();
    assert.equal(context.Memory.tick, tick + i + 1);
    assert.equal(context.Overmind.exceptions.length, 0);
  }
  assert.equal(context.Memory.stats.persistent.lastGlobalReset, 1001);
  assert.equal(context.Memory.settings.pixelGenerationPaused, false);
  assert.equal(runtime.calls.pixels, 1);
});

test("compressed room memory keys round-trip without ambient enum globals", () => {
  const runtime = loadBundle(bundle);
  const result = JSON.parse(
    vm.runInContext(
      `
    RoomIntel.setExpansionData('W1N1', {
      score: 123, bunkerAnchor: new RoomPosition(11, 12, 'W1N1'), outposts: {W2N1: 9},
    });
    Memory.rooms.W1N1.T = 777;
    JSON.stringify({saved: Memory.rooms.W1N1, decoded: RoomIntel.getExpansionData('W1N1'),
                    lastVisible: RoomIntel.lastVisible('W1N1')});
  `,
      runtime.context,
    ),
  );
  assert.deepEqual(Object.keys(result.saved).sort(), ["T", "e"]);
  assert.deepEqual(Object.keys(result.saved.e).sort(), ["a", "o", "s"]);
  assert.equal(result.decoded.score, 123);
  assert.equal(result.decoded.bunkerAnchor.x, 11);
  assert.equal(result.lastVisible, 777);
});
