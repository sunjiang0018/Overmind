import type { TestScope } from "./helpers/types";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const code = ts.transpileModule(fs.readFileSync("src/utilities/pixels.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
function setup(bucket: number, codeResult = 0) {
  let calls = 0;
  const ctx: TestScope = {
    exports: {},
    Game: {
      time: 123,
      cpu: {
        bucket,
        generatePixel() {
          calls++;
          return codeResult;
        },
      },
    },
    Memory: { stats: { persistent: {} } },
    PIXEL_CPU_COST: 10000,
    OK: 0,
  };
  vm.runInNewContext(code, ctx);
  return { ctx, calls: () => calls };
}
test("generates one pixel when the bucket is full", () => {
  const { ctx, calls } = setup(10000);
  ctx.exports.generatePixelIfFull();
  assert.equal(calls(), 1);
  assert.equal(ctx.Memory.stats.persistent.lastPixelTick, 123);
});
test("leaves a partially filled bucket untouched", () => {
  const { ctx, calls } = setup(9999);
  ctx.exports.generatePixelIfFull();
  assert.equal(calls(), 0);
});
test("does not report failed generation as success", () => {
  const { ctx, calls } = setup(10000, -6);
  ctx.exports.generatePixelIfFull();
  assert.equal(calls(), 1);
  assert.equal(ctx.Memory.stats.persistent.lastPixelTick, undefined);
});
test("skips servers without pixel generation", () => {
  const { ctx, calls } = setup(10000);
  delete ctx.Game.cpu.generatePixel;
  ctx.exports.generatePixelIfFull();
  assert.equal(calls(), 0);
});
test("the independent Pixel pause can be cleared to resume generation", () => {
  const { ctx, calls } = setup(10000);
  ctx.Memory.settings = { pixelGenerationPaused: true };
  ctx.exports.generatePixelIfFull();
  assert.equal(calls(), 0);
  ctx.Memory.settings.pixelGenerationPaused = false;
  ctx.exports.generatePixelIfFull();
  assert.equal(calls(), 1);
});

test("a live raid retains CPU through withdrawal and restores pixel generation on completion", () => {
  const { ctx, calls } = setup(10000);
  ctx.Memory.flags = { raid: { raid: { phase: "assembling" } } };
  for (const phase of ["assembling", "draining", "breaching", "looting", "retreating"]) {
    ctx.Memory.flags.raid.raid.phase = phase;
    ctx.exports.generatePixelIfFull();
    assert.equal(calls(), 0);
  }
  ctx.Memory.flags.raid.raid.phase = "complete";
  ctx.exports.generatePixelIfFull();
  assert.equal(calls(), 1);
});
