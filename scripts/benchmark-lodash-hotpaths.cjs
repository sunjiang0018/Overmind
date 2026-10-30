// Node 24: node scripts/benchmark-lodash-hotpaths.cjs > /tmp/lodash-hotpaths-benchmark.json
// Synthetic fixtures exercise actual source functions against the pre-pass Lodash 3 behavior.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
process.chdir(path.resolve(__dirname, '..'));
const {createSubjects, constants, lodash, creepUtils} = require('../tests/helpers/hotpath-subjects.cjs');
const {createBaseline} = require('../tests/fixtures/lodash-hotpaths.cjs');
const subject = createSubjects(), baseline = createBaseline();

let checksum = 0;
function batch(fn, count) {
  const start = performance.now();
  for (let i = 0; i < count; i++) checksum ^= fn();
  return performance.now() - start;
}

function measure(variants) {
  const entries = Object.entries(variants), counts = {}, samples = {};
  for (const [name, fn] of entries) {
    batch(fn, 5000);
    let count = 1024;
    while (batch(fn, count) < 8 && count < 1048576) count *= 2;
    counts[name] = count; samples[name] = [];
  }
  for (let round = 0; round < 7; round++) {
    for (let i = 0; i < entries.length; i++) {
      const [name, fn] = entries[(round + i) % entries.length];
      samples[name].push(batch(fn, counts[name]) * 1e6 / counts[name]);
    }
  }
  return Object.fromEntries(entries.map(([name]) =>
    [name, Math.round(samples[name].sort((a, b) => a - b)[3] * 10) / 10]));
}

const rows = [];
function compare(operation, size, before, after, applied = true, extra = {}) {
  assert.deepEqual(after(), before(), operation);
  rows.push({operation, size, applied, ...extra, nsPerOp: measure({before, after})});
}

for (const size of [1, 10, 50]) {
  const types = ['move', 'carry', 'work', 'attack', 'heal'];
  const boosts = {move: 'XZHO2', work: 'XGH2O', attack: 'XUH2O', heal: 'XLHO2'};
  const body = Array.from({length: size}, (_, i) => {
    const type = types[i % types.length];
    return {type, hits: i % 3 ? 100 : 0, boost: i % 2 ? undefined : boosts[type]};
  });
  const parts = body.map(part => part.type), unboosted = body.map(({type, hits}) => ({type, hits}));
  const units = Array.from({length: size}, (_, i) => ({name: 'creep' + i}));
  const creep = {body, store: {getUsedCapacity: () => 25, getCapacity: () => 100}};
  compare('body cost', size, () => baseline.bodyCost(parts), () => subject.bodyCost(parts));
  compare('synchronization name lookup', size, () => baseline.nameLookup(units).creep0,
    () => creepUtils.getNameLookup(units).creep0);
  compare('unique body boosts', size, () => baseline.uniqueBoosts(body).length,
    () => subject.uniqueBoosts({body}).length, true, {fixture: 'mixed boosts'});
  compare('unique body boosts', size, () => baseline.uniqueBoosts(unboosted).length,
    () => subject.uniqueBoosts({body: unboosted}).length, true, {fixture: 'unboosted'});
  compare('approximate movement speed', size, () => baseline.speed(body), () => subject.speed(body));
  compare('creep weight', size, () => baseline.weight(creep).weighted, () => subject.weight(creep).weighted);
  compare('boost mineral demand', size, () => baseline.requiredBoostAmount(body, 'XZHO2'),
    () => subject.requiredBoostAmount(body, 'XZHO2'));
}

// Vary coordinates instead of allowing the optimizer to fold constant extrema.
const positions = Array.from({length: 2500}, (_, i) => new subject.RoomPosition(i % 50, Math.floor(i / 50)));
let beforeIndex = 0, afterIndex = 0;
compare('range to room edge', positions.length,
  () => baseline.rangeToEdge(positions[beforeIndex++ % positions.length]),
  () => positions[afterIndex++ % positions.length].rangeToEdge);
const from = new subject.RoomPosition(12, 25, 'W1N1'), to = new subject.RoomPosition(45, 3, 'W2N1');
compare('multi-room range', 2, () => baseline.multiRoomRange(
          Object.assign(Object.create(from), {roomCoords: subject.positions.getRoomPositionRoomCoords(from)}),
          Object.assign(Object.create(to), {roomCoords: subject.positions.getRoomPositionRoomCoords(to)})), () => subject.positions.roomPositionGetMultiRoomRangeTo(from, to));

// Retained alternatives are measured to explain why this pass does not replace them wholesale.
for (const size of [10, 50]) {
  const items = Array.from({length: size}, (_, i) => ({value: i / 3}));
  const mapper = item => item.value;
  compare('generic mapped sum candidate', size, () => lodash.sum(items, mapper), () => {
    let result = 0;
    for (let i = items.length - 1; i >= 0; i--) result += +mapper(items[i]) || 0;
    return result;
  }, false, {reason: 'inlined synthetic loop only; other sum inputs and callback arities are outside this pass'});
  const lists = Array.from({length: size}, () => [1, 2, 3]);
  compare('flatMap candidate', size, () => lodash.flatten(lists.map(list => list)).length,
    () => lists.flatMap(list => list).length, false, {reason: 'native flatMap is slower on these fixtures'});
}

console.log(JSON.stringify({node: process.version, lodash: lodash.VERSION, cpu: os.cpus()[0]?.model,
  platform: process.platform, arch: process.arch, samples: 7, unit: 'median nanoseconds per operation',
  method: '5000 warmups, adaptive batches, rotating variant order; includes result allocation',
  scope: 'synthetic function timings, not Screeps tick CPU; cached getters measured on their first access',
  bodySizes: [1, 10, 50], rows, checksum}, null, 2));
