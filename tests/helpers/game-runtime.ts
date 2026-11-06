import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { constants } from "./constants";
import * as native from "../../src/utilities/native";
import * as creepUtils from "../../src/utilities/creepUtils";
import type { TestScope } from "./types";

const gameRoot = path.resolve("src/game");
const compiled = new Map<string, string>();

/** Load the real helper modules in one isolated module graph, without installing any prototypes. */
function createGameRuntime(scope: TestScope = {}, dependencies: TestScope = {}) {
  for (const [key, value] of Object.entries(constants)) if (!(key in scope)) scope[key] = value;
  scope.Game ||= { time: 1, rooms: {}, shard: { name: "shard3" } };
  scope.Game.time ??= 1;
  scope.PERMACACHE ||= {};
  const modules = new Map<string, TestScope>();
  function load(name: string): TestScope {
    const file = path.resolve(gameRoot, name.replace(/\.ts$/, "") + ".ts");
    const cached = modules.get(file);
    if (cached) return cached;
    let code = compiled.get(file);
    if (!code) {
      code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024 },
      }).outputText;
      compiled.set(file, code);
    }
    const exports: TestScope = {};
    modules.set(file, exports);
    const requireModule = (request: string) => {
      if (request in dependencies) return dependencies[request];
      if (request.startsWith("./")) return load(request);
      if (request.endsWith("utilities/native")) return native;
      if (request.endsWith("utilities/creepUtils")) return creepUtils;
      if (request.endsWith("~settings")) return { MY_USERNAME: scope.MY_USERNAME || "me" };
      if (request.endsWith("utilities/utils"))
        return {
          onPublicServer: () => true,
          getCacheExpiration: (timeout: number) => scope.Game.time + timeout,
          isAlly: () => false,
          mod: (n: number, m: number) => ((n % m) + m) % m,
          minBy: <T>(xs: T[], score: (x: T) => number) =>
            xs.reduce<T | undefined>(
              (best, x) => (!best || score(x) < score(best) ? x : best),
              undefined,
            ),
        };
      if (request.endsWith("utilities/Cartographer"))
        return { Cartographer: scope.Cartographer || {} };
      throw new Error(`Unmocked game helper dependency: ${request}`);
    };
    // Keep fixture object/array identity in the test realm while reading the mutable game scope.
    new Function("scope", `with (scope) { return function(exports, require) {\n${code}\n}; }`)(
      scope,
    )(exports, requireModule);
    return exports;
  }
  return { load, scope };
}

export { createGameRuntime };
