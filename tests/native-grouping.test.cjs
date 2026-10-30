const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const {groupBy} = require('./helpers/native-helpers.cjs');

function loadClass(file, name, members, context = {}) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === name);
  assert.ok(cls, `${file} must declare ${name}`);
  context.exports = {};
  context.groupBy = groupBy;
  const selected = cls.members.filter(n => ts.isConstructorDeclaration(n)
    ? members.includes('constructor') : n.name && members.includes(n.name.getText(source)));
  vm.runInNewContext(ts.transpileModule(
    `class Subject {${selected.map(n => n.getText(source)).join('\n')}}; exports.Subject = Subject;`,
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017}},
  ).outputText, context);
  return context.exports.Subject;
}

test('grouping retains item identity, encounter order, missing keys, and dictionary results', () => {
  const first = {id: 'first', role: 'worker'}, missing = {id: 'missing'}, last = {id: 'last', role: 'worker'};
  const input = [first, missing, last], seen = [];
  const groups = groupBy(input, item => {seen.push(item.id); return item.role;});
  assert.deepEqual(Reflect.ownKeys(groups), ['worker', 'undefined']);
  assert.deepEqual(groups.worker, [first, last]);
  assert.deepEqual(groups.undefined, [missing]);
  assert.deepEqual(seen, ['first', 'missing', 'last']);
  assert.equal(groups.worker[0], first);
  assert.equal(groups.worker[1], last);
  assert.equal(Object.getPrototypeOf(groups), null);
  assert.deepEqual(input, [first, missing, last]);
  assert.deepEqual(Reflect.ownKeys(groupBy(null, () => 'unused')), []);
  assert.deepEqual(Reflect.ownKeys(groupBy(undefined, () => 'unused')), []);
  assert.deepEqual(groupBy([first], () => null).null, [first]);
});

test('grouping retains reserved-key and symbol-key behavior', () => {
  const symbol = Symbol('role');
  const records = [{key: 'constructor'}, {key: 'hasOwnProperty'}, {key: '__proto__'}, {key: symbol},
    {key: 'constructor'}];
  const groups = groupBy(records, item => item.key);
  assert.deepEqual(groups.constructor, [records[0], records[4]]);
  assert.deepEqual(groups.hasOwnProperty, [records[1]]);
  assert.deepEqual(groups.__proto__, [records[2]]);
  assert.deepEqual(groups[symbol], [records[3]]);
  assert.equal(Object.getPrototypeOf(groups), null);
  assert.equal(Object.prototype.polluted, undefined);
});

test('grouping visits explicit missing values and sparse array positions in order', () => {
  const input = Array(3); input[1] = 'worker';
  const groups = groupBy(input, item => item);
  assert.deepEqual(groups.undefined, [undefined, undefined]);
  assert.deepEqual(groups.worker, ['worker']);
});

test('game cache groups object-backed creeps and missing colony or overlord names', () => {
  const a = {memory: {colony: 'home', overlord: 'mine', role: 'worker'}};
  const b = {memory: {colony: 'home', overlord: 'mine', role: 'worker'}};
  const c = {memory: {role: 'scout'}};
  const power = {memory: {overlord: 'mine', role: 'operator'}};
  const context = {MEM: {COLONY: 'colony', OVERLORD: 'overlord'},
    Game: {creeps: {a, b, c}, powerCreeps: {power}}};
  const Cache = loadClass('src/caching/GameCache.ts', 'GameCache', ['cacheCreepsByColony', 'cacheOverlords'], context);
  const cache = new Cache();
  cache.cacheCreepsByColony(); cache.cacheOverlords();
  assert.deepEqual(cache.creepsByColony.home, [a, b]);
  assert.deepEqual(cache.creepsByColony.undefined, [c]);
  assert.deepEqual(cache.overlords.mine.worker, ['a', 'b']);
  // The baseline computes power-creep groups but only registers regular-creep names.
  assert.equal(cache.overlords.mine.operator, undefined);
  assert.deepEqual(cache.overlords.undefined.scout, ['c']);
});

test('memory profiling preserves null, primitive, nested, and sparse-array leaf behavior', () => {
  const context = {};
  const Console = loadClass('src/console/Console.ts', 'OvermindConsole', ['recursiveMemoryProfile'], context);
  context.OvermindConsole = Console;
  const sizes = {};
  Console.recursiveMemoryProfile({nil: null, flag: false, count: 5, nested: {leaf: 2}, sparse: Array(2)}, sizes, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sizes)), {nil: 4, flag: 5, count: 1, nested: {leaf: 1}, sparse: {}});
});

test('object-backed flag filters preserve item order, identity, and short-circuit evaluation', () => {
  const home = {name: 'home', type: 'outpost'}, ignored = {name: 'ignored'}, keeper = {name: 'keeper', type: 'keeper'};
  const visited = [];
  const context = {Game: {flags: {home, ignored, keeper}},
    DirectiveOutpost: {filter: flag => {visited.push(flag.name); return flag.type === 'outpost';}},
    DirectiveSKOutpost: {filter: flag => {visited.push('sk:' + flag.name); return flag.type === 'keeper';}}};
  const Cache = loadClass('src/caching/GameCache.ts', 'GameCache', ['constructor'], context);
  const cache = new Cache();
  assert.deepEqual(Array.from(cache.outpostFlags), [home, keeper]);
  assert.deepEqual(visited, ['home', 'ignored', 'sk:ignored', 'keeper', 'sk:keeper']);
});

test('caller-supplied order predicates retain lazy reads of later dictionary values', () => {
  const first = {id: 'first'}, previous = {id: 'previous'}, replacement = {id: 'replacement'};
  const orders = {first, second: previous}, canceled = [];
  const context = {Game: {market: {orders, cancelOrder: id => canceled.push(id)}}, _: {
    filter: (record, predicate) => {
      const result = [];
      for (const key of Object.keys(record)) {
        const value = record[key];
        if (predicate(value)) result.push(value);
      }
      return result;
    },
    values: Object.values,
  }};
  const Console = loadClass('src/console/Console.ts', 'OvermindConsole', ['cancelMarketOrders'], context);
  const message = Console.cancelMarketOrders(order => {
    if (order === first) orders.second = replacement;
    return true;
  });
  assert.equal(message, 'Canceled 2 orders.');
  assert.deepEqual(canceled, ['first', 'replacement']);
});
