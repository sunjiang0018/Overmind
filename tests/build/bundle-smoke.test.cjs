const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const {loadBundle} = require('../helpers/screeps-runtime.cjs');

const bundle = path.resolve('dist/main.js');

for (const scenario of [
  {name: 'global reset, build and refresh ticks', options: {}, ticks: 3},
  {name: 'low CPU bucket suspension', options: {bucket: 100}, ticks: 2},
  {name: 'full bucket pixel generation', options: {bucket: 10000}, ticks: 1},
]) {
  test(`Rolldown bundle supports ${scenario.name}`, () => {
    const runtime = loadBundle(bundle, scenario.options);
    const {context} = runtime;
    assert.deepEqual(Object.keys(context.module.exports), ['loop']);
    assert.equal(typeof context.module.exports.loop, 'function');
    assert.equal(context.Memory.build, 1);
    assert.equal(context.LATEST_GLOBAL_RESET_TICK, 1001);
    assert.equal(context.Room.prototype._refreshStructureCache, undefined);
    assert.equal(Object.getOwnPropertyDescriptor(context.RoomObject.prototype, 'ref'), undefined);
    for (let i = 0; i < scenario.ticks; i++) runtime.tick();
    if (scenario.options.bucket === 10000) assert.equal(runtime.calls.pixels, 1);
    if (scenario.options.bucket === 100) assert.equal(context.Memory.tick, 1001);
    else {
      assert.equal(context.Memory.tick, 1001 + scenario.ticks);
      assert.equal(context.Overmind.exceptions.length, 0);
      assert.equal(context.PHASE, 'postRun');
    }
  });
}

test('compressed room memory keys round-trip without ambient enum globals', () => {
  const runtime = loadBundle(bundle);
  const result = JSON.parse(vm.runInContext(`
    RoomIntel.setExpansionData('W1N1', {
      score: 123, bunkerAnchor: new RoomPosition(11, 12, 'W1N1'), outposts: {W2N1: 9},
    });
    Memory.rooms.W1N1.T = 777;
    JSON.stringify({saved: Memory.rooms.W1N1, decoded: RoomIntel.getExpansionData('W1N1'),
                    lastVisible: RoomIntel.lastVisible('W1N1')});
  `, runtime.context));
  assert.deepEqual(Object.keys(result.saved).sort(), ['T', 'e']);
  assert.deepEqual(Object.keys(result.saved.e).sort(), ['a', 'o', 's']);
  assert.equal(result.decoded.score, 123);
  assert.equal(result.decoded.bunkerAnchor.x, 11);
  assert.equal(result.lastVisible, 777);
});

test('training startup retains the existing training tick error', () => {
  const runtime = loadBundle(bundle, {training: true});
  assert.equal(typeof runtime.context.module.exports.loop, 'function');
  // The existing training reset never sets this global. Do not hide a baseline bug with a mock.
  assert.throws(() => runtime.tick(), /LATEST_GLOBAL_RESET_TICK is not defined/);
});
