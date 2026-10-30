// Compares the native collection helpers against the Lodash 3 build supplied by Screeps.
// Run with: node scripts/benchmark-native-helpers.cjs
const os = require('node:os');
const lodash = require('../tests/helpers/screeps-lodash.cjs');
const native = require('../tests/helpers/native-helpers.cjs');

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function bench(lodashFn, nativeFn) {
  const iterations = 20000;
  const warmup = Math.min(iterations, 50000);
  for (let i = 0; i < warmup; i++) {
    lodashFn();
    nativeFn();
  }
  const samples = {lodash: [], native: []};
  for (let sample = 0; sample < 15; sample++) {
    let start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) lodashFn();
    samples.lodash.push(Number(process.hrtime.bigint() - start) / iterations);

    start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) nativeFn();
    samples.native.push(Number(process.hrtime.bigint() - start) / iterations);
  }
  // Discard the first five samples so JIT tiering/GC warmup does not skew the result.
  return {lodash: median(samples.lodash.slice(5)), native: median(samples.native.slice(5))};
}

const store = {energy: 5000, H: 120, O: 30, Z: 10, K: 0, X: 0};
const numbers = Array.from({length: 32}, (_, i) => i * 3 % 17);
const objects = Array.from({length: 64}, (_, i) => ({i, v: (i * 37) % 23, name: 'c' + i}));
const compactInput = Array.from({length: 64}, (_, i) => i % 3 ? {i} : null);
const uniqueInput = Array.from({length: 64}, (_, i) => i % 9);
const nested = Array.from({length: 8}, (_, i) => Array.from({length: 8}, (_, j) => i * 8 + j));
const options = {a: 1, b: 2, c: 3};

const cases = [
  ['sum(store dictionary)', () => lodash.sum(store), () => native.sum(store)],
  ['sum(number array)', () => lodash.sum(numbers), () => native.sum(numbers)],
  ['sum(array, iteratee)', () => lodash.sum(objects, o => o.v), () => native.sum(objects, o => o.v)],
  ['max(array, iteratee)', () => lodash.max(objects.map(o => o.v)), () => native.max(objects, o => o.v)],
  ['sortBy(objects, iteratee)', () => lodash.sortBy(objects, o => o.v), () => native.sortBy(objects, o => o.v)],
  ['compact(array)', () => lodash.compact(compactInput), () => native.compact(compactInput)],
  ['unique(number array)', () => lodash.uniq(uniqueInput), () => native.unique(uniqueInput)],
  ['flatten(nested arrays)', () => lodash.flatten(nested), () => native.flatten(nested)],
  ['defaults(options, source)', () => lodash.defaults({...options}, {a: 9, d: 4}),
    () => native.defaults({...options}, {a: 9, d: 4})],
  ['zipObject(keys, values)', () => lodash.zipObject(Object.keys(store), Object.values(store)),
    () => native.zipObject(Object.keys(store), Object.values(store))],
  ['clone(options)', () => lodash.clone(options), () => native.clone(options)],
];

console.log(JSON.stringify({
  node: process.version,
  lodash: lodash.VERSION,
  cpu: os.cpus()[0]?.model,
  platform: process.platform,
  arch: process.arch,
  unit: 'median nanoseconds per operation',
  samples: 15,
  discardedSamples: 5,
  rows: cases.map(([operation, lodashFn, nativeFn]) => ({operation, ...bench(lodashFn, nativeFn)})),
}, null, 2));
