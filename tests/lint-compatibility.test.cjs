const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function loadModule(file, context = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024 },
  }).outputText;
  vm.runInNewContext(code, { exports, ...context }, { filename: file });
  return exports;
}

test("codec round-trips scalars and arrays with embedded and reused metadata", () => {
  const { Codec } = loadModule("src/algorithms/utf15.ts", {
    require: () => ({ profile: (target) => target }),
  });
  for (const meta of [false, true]) {
    for (const depth of [4, 15, 24, 53]) {
      for (const array of [false, true]) {
        const codec = new Codec({ depth, array, meta });
        const value = array ? [0, 1, 2 ** Math.min(depth, 24) - 1] : 2 ** Math.min(depth, 24) - 1;
        const encoded = codec.encode(value);
        const lengthOut = {};
        const decoded = codec.decode(encoded, lengthOut);
        assert.deepEqual(array ? Array.from(decoded) : decoded, value);
        assert.equal(lengthOut.length, encoded.length);
        assert.equal(codec.depth, depth);
        assert.equal(codec.array, Number(array));
        assert.equal(codec.meta, Number(meta));
      }
    }
  }
  const empty = new Codec({ depth: 4, array: true });
  // The existing codec rejects empty encoded arrays before entering the decode loop.
  assert.throws(() => empty.decode(empty.encode([])), { name: "RangeError" });
});

test("DEFCON aliases preserve numeric levels and the legacy reverse mapping", () => {
  const file = "src/Colony.ts";
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (n) => ts.isEnumDeclaration(n) && n.name.text === "DEFCON",
  );
  const exports = {};
  const code = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports });
  assert.deepEqual(
    { ...exports.DEFCON },
    {
      0: "safe",
      1: "invasionNPC",
      2: "playerInvasion",
      3: "bigPlayerInvasion",
      safe: 0,
      invasionNPC: 1,
      boostedInvasionNPC: 2,
      playerInvasion: 2,
      bigPlayerInvasion: 3,
    },
  );
});

test("remote debugger evaluates global expressions and IIFEs without exposing module locals", () => {
  let command;
  const memory = { remoteDebugger: {} };
  const game = { time: 42 };
  const { RemoteDebugger } = loadModule("src/debug/remoteDebugger.ts", {
    Memory: memory,
    Game: game,
    require: (name) => {
      if (name.endsWith("/log")) return { log: { info() {} } };
      if (name.endsWith("/Segmenter"))
        return { Segmenter: { getForeignSegmentProperty: () => command } };
      if (name.endsWith("/utils")) return { color: (value) => value };
      if (name.endsWith("/native")) return { defaultsDeep() {} };
      return {};
    },
  });
  const debuggerInstance = new RemoteDebugger();
  command = "({tick: Game.time, enabled: Boolean(Memory.remoteDebugger)})";
  debuggerInstance.fetchCommands_slave();
  assert.deepEqual(JSON.parse(memory.remoteDebugger.response), { tick: 42, enabled: true });
  command = "(() => { Game.time += 1; return Game.time; })() // trailing comment";
  debuggerInstance.fetchCommands_slave();
  assert.equal(JSON.parse(memory.remoteDebugger.response), 43);
  command = "typeof cmd";
  debuggerInstance.fetchCommands_slave();
  assert.equal(JSON.parse(memory.remoteDebugger.response), "undefined");
  command = undefined;
  debuggerInstance.fetchCommands_slave();
  assert.equal(memory.remoteDebugger.response, "No command");
  command = 'throw new Error("not an expression")';
  assert.throws(() => debuggerInstance.fetchCommands_slave(), { name: "SyntaxError" });
});

test("sparse fixture construction retains absent slots rather than explicit undefined", () => {
  const sparse = Object.assign([], { 0: "move", 2: "work", length: 3 });
  assert.equal(sparse.length, 3);
  assert.equal(Object.hasOwn(sparse, 1), false);
  assert.deepEqual(Object.keys(sparse), ["0", "2"]);
});
