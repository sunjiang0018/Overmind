// node --allow-natives-syntax scripts/benchmark-game-helpers.cjs
// Synthetic Node/V8 comparison only. Measure Game.cpu.getUsed() in Screeps before claiming a CPU gain.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const ts = require('typescript');
const constants = require('@screeps/common/lib/constants');
const native = require('../tests/helpers/native-helpers.cjs');
const {getBodyBoosts} = require('../tests/helpers/creep-utils.cjs');
const game = {time: 1};
const scope = {...constants, Game: game, PERMACACHE: {}};
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const exports = {};
  modules.set(name, exports);
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/game', `${name}.ts`), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024},
  }).outputText;
  const requireModule = request => {
    if (request.startsWith('./')) return load(request.slice(2));
    if (request.endsWith('utilities/native')) return native;
    if (request.endsWith('utilities/creepUtils')) return {getBodyBoosts};
    // These imports are outside the benchmarked functions.
    if (request.endsWith('~settings')) return {MY_USERNAME: 'me'};
    if (request.endsWith('utilities/Cartographer')) return {Cartographer: {}};
    if (request.endsWith('utilities/utils')) return {};
    throw new Error(request);
  };
  new Function('exports', 'require', ...Object.keys(scope), code)(exports, requireModule, ...Object.values(scope));
  return exports;
}
const {getCreepBoosts, getCreepBoostCounts} = load('Creep');
const {isPositionOnEdge} = load('RoomPosition');

// Frozen baseline: the two native-array getters used before this migration.
class LegacyCreep {constructor(body) {this.body = body;}}
Object.defineProperties(LegacyCreep.prototype, {
  boosts: {get() {if (!this._boosts) this._boosts = getBodyBoosts(this.body); return this._boosts;}},
  boostCounts: {get() {
    if (!this._boostCounts) this._boostCounts = native.countBy(this.body, part => part.boost);
    return this._boostCounts;
  }},
});
class Creep {constructor(body) {this.body = body;}}
class Position {constructor(x, y) {this.x = x; this.y = y;}}
Object.defineProperty(Position.prototype, 'isEdge', {
  get() {return this.x === 0 || this.x === 49 || this.y === 0 || this.y === 49;},
});
const body = [{type: 'work', boost: 'UH'}, {type: 'move'}, {type: 'attack', boost: 'KO'}];
const oldCreeps = Array.from({length: 128}, () => new LegacyCreep(body));
const newCreeps = Array.from({length: 128}, () => new Creep(body));
const positions = Array.from({length: 128}, (_, i) => new Position(i % 50, i % 49));
for (let i = 0; i < oldCreeps.length; i++) {
  if (i % 2) {
    void oldCreeps[i].boostCounts; void oldCreeps[i].boosts;
    getCreepBoostCounts(newCreeps[i]); getCreepBoosts(newCreeps[i]);
  } else {
    void oldCreeps[i].boosts; void oldCreeps[i].boostCounts;
    getCreepBoosts(newCreeps[i]); getCreepBoostCounts(newCreeps[i]);
  }
  assert.deepEqual(getCreepBoosts(newCreeps[i]), oldCreeps[i].boosts);
  assert.deepEqual(getCreepBoostCounts(newCreeps[i]), oldCreeps[i].boostCounts);
}
let sameMap;
try {sameMap = new Function('a', 'b', 'return %HaveSameMap(a, b);');} catch {}
const shape = {
  legacyOwnKeys: Object.keys(oldCreeps[0]), explicitOwnKeys: Object.keys(newCreeps[0]),
  legacySameMapAfterDifferentReadOrder: sameMap?.(oldCreeps[0], oldCreeps[1]),
  explicitSameMapAfterDifferentReadOrder: sameMap?.(newCreeps[0], newCreeps[1]),
  getterOnlyPositionsSameMap: sameMap?.(positions[0], positions[1]),
};
if (sameMap) {
  assert.equal(shape.legacySameMapAfterDifferentReadOrder, false);
  assert.equal(shape.explicitSameMapAfterDifferentReadOrder, true);
  assert.equal(shape.getterOnlyPositionsSameMap, true);
}
// Give each access expression its own compiled loop so one callback cannot bias later variants' ICs.
const variants = [
  ['pureGetter', positions, null, '+data[i % 128].isEdge'],
  ['pureFunction', positions, isPositionOnEdge, '+helper(data[i % 128])'],
  ['instanceCacheGetter', oldCreeps, null, 'data[i % 128].boosts.length'],
  ['externalCacheFunction', newCreeps, getCreepBoosts, 'helper(data[i % 128]).length'],
].map(([name, data, helper, expression]) => ({name, samples: [],
  run: new Function('data', 'helper', `return function(iterations) {
    let result = 0; for (let i = 0; i < iterations; i++) result += ${expression}; return result;
  }`)(data, helper),
}));
let checksum = 0;
for (const variant of variants) for (let i = 0; i < 5; i++) checksum ^= variant.run(200000);
for (let round = 0; round < 9; round++) {
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[(round + i) % variants.length];
    const start = performance.now();
    checksum ^= variant.run(500000);
    variant.samples.push((performance.now() - start) * 1e6 / 500000);
  }
}
const nsPerRead = Object.fromEntries(variants.map(({name, samples}) =>
  [name, +samples.sort((a, b) => a - b)[4].toFixed(1)]));
console.log(JSON.stringify({node: process.version, v8: process.versions.v8, shape, nsPerRead, checksum}, null, 2));
