const { createGameRuntime } = require("./helpers/game-runtime.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
function method(file, className, name) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const cls = source.statements.find((n) => ts.isClassDeclaration(n) && n.name.text === className);
  return cls.members.find((n) => n.name && n.name.getText(source) === name).getText(source);
}

test("signature accepts unbranded text, retaining the length check", () => {
  const context = {
    exports: {},
    Memory: { settings: {} },
    DEFAULT_OVERMIND_SIGNATURE: "星海为途，长路有光",
  };
  vm.runInNewContext(
    compile(
      "class Console {" +
        method("src/console/Console.ts", "OvermindConsole", "setSignature") +
        "};exports.Console=Console;",
    ),
    context,
  );
  context.exports.Console.setSignature("星海为途，长路有光");
  assert.equal(context.Memory.settings.signature, "星海为途，长路有光");
  context.exports.Console.setSignature("A quiet colony");
  assert.equal(context.Memory.settings.signature, "A quiet colony");
  assert.throws(() => context.exports.Console.setSignature("x".repeat(101)), /over 100/);
});

test("an old owned signature is replaced when configured text changes", () => {
  const context = {
    MY_USERNAME: "harland",
    Memory: { settings: { signature: "星海为途，长路有光" } },
    Game: { time: 100 },
  };
  const { isControllerSignedByMe } = createGameRuntime(context).load("Structures");
  const controller = { sign: { username: "harland", text: "«ᴏᴠᴇʀᴍɪɴᴅ»", time: 90 } };
  assert.equal(isControllerSignedByMe(controller), false);
  controller.sign.text = context.Memory.settings.signature;
  assert.equal(isControllerSignedByMe(controller), true);
});
