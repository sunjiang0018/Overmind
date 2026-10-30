const test = require('node:test');
const assert = require('node:assert/strict');
const {createSubjects, loadClass, constants, lodash, creepUtils} = require('./helpers/hotpath-subjects.cjs');
const {createBaseline} = require('./fixtures/lodash-hotpaths.cjs');
const {native} = require('./helpers/native-runtime.cjs');
const subject = createSubjects();
const baseline = createBaseline();

function bodies() {
  const fixtures = [[], [{type: 'move', hits: 100}], [{type: 'carry', hits: 0}],
    [{type: 'move', hits: 0, boost: 'XZHO2'}]];
  const types = ['move', 'carry', 'work', 'attack', 'ranged_attack', 'heal', 'tough', 'claim'];
  const boosts = {move: 'XZHO2', work: 'XGH2O', attack: 'XUH2O', heal: 'XLHO2'};
  for (let size = 1; size <= 50; size++) {
    fixtures.push(Array.from({length: size}, (_, i) => {
      const type = types[(i * 3 + size) % types.length];
      return {type, hits: i % 3 ? 100 : 0, boost: i % 2 ? undefined : boosts[type]};
    }));
  }
  return fixtures;
}

test('body cost preserves reverse reads, missing values, numeric coercion, and empty inputs', () => {
  assert.equal(lodash.VERSION, '3.10.1');
  for (const body of [...bodies().map(parts => parts.map(part => part.type)), null, undefined,
    ['invalid', undefined, 'move'], ['move', , 'work']]) {
    assert.equal(subject.bodyCost(body), baseline.bodyCost(body));
  }
  const reads = [], costs = {};
  for (const [key, value] of Object.entries({first: 1e16, second: -1e16, third: 1, invalid: NaN})) {
    Object.defineProperty(costs, key, {get() {reads.push(key); return value;}});
  }
  const actual = createSubjects({BODYPART_COST: costs});
  const expected = createBaseline({BODYPART_COST: costs});
  const input = ['first', 'second', 'third', 'invalid'];
  assert.equal(actual.bodyCost(input), expected.bodyCost(input));
  assert.deepEqual(reads, ['invalid', 'third', 'second', 'first', 'invalid', 'third', 'second', 'first']);
});

test('name indexes retain ordinary-object membership, duplicates, reserved names, and missing roles', () => {
  for (const units of [null, undefined, [], [{name: 'first'}, {name: 'last'}, {name: 'first'}],
    ['constructor', '__proto__', 'hasOwnProperty', 'toString'].map(name => ({name}))]) {
    const actual = creepUtils.getNameLookup(units), expected = baseline.nameLookup(units);
    assert.deepEqual(actual, expected);
    assert.equal(Object.getPrototypeOf(actual), Object.getPrototypeOf(expected));
    for (const name of ['first', 'constructor', '__proto__', 'toString']) {
      assert.equal(actual[name], expected[name]);
    }
  }
});

test('boost extraction preserves first occurrence, false-value removal, and sparse body maps', () => {
  const fixtures = [...bodies(), [{boost: 'UH'}, {}, {boost: 'UH'}, {boost: 'KO'}, {boost: ''},
    {boost: false}, {boost: null}, {boost: NaN}], [{boost: 'UH'}, , {boost: 'KO'}]];
  for (const body of fixtures) {
    const expected = baseline.uniqueBoosts(body);
    assert.deepEqual(creepUtils.getBodyBoosts(body), expected);
    assert.deepEqual(subject.uniqueBoosts({body}), expected);
    assert.notEqual(subject.uniqueBoosts({body}), subject.uniqueBoosts({body}));
    const creep = new subject.Creep(); creep.body = body;
    assert.deepEqual(subject.creeps.getCreepBoosts(creep), expected);
    assert.equal(subject.creeps.getCreepBoosts(creep), subject.creeps.getCreepBoosts(creep));
  }
});

test('movement speed keeps damaged parts, NaN/Infinity results, and its existing cache', () => {
  for (const body of bodies()) assert.equal(subject.speed(body), baseline.speed(body));
  const creep = new subject.Creep();
  creep.body = [{type: 'move', boost: 'XZHO2', hits: 0}];
  assert.equal(subject.creeps.getCreepApproxMoveSpeed(creep), Infinity);
  creep.body.push({type: 'work', hits: 100});
  assert.equal(subject.creeps.getCreepApproxMoveSpeed(creep), Infinity);
  subject.scope.Game.time++;
  assert.equal(subject.creeps.getCreepApproxMoveSpeed(creep), baseline.speed(creep.body));
  assert.ok(Number.isNaN(subject.speed([])));
});

