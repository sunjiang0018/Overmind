// Run with Node 24: node scripts/benchmark-collections.cjs > /tmp/collections-benchmark.json
// Synthetic operation timings; these are not measurements of Screeps tick CPU.
const {performance} = require('node:perf_hooks');
const os = require('node:os');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
const lodash = require('../tests/helpers/screeps-lodash.cjs');
const {mapValues} = require('../tests/helpers/native-helpers.cjs');

let sink = 0;
function runBatch(fn, count) {
  const start = performance.now();
  for (let i = 0; i < count; i++) sink ^= fn();
  return performance.now() - start;
}

function measure(variants) {
  const entries = Object.entries(variants);
  const batches = {}, samples = {};
  for (const [name, fn] of entries) {
    runBatch(fn, 3000);
    let count = 256;
    while (runBatch(fn, count) < 8 && count < 131072) count *= 2;
    batches[name] = count;
    samples[name] = [];
  }
  // Rotate execution order to reduce bias from measuring a variant first every time.
  for (let round = 0; round < 7; round++) {
    for (let i = 0; i < entries.length; i++) {
      const [name, fn] = entries[(round + i) % entries.length];
      samples[name].push(runBatch(fn, batches[name]) * 1e6 / batches[name]);
    }
  }
  return Object.fromEntries(entries.map(([name]) => [name, Math.round(samples[name].sort((a, b) => a - b)[3])]));
}

const rows = [];
for (const size of [4, 20, 200]) {
  const source = Object.fromEntries(Array.from({length: size}, (_, i) => ['k' + i, i]));
  const mapper = value => value + 1;
  rows.push({operation: 'mapValues', size, nsPerOp: measure({
    lodash: () => lodash.mapValues(source, mapper).k0,
    entriesMapFromEntries: () => Object.fromEntries(Object.entries(source ?? {}).map(([key, value]) =>
      [key, mapper(value, key, source)])).k0,
    keysLoop: () => mapValues(source, mapper).k0,
  })});
  rows.push({operation: 'values', size, nsPerOp: measure({
    lodash: () => lodash.values(source).length,
    native: () => Object.values(source ?? {}).length,
  })});
  rows.push({operation: 'filter values', size, nsPerOp: measure({
    entriesFilterMap: () => Object.entries(source ?? {}).filter(([, value]) => value % 2 === 0)
      .map(([, value]) => value).length,
    valuesFilter: () => Object.values(source ?? {}).filter(value => value % 2 === 0).length,
  })});
}

for (const size of [20, 100, 500]) {
  const requests = Array.from({length: size}, (_, i) => ({id: String(i)}));
  const matching = Object.fromEntries(requests.filter((_, i) => i % 2 === 0).map((item, i) => ['c' + i, item]));
  rows.push({operation: 'unmatched request membership', size, nsPerOp: measure({
    repeatedLodashValues: () => requests.filter(request => !lodash.values(matching).includes(request)).length,
    repeatedNativeValues: () => requests.filter(request => !Object.values(matching).includes(request)).length,
    setOnce: () => {
      const matched = new Set(Object.values(matching ?? {}));
      return requests.filter(request => !matched.has(request)).length;
    },
  })});
}

console.log(JSON.stringify({
  node: process.version, lodash: lodash.VERSION, platform: process.platform, arch: process.arch,
  cpu: os.cpus()[0]?.model, unit: 'median nanoseconds per operation', samples: 7,
  fixtures: 'k-prefixed own enumerable dictionary keys; membership matches every other request by identity',
  rows, checksum: sink,
}, null, 2));
