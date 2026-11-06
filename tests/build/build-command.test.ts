import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadBundle } from "../helpers/screeps-runtime";

test("local build ignores inherited upload settings and cleans its output directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "overmind vite pack "));
  try {
    const output = path.join(directory, "main.js");
    const sentinel = path.join(directory, "stale.txt");
    fs.writeFileSync(sentinel, "stale build artifact");
    const result = spawnSync(
      process.execPath,
      ["node_modules/vite-plus/bin/vp", "pack", "--out-dir", directory],
      {
        cwd: path.resolve(import.meta.dirname, "../.."),
        env: {
          ...process.env,
          DEST: "invalid-inherited-destination",
          OVERMIND_UPLOAD_DESTINATION: "invalid-inherited-destination",
        },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(sentinel), false);
    assert.deepEqual(fs.readdirSync(directory), ["main.js"]);
    const runtime = loadBundle(output);
    assert.deepEqual(Object.keys(runtime.context.module.exports), ["loop"]);
    runtime.tick();
    assert.equal(runtime.context.Overmind.exceptions.length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
