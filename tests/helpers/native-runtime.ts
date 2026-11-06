import { installGameFixtures } from "./game-fixtures";
import * as native from "../../src/utilities/native";
import type { TestScope } from "./types";

/**
 * Exposes the compiled native helper functions to a VM-based test scope.
 * The extracted-method tests call helpers as globals; whole-file tests import them through
 * `require('../utilities/native')`, so both access paths are wired up here.
 */
function installNative(context: TestScope) {
  Object.assign(context, native);
  const originalRequire = context.require;
  context.require = function (name: string, ...args: any[]) {
    if (typeof name === "string" && name.endsWith("utilities/native")) {
      return native;
    }
    return originalRequire ? originalRequire(name, ...args) : {};
  };
  return installGameFixtures(context);
}

export { installNative };
