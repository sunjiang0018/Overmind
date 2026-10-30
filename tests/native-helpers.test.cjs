const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('./helpers/native-helpers.cjs');

test('sum handles arrays, Screeps store-like dictionaries, and iteratees', () => {
  assert.equal(native.sum([1, 2, 3]), 6);
  assert.equal(native.sum({energy: 500, H: 20, O: 5}), 525);
  assert.equal(native.sum([{v: 2}, {v: 5}], item => item.v), 7);
  assert.equal(native.sum({a: {v: 3}, b: {v: 4}}, item => item.v), 7);
  assert.equal(native.sum(null), 0);
});

test('min and max support values, dictionaries, and mapped values', () => {
  assert.equal(native.min([5, 2, 9]), 2);
  assert.equal(native.max([5, 2, 9]), 9);
  assert.equal(native.min({a: 5, b: 2}), 2);
  assert.equal(native.max({a: 5, b: 9}), 9);
  assert.equal(native.min([{v: 5}, {v: 2}], item => item.v), 2);
  assert.equal(native.max([{v: 5}, {v: 9}], item => item.v), 9);
  assert.equal(native.max(null), -Infinity);
  assert.equal(native.max([], item => item), -Infinity);
});

test('sortBy is stable, non-mutating, and accepts dictionaries', () => {
  const values = [{id: 'a', v: 2}, {id: 'b', v: 1}, {id: 'c', v: 1}, {id: 'd', v: 3}];
  let iterateeCalls = 0;
  const sorted = native.sortBy(values, item => {
    iterateeCalls++;
    return item.v;
  });
  assert.deepEqual(sorted.map(item => item.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(values.map(item => item.id), ['a', 'b', 'c', 'd']);
  assert.equal(iterateeCalls, values.length);
  assert.deepEqual(native.sortBy({away: 30, home: 10, remote: 20}), [10, 20, 30]);
  const priorities = [3, 1, 2];
  assert.deepEqual(native.sortBy(priorities), [1, 2, 3]);
  assert.deepEqual(priorities, [3, 1, 2]);
});

test('defaults and defaultsDeep fill missing values only', () => {
  const opts = {a: 1, b: undefined};
  assert.equal(native.defaults(opts, {a: 9, b: 2, c: 3}), opts);
  assert.deepEqual(opts, {a: 1, b: 2, c: 3});

  const memory = {settings: {log: {level: 'info'}}, routes: [undefined, 2]};
  native.defaultsDeep(memory, {settings: {log: {level: 'debug', tick: 5}, audio: false}, routes: [1, 9, 3]});
  assert.deepEqual(memory, {
    settings: {log: {level: 'info', tick: 5}, audio: false},
    routes: [1, 2, 3],
  });
});

test('clone and cloneDeep copy containers while preserving functions', () => {
  const callback = () => 42;
  const source = {nested: {value: 1}, list: [1, 2], callback};
  const shallow = native.clone(source);
  assert.notEqual(shallow, source);
  assert.equal(shallow.nested, source.nested);
  assert.equal(shallow.list, source.list);

  const deep = native.cloneDeep(source);
  assert.notEqual(deep.nested, source.nested);
  assert.notEqual(deep.list, source.list);
  assert.equal(deep.callback, callback);
});

test('remove and pull mutate arrays in place', () => {
  const creeps = [{name: 'a', dead: true}, {name: 'b', dead: false}, {name: 'c', dead: true}];
  const removed = native.remove(creeps, creep => creep.dead);
  assert.deepEqual(removed.map(creep => creep.name), ['a', 'c']);
  assert.deepEqual(creeps.map(creep => creep.name), ['b']);

  const boosts = ['XUH2O', 'UH2O', 'XUH2O'];
  native.pull(boosts, 'XUH2O');
  assert.deepEqual(boosts, ['UH2O']);
});

test('compact, unique, uniqueBy, and flatten preserve ordering', () => {
  assert.deepEqual(native.compact([undefined, {id: 'a'}, null, {id: 'b'}]).map(item => item.id), ['a', 'b']);
  assert.deepEqual(native.compactMap([{id: 'a'}, null, {id: 'b'}], item => item).map(item => item.id), ['a', 'b']);
  assert.deepEqual(native.unique([3, 1, 3, 2, 1]), [3, 1, 2]);
  assert.deepEqual(native.uniqueBy([{id: 'a', v: 1}, {id: 'b', v: 1}, {id: 'c', v: 2}], item => item.v)
    .map(item => item.id), ['a', 'c']);
  assert.deepEqual(native.flatten([[1, 2], undefined, [3]]), [1, 2, 3]);
  assert.deepEqual(native.flatten([[1], [2, 3]]), [1, 2, 3]);
  assert.deepEqual(native.flatten([null, [], [4]]), [4]);
  assert.deepEqual(native.flatten([, [1, , 3]]), [1, undefined, 3]);
  assert.deepEqual(native.flatten([[1, 2]]), [1, 2]);
  assert.deepEqual(native.flatten(null), []);
});

test('zipObject, range, take, drop, and dropRight match project call shapes', () => {
  assert.deepEqual(native.zipObject(['energy', 'H'], [100, 5]), {energy: 100, H: 5});
  assert.deepEqual(native.zipObject([['a', 1], ['b', 2]]), {a: 1, b: 2});
  assert.deepEqual(native.range(4), [0, 1, 2, 3]);
  assert.deepEqual(native.range(0, -3, -1), [0, -1, -2]);
  assert.deepEqual(native.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(native.chunk([], 2), []);
  assert.deepEqual(native.take([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(native.drop([1, 2, 3], 1), [2, 3]);
  assert.deepEqual(native.dropRight([1, 2, 3]), [1, 2]);
});

test('memoize, countBy, partition, and size handle project collections', () => {
  let calls = 0;
  const memoized = native.memoize(value => {
    calls++;
    return value * 2;
  });
  assert.equal(memoized(3), 6);
  assert.equal(memoized(3), 6);
  assert.equal(calls, 1);

  assert.deepEqual(native.countBy(['work', 'work', 'carry']), {work: 2, carry: 1});
  assert.deepEqual(native.countBy([{boost: 'XUH2O'}, {boost: undefined}], item => item.boost),
    {XUH2O: 1, undefined: 1});
  const [ready, waiting] = native.partition([{ready: true}, {ready: false}], item => item.ready);
  assert.equal(ready.length, 1);
  assert.equal(waiting.length, 1);
  assert.equal(native.size({a: 1, b: 2}), 2);
  assert.equal(native.size([1, 2, 3]), 3);
});

test('shuffle and sample keep the input set intact', () => {
  const values = [1, 2, 3, 4, 5];
  const shuffled = native.shuffle(values);
  assert.deepEqual([...shuffled].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(values, [1, 2, 3, 4, 5]);
  assert.ok(values.includes(native.sample(values)));
  const sample = native.sample(values, 3);
  assert.equal(sample.length, 3);
  assert.ok(sample.every(value => values.includes(value)));
  assert.equal(new Set(sample).size, sample.length);
  assert.deepEqual(native.sample(values, values.length).sort(), [...values].sort());
  assert.deepEqual(native.sample(values, 0), []);
});
