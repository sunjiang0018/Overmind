import { classMembers } from "./helpers/source";
import type { TestScope } from "./helpers/types";
import { test } from "vite-plus/test";
import { createGameRuntime } from "./helpers/game-runtime";

import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
const compile = (source: string) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
  }).outputText;
function method(file: string, className: string, name: string) {
  return classMembers(file, className, [name]);
}
test("signature accepts unbranded text, retaining the length check", () => {
  const context: TestScope = {
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
  const context: TestScope = {
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
