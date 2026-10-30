const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const lodash = require('./helpers/screeps-lodash.cjs');
const {mapValues} = require('./helpers/native-helpers.cjs');
const {native, installNative} = require('./helpers/native-runtime.cjs');

function loadClass(file, name, members, context = {}) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === name);
  assert.ok(cls, `${file} must declare ${name}`);
  const selected = cls.members.filter(n => n.name && members.includes(n.name.getText(source)));
  context.exports = {};
  installNative(context);
  context._ = lodash;
  context.mapValues = mapValues;
  vm.runInNewContext(ts.transpileModule(
    `exports.Subject = class Subject {${selected.map(n => n.getText(source)).join('\n')}};`,
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024}},
  ).outputText, context);
  return context.exports.Subject;
}

test('dictionary mapping preserves own key order, value identity, and Lodash 3 callback arguments', () => {
  assert.equal(lodash.VERSION, '3.10.1');
  const source = Object.assign(Object.create({inherited: 'ignore'}), {later: {}, 10: {}, 2: {}, first: {}});
  source[Symbol('hidden')] = 'ignore';
  Object.defineProperty(source, 'hidden', {value: 'ignore'});
  const visited = [];
  const actual = mapValues(source, (value, key, object) => {
    visited.push(key);
    assert.equal(object, source);
    return value;
  });
  assert.deepEqual(visited, ['2', '10', 'later', 'first']);
  assert.deepEqual(actual, lodash.mapValues(source, value => value));
  assert.equal(actual.later, source.later);
  assert.equal(Object.getPrototypeOf(actual), Object.prototype);
});

test('dictionary mapping returns a fresh ordinary object for empty and missing caches', () => {
  for (const source of [null, undefined, {}, Object.create(null)]) {
    let calls = 0;
    const actual = mapValues(source, () => calls++);
    assert.deepEqual(actual, lodash.mapValues(source, () => calls++));
    assert.equal(Object.getPrototypeOf(actual), Object.prototype);
    assert.equal(calls, 0);
    assert.notEqual(actual, source);
  }
});

test('dictionary mapping snapshots keys but reads subsequent values after callback mutations', () => {
  function run(mapper) {
    const source = {first: 1, changed: 2, deleted: 3}, visited = [];
    const result = mapper(source, (value, key, object) => {
      visited.push([key, value]);
      if (key === 'first') {
        object.changed = 20;
        delete object.deleted;
        object.added = 4;
      }
      return value;
    });
    return {result, visited};
  }
  assert.deepEqual(run(mapValues), run(lodash.mapValues));
  assert.deepEqual(run(mapValues).visited, [['first', 1], ['changed', 20], ['deleted', undefined]]);
});

test('dictionary mapping keeps Lodash 3 handling of constructor, hasOwnProperty, and __proto__', () => {
  const source = Object.fromEntries([['constructor', 1], ['hasOwnProperty', 2], ['__proto__', 3], ['normal', 4]]);
  const inherited = {marker: true};
  for (const mapper of [value => value * 2, (value, key) => key === '__proto__' ? inherited : value]) {
    const actual = mapValues(source, mapper), expected = lodash.mapValues(source, mapper);
    assert.deepEqual(actual, expected);
    assert.equal(Object.getPrototypeOf(actual), Object.getPrototypeOf(expected));
    assert.equal(Object.hasOwn(actual, '__proto__'), Object.hasOwn(expected, '__proto__'));
  }
});

test('creep role refresh keeps missing caches, role order, unresolved names, and synchronization order', () => {
  const worker = {name: 'worker'}, power = {name: 'power'}, calls = [];
  const context = {Overmind: {cache: {overlords: {}}}, Game: {creeps: {worker}, powerCreeps: {power}}};
  for (const [file, name, method, record, zerg, gameName, creep] of [
    ['src/overlords/Overlord.ts', 'Overlord', 'recalculateCreeps', '_creeps', '_zerg', 'worker', worker],
    ['src/overlords/PowerOverlord.ts', 'PowerOverlord', 'recalculatePowerCreeps', '_powerCreeps', '_powerZerg', 'power', power],
  ]) {
    const Class = loadClass(file, name, [method], context), subject = new Class();
    subject.ref = 'overlord';
    subject[zerg] = {worker: [], empty: []};
    subject._combatZerg = {combat: []};
    subject.synchronizeZerg = role => calls.push('zerg:' + role);
    subject.synchronizeCombatZerg = role => calls.push('combat:' + role);
    subject.synchronizePowerZerg = role => calls.push('power:' + role);
    delete context.Overmind.cache.overlords.overlord;
    subject[method]();
    assert.deepEqual(subject[record], {});
    context.Overmind.cache.overlords.overlord = {worker: [gameName, 'missing'], empty: undefined};
    subject[method]();
    assert.deepEqual(Object.keys(subject[record]), ['worker', 'empty']);
    assert.deepEqual(Array.from(subject[record].worker), [creep, undefined]);
    assert.deepEqual(Array.from(subject[record].empty), []);
  }
  assert.deepEqual(calls, ['zerg:worker', 'zerg:empty', 'combat:combat',
    'zerg:worker', 'zerg:empty', 'combat:combat', 'power:worker', 'power:empty', 'power:worker', 'power:empty']);
});

