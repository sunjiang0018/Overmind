// Compares old Lodash call-site expressions with the native expressions used after the migration.
// Unlike benchmark-native-helpers.cjs, each case includes the surrounding project work (mapping,
// filtering, option copying) so the numbers reflect real call-site gains.
// Run with: node scripts/benchmark-project-patterns.cjs
const os = require('node:os');
const lodash = require('../tests/helpers/screeps-lodash.cjs');
const native = require('../tests/helpers/native-helpers.cjs');

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

let sink = 0;

function consume(value) {
  if (typeof value === 'number') sink += value;
  else if (value != null && typeof value.length === 'number') sink += value.length;
  else sink += value ? 1 : 0;
}

function bench(oldFn, newFn, iterations) {
  const warmup = Math.min(iterations, 100000);
  for (let i = 0; i < warmup; i++) {
    consume(oldFn());
    consume(newFn());
  }
  const oldSamples = [];
  const newSamples = [];
  for (let sample = 0; sample < 15; sample++) {
    // Alternate ordering to reduce thermal and JIT-order bias.
    if (sample % 2 === 0) {
      let start = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) consume(oldFn());
      oldSamples.push(Number(process.hrtime.bigint() - start) / iterations);
      start = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) consume(newFn());
      newSamples.push(Number(process.hrtime.bigint() - start) / iterations);
    } else {
      let start = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) consume(newFn());
      newSamples.push(Number(process.hrtime.bigint() - start) / iterations);
      start = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) consume(oldFn());
      oldSamples.push(Number(process.hrtime.bigint() - start) / iterations);
    }
  }
  // Discard the first five samples; Lodash's polymorphic helpers tier up later than the native loops.
  return {lodash: median(oldSamples.slice(5)), native: median(newSamples.slice(5))};
}

const store = {energy: 50000, H: 1200, O: 300, Z: 100, K: 20, X: 10, UH2O: 3000, GH2O: 1500};
const creeps = Array.from({length: 24}, (_, i) => ({
  name: 'creep' + i,
  carry: {energy: i * 17 % 50, H: i % 3 ? 0 : 10},
  ticksToLive: 1200 + i * 13,
  pos: {
    x: i % 25,
    y: (i * 7) % 25,
    getRangeTo: other => Math.max(Math.abs(i % 25 - other.x), Math.abs((i * 7) % 25 - other.y)),
  },
}));
const barriers = Array.from({length: 40}, (_, i) => ({id: 'b' + i, hits: 5000 + i * 177}));
const rooms = Array.from({length: 20}, (_, i) => ({name: 'W' + (i % 4) + 'N' + (i % 5), i}));
const nested = Array.from({length: 8}, (_, i) => Array.from({length: 8}, (_, j) => i * 8 + j));
const options = {a: 1, b: 2, c: 3, d: 4};

const cases = [
  ['sum(store) [8 keys]', () => lodash.sum(store), () => native.sum(store), 100000],
  ['sum(creeps, iteratee) [24]', () => lodash.sum(creeps, c => c.carry.energy),
    () => native.sum(creeps, c => c.carry.energy), 50000],
  ['sum(creeps.map(carry)) [24]', () => lodash.sum(creeps.map(c => c.carry.energy)),
    () => native.sum(creeps, c => c.carry.energy), 50000],
  ['max(barriers.map(hits)) [40]', () => lodash.max(barriers.map(b => b.hits)),
    () => native.max(barriers, b => b.hits), 50000],
  ['min(creeps.map(ttl)) [24]', () => lodash.min(creeps.map(c => c.ticksToLive)),
    () => native.min(creeps, c => c.ticksToLive), 50000],
  ['sortBy(creeps, range) [24]', () => lodash.sortBy(creeps, c => c.pos.getRangeTo({x: 0, y: 0})),
    () => native.sortBy(creeps, c => c.pos.getRangeTo({x: 0, y: 0})), 20000],
  ['compact(creeps.map(...)) [24]', () => lodash.compact(creeps.map(c => c.carry.H ? c : null)),
    () => native.compactMap(creeps, c => c.carry.H ? c : null), 30000],
  ['unique(room names) [20]', () => lodash.uniq(rooms.map(r => r.name)),
    () => native.unique(rooms.map(r => r.name)), 50000],
  ['flatten(8x8)', () => lodash.flatten(nested), () => native.flatten(nested), 100000],
  ['defaults(options)', () => lodash.defaults({...options}, {a: 9, e: 5}),
    () => native.defaults({...options}, {a: 9, e: 5}), 100000],
  ['remove(dead creeps) [24]', () => lodash.remove(creeps.filter(() => true), c => c.ticksToLive < 1250),
    () => native.remove(creeps.filter(() => true), c => c.ticksToLive < 1250), 30000],
  ['zipObject(20 keys)', () => lodash.zipObject(rooms.map(r => r.name), rooms.map(r => r.i)),
    () => native.zipObject(rooms.map(r => r.name), rooms.map(r => r.i)), 50000],
  ['clone(options)', () => lodash.clone(options), () => native.clone(options), 200000],
];

const caseArg = process.argv.indexOf('--case');
const selectedCases = caseArg >= 0 ? [cases[Number(process.argv[caseArg + 1])]] : cases;
if (selectedCases.some(testCase => testCase == undefined)) {
  throw new Error('--case must be a valid case index');
}

console.log(JSON.stringify({
  node: process.version,
  lodash: lodash.VERSION,
  cpu: os.cpus()[0]?.model,
  platform: process.platform,
  arch: process.arch,
  unit: 'median nanoseconds per operation',
  samples: 15,
  discardedSamples: 5,
  sink,
  rows: selectedCases.map(([operation, oldFn, newFn, iterations]) => {
    const value = bench(oldFn, newFn, iterations);
    return {operation, ...value, speedup: value.lodash / value.native};
  }),
}, null, 2));
