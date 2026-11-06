const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadBundle } = require("../helpers/screeps-runtime.cjs");

test("local build ignores inherited upload settings and cleans its output directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "overmind vite pack "));
  try {
    const output = path.join(directory, "custom.js");
    const sentinel = path.join(directory, "stale.txt");
    fs.writeFileSync(sentinel, "stale build artifact");
    const result = spawnSync(process.execPath, ["scripts/build.cjs", "--output", output], {
      cwd: path.resolve(__dirname, "../.."),
      env: {
        ...process.env,
        DEST: "invalid-inherited-destination",
        OVERMIND_UPLOAD_DESTINATION: "invalid-inherited-destination",
      },
      encoding: "utf8",
      timeout: 30000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(sentinel), false);
    assert.deepEqual(fs.readdirSync(directory), ["custom.js"]);
    const runtime = loadBundle(output);
    assert.deepEqual(Object.keys(runtime.context.module.exports), ["loop"]);
    runtime.tick();
    assert.equal(runtime.context.Overmind.exceptions.length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