test('bunker placement translates every coordinate without mutating the shared layout', () => {
  class Position {constructor(x, y, roomName) {Object.assign(this, {x, y, roomName});}}
  const buildings = {spawn: {pos: [{x: 1, y: 2}]}, road: {pos: [{x: 3, y: 4}, {x: 2, y: 1}]}, tower: {pos: []}};
  const original = structuredClone(buildings);
  const Planner = loadClass('src/roomPlanner/RoomPlanner.ts', 'RoomPlanner', ['getStructureMapForBunkerAt'],
    {RoomPosition: Position, bunkerLayout: {data: {anchor: {x: 2, y: 2}}, 8: {buildings}}});
  const planner = new Planner(); planner.colony = {name: 'home'};
  const actual = planner.getStructureMapForBunkerAt({x: 20, y: 30});
  const expected = lodash.mapValues(lodash.mapValues(buildings, building => building.pos),
    coords => coords.map(coord => new Position(coord.x + 18, coord.y + 28, 'home')));
  assert.deepEqual(actual, expected);
  assert.deepEqual(buildings, original);
  assert.notEqual(actual.spawn, buildings.spawn.pos);
});

test('matching summary keeps request identity, output order, and input arrays intact', () => {
  // The distinct requests deliberately share an ID: membership must use object identity.
  const first = {id: 'same', target: {ref: 'first', pos: {print: 'p1', toString: () => 'p1'}}};
  const second = {id: 'same', target: {ref: 'second', pos: 'p2'}};
  const creeps = [{name: 'idle', pos: 'c0'}, {name: 'busy', pos: 'c1'}, {name: 'spawning', spawning: true}];
  const output = [];
  // Screeps' string helpers belong to the VM realm where this method runs.
  const context = {Roles: {transport: 'transport'}, Game: {time: 42},
    console: {log: line => output.push(line)}};
  vm.runInNewContext('String.prototype.padRight = function(n) { return this.padEnd(n); };', context);
  const Network = loadClass('src/logistics/LogisticsNetwork.ts', 'LogisticsNetwork', ['summarizeMatching'], context);
  const network = new Network();
  network.requests = [first, second];
  network.colony = {name: 'home', getCreepsByRole: role => {
    assert.equal(role, 'transport'); return creeps;
  }};
  network._matching = {busy: first};
  network.summarizeMatching();
  assert.deepEqual(output, ['Stable matching for home at 42', 'busy c1'.padEnd(30) + ' : first p1',
    'idle c0'.padEnd(30) + ' : ', ''.padEnd(30) + ' : second p2', undefined]);
  assert.deepEqual(network.requests, [first, second]);
  assert.deepEqual(creeps.map(creep => creep.name), ['idle', 'busy', 'spawning']);
  output.length = 0;
  network._matching = undefined;
  network.summarizeMatching();
  assert.equal(output.length, 6);
  assert.ok(output[1].includes('idle c0'));
  assert.ok(output[2].includes('busy c1'));
});

test('directive info keeps the existing column output for mapped creep records', () => {
  const context = installNative({_: lodash, mapValues});
  vm.runInNewContext(`String.prototype.padRight = function(n, c) {return this.padEnd(n, c);};
    String.prototype.padLeft = function(n, c) {return this.padStart(n, c);};`, context);
  const source = ts.createSourceFile('utils.ts', fs.readFileSync('src/utilities/utils.ts', 'utf8'),
    ts.ScriptTarget.Latest, true);
  const toColumns = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'toColumns');
  context.exports = {};
  vm.runInNewContext(ts.transpileModule(toColumns.getText(source),
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024}}).outputText, context);
  const olInfo = {
    '    Creep usage:': '{"worker":1}',
    '    Zerg:': lodash.mapValues({worker: [{print: 'worker-link'}]}, creeps => creeps.map(creep => creep.print)),
    '    CombatZerg:': lodash.mapValues(undefined, value => value),
  };
  const expectedColumns = Array.from(context.exports.toColumns(olInfo)).join('\n');
  context.toColumns = context.exports.toColumns;
  context.print = () => '{}';
  const Directive = loadClass('src/directives/Directive.ts', 'Directive', ['info'], context);
  const directive = new Directive();
  Object.assign(directive, {print: 'directive', directiveName: 'test', name: 'flag',
    pos: {print: 'position'}, colony: {print: 'colony'}, memory: {},
    overlords: {main: {creepUsageReport: {worker: 1}, _zerg: {worker: [{print: 'worker-link'}]}}}});
  assert.ok(directive.info().includes('  main:\n' + expectedColumns + 'Memory:\n{}'));
});