test('movement weights keep extra carry counts, property order, boosts, and store reads', () => {
  for (const body of bodies()) {
    for (const analyzeCarry of [true, false]) {
      for (const load of [0, 25, 100]) {
        const calls = [];
        const creep = {body, store: {getUsedCapacity() {calls.push('used'); return load;},
          getCapacity() {calls.push('capacity'); return 100;}}};
        const actual = subject.weight(creep, analyzeCarry), actualCalls = calls.splice(0);
        const expected = baseline.weight(creep, analyzeCarry);
        assert.deepEqual(actual, expected);
        assert.deepEqual(Object.keys(actual), Object.keys(expected));
        assert.deepEqual(actualCalls, calls);
      }
    }
  }
});

test('boost demand preserves subtraction across all body parts without clamping negative results', () => {
  for (const body of [...bodies(), [{type: 'work', hits: 0, boost: 'XZHO2'}]]) {
    for (const boost of ['XZHO2', 'XGH2O', 'XUH2O', 'XLHO2', 'energy']) {
      assert.equal(subject.requiredBoostAmount(body, boost), baseline.requiredBoostAmount(body, boost));
    }
  }
  assert.equal(subject.requiredBoostAmount([{type: 'work', boost: 'XZHO2'}], 'XZHO2'), -30);
});

for (const [file, name, method, zergRecord, creepRecord, power, combat] of [
  ['src/overlords/Overlord.ts', 'Overlord', 'synchronizeZerg', '_zerg', '_creeps', false, false],
  ['src/overlords/Overlord.ts', 'Overlord', 'synchronizeCombatZerg', '_combatZerg', '_creeps', false, true],
  ['src/overlords/PowerOverlord.ts', 'PowerOverlord', 'synchronizePowerZerg', '_powerZerg', '_powerCreeps', true, false],
]) {
  test(`${method} keeps wrapper identity, duplicates, in-place removal, and notification options`, () => {
    const Overmind = {zerg: {}, powerZerg: {}}, created = [];
    class Wrapper {
      constructor(creep, notify) {
        this.name = creep.name; this.isCombatZerg = combat;
        created.push([creep.name, notify]);
        Overmind[power ? 'powerZerg' : 'zerg'][creep.name] = this;
      }
    }
    const Class = loadClass(file, name, [method], {...constants, _: lodash, ...native, Overmind,
      getNameLookup: creepUtils.getNameLookup, Zerg: Wrapper, CombatZerg: Wrapper, PowerZergOperator: Wrapper});
    const object = new Class();
    const keep = {name: 'keep'}, dead = {name: 'dead'}, reuse = {name: 'reuse', isCombatZerg: combat};
    const wrappers = [dead, keep];
    object[zergRecord] = {worker: wrappers};
    object[creepRecord] = {worker: ['keep', 'reuse', 'fresh', 'fresh'].map(name =>
      ({name, className: constants.POWER_CLASS.OPERATOR}))};
    Overmind[power ? 'powerZerg' : 'zerg'].reuse = reuse;
    object[method]('worker', true);
    assert.equal(object[zergRecord].worker, wrappers);
    assert.deepEqual(wrappers.map(wrapper => wrapper.name), ['keep', 'reuse', 'fresh', 'fresh']);
    assert.equal(wrappers[0], keep);
    assert.equal(wrappers[1], reuse);
    assert.equal(wrappers[2], wrappers[3]);
    assert.deepEqual(created, [['fresh', true]]);
    object[method]('worker', false);
    assert.deepEqual(created, [['fresh', true]]);
    delete object[creepRecord].worker;
    object[method]('worker');
    assert.equal(object[zergRecord].worker, wrappers);
    assert.deepEqual(wrappers, []);
  });
}

test('coordinate extrema preserve every room tile and cross-room range calculations', () => {
  for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) {
    const pos = new subject.RoomPosition(x, y);
    assert.equal(subject.positions.getRoomPositionRangeToEdge(pos), baseline.rangeToEdge(pos));
  }
  for (const room of ['W1N1', 'E0N0', 'W0S0', 'E12S34', 'W12N34']) {
    for (const other of ['W1N1', 'W2N1', 'E0S0', 'E12S35']) {
      for (const [x, y] of [[0, 0], [49, 49], [12, 38]]) {
        const from = new subject.RoomPosition(x, y, room), to = new subject.RoomPosition(49 - x, 49 - y, other);
        assert.equal(subject.positions.roomPositionGetMultiRoomRangeTo(from, to), baseline.multiRoomRange(
          Object.assign(Object.create(from), {roomCoords: subject.positions.getRoomPositionRoomCoords(from)}),
          Object.assign(Object.create(to), {roomCoords: subject.positions.getRoomPositionRoomCoords(to)})));
      }
    }
  }
});
