const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const constants = require('@screeps/common/lib/constants');
const native = require('./native-helpers.cjs');
const creepUtils = require('./creep-utils.cjs');

const gameRoot = path.resolve('src/game');
const compiled = new Map();

/** Load the real helper modules in one isolated module graph, without installing any prototypes. */
function createGameRuntime(scope = {}, dependencies = {}) {
  for (const [key, value] of Object.entries(constants)) if (!(key in scope)) scope[key] = value;
  scope.Game ||= {time: 1, rooms: {}, shard: {name: 'shard3'}};
  scope.Game.time ??= 1;
  scope.PERMACACHE ||= {};
  const modules = new Map();
  function load(name) {
    const file = path.resolve(gameRoot, name.replace(/\.ts$/, '') + '.ts');
    if (modules.has(file)) return modules.get(file);
    let code = compiled.get(file);
    if (!code) {
      code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024},
      }).outputText;
      compiled.set(file, code);
    }
    const exports = {};
    modules.set(file, exports);
    const requireModule = request => {
      if (request in dependencies) return dependencies[request];
      if (request.startsWith('./')) return load(request);
      if (request.endsWith('utilities/native')) return native;
      if (request.endsWith('utilities/creepUtils')) return creepUtils;
      if (request.endsWith('~settings')) return {MY_USERNAME: scope.MY_USERNAME || 'me'};
      if (request.endsWith('utilities/utils')) return {
        onPublicServer: () => true,
        getCacheExpiration: timeout => scope.Game.time + timeout,
        isAlly: () => false,
        mod: (n, m) => ((n % m) + m) % m,
        minBy: (xs, score) => xs.reduce((best, x) => !best || score(x) < score(best) ? x : best, undefined),
      };
      if (request.endsWith('utilities/Cartographer')) return {Cartographer: scope.Cartographer || {}};
      throw new Error(`Unmocked game helper dependency: ${request}`);
    };
    // Keep fixture object/array identity in the test realm while reading the mutable game scope.
    new Function('scope', `with (scope) { return function(exports, require) {\n${code}\n}; }`)(scope)(exports, requireModule);
    return exports;
  }
  return {load, scope};
}

module.exports = {createGameRuntime};
