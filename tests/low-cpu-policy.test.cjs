const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const {installNative} = require('./helpers/native-runtime.cjs');

function evaluate(source, context) {
  installNative(context);
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, experimentalDecorators: true},
  }).outputText, context);
}
function loadClass(file, className, members, context) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className);
  evaluate(`class Subject {${cls.members.filter(n => n.name && members.includes(n.name.getText(source)))
    .map(n => n.getText(source)).join('\n')}}; exports.Subject = Subject;`, context);
  return context.exports.Subject;
}
function scheduleContext() {
  const context = {exports: {}, Game: {time: 0}};
  evaluate(fs.readFileSync('src/utilities/scheduler.ts', 'utf8'), context);
  context.isRoomTick = context.exports.isRoomTick;
  return context;
}

test('each room runs once per interval, with stable room and task offsets', () => {
  const context = scheduleContext();
  const slots = [];
  for (const room of ['E58S42', 'E59S42', 'E58S43']) {
    const ticks = [];
    for (let tick = 0; tick < 50; tick++) {
      context.Game.time = tick;
      if (context.isRoomTick(room, 25)) ticks.push(tick);
    }
    assert.equal(ticks.length, 2);
    assert.equal(ticks[1] - ticks[0], 25);
    context.Game.time = (ticks[0] + 1) % 25;
    assert.equal(context.isRoomTick(room, 25, 1), true);
    slots.push(ticks[0]);
  }
  assert.equal(new Set(slots).size, 3);
});

test('disabled random scouts never request replacements and abandon old roaming tasks', () => {
  const context = {exports: {}, RANDOM_SCOUT_COUNT: 0, Setups: {scout: {}}};
  const Scout = loadClass('src/overlords/scouting/randomWalker.ts', 'RandomWalkerScoutOverlord', ['init', 'run'], context);
  const recycled = [], moving = [];
  const spawn = {recycleCreep: creep => recycled.push(creep)};
  const scout = near => ({task: {name: 'goToRoom'}, creep: {},
    pos: {findClosestByMultiRoomRange: () => spawn, isNearTo: () => near},
    goTo: target => moving.push(target)});
  const home = scout(true), away = scout(false), spawning = {spawning: true};
  const subject = new Scout();
  let requested;
  Object.assign(subject, {colony: {spawns: [spawn]}, scouts: [spawning, away, home], wishlist: n => requested = n});
  subject.init(); subject.run();
  assert.equal(requested, 0);
  assert.equal(away.task, null); assert.equal(home.task, null);
  assert.deepEqual(recycled, [home.creep]); assert.deepEqual(moving, [spawn]);
  // A spawning scout must not prevent the other scouts from retiring.
  assert.equal(spawning.task, undefined);
});

test('retired scouts without a home spawn are removed instead of becoming permanent idlers', () => {
  const context = {exports: {}, RANDOM_SCOUT_COUNT: 0};
  const Scout = loadClass('src/overlords/scouting/randomWalker.ts', 'RandomWalkerScoutOverlord', ['run'], context);
  let retired = 0;
  const subject = new Scout();
  Object.assign(subject, {colony: {spawns: []}, scouts: [{pos: {findClosestByMultiRoomRange: () => undefined},
    suicide: () => retired++}]});
  subject.run(); assert.equal(retired, 1);
});

test('visuals master switch suppresses direct rendering even when saved Memory enables it', () => {
  const settings = {ENABLE_VISUALS: false};
  let renders = 0;
  const context = {exports: {}, Memory: {settings: {enableVisuals: true}},
    require: name => name.includes('~settings') ? settings : {profile: cls => cls},
    RoomVisual: class {constructor() {renders++;} animatedPosition() {return this;}}};
  evaluate(fs.readFileSync('src/visuals/Visualizer.ts', 'utf8'), context);
  const visual = context.exports.Visualizer;
  const pos = {x: 1, y: 2, roomName: 'E58S42'};
  visual.marker(pos); visual.circle(pos); visual.rect(pos); visual.drawRoads([]); visual.drawPath([]);
  visual.drawLogo(); visual.drawHUD(); visual.drawGraphs(); visual.drawNotifications([]); visual.visuals();
  visual.displayCostMatrix({}); visual.text('test', pos); visual.barGraph(0.5, pos);
  visual.section('test', pos, 5, 5); visual.infoBox('test', [], pos, 5);
  visual.table([['test']], pos); visual.multitext(['test'], pos); visual.showInfo([], {pos});
  assert.equal(renders, 0);
  settings.ENABLE_VISUALS = true; visual.marker(pos); assert.equal(renders, 1);
  context.Memory.settings.enableVisuals = false; visual.marker(pos); assert.equal(renders, 1);
});

test('outer visual dispatcher does no work when rendering is disabled', () => {
  const context = {exports: {}, Visualizer: {enabled: false}};
  const Subject = loadClass('src/Overmind.ts', 'Overmind', ['visuals'], context);
  new Subject().visuals(); // No Game, colonies, or overseer should be accessed.
});

test('outpost patrols are staggered; an observed threat is handled on that room scheduled tick', () => {
  const context = scheduleContext();
  const defended = [];
  Object.assign(context, {Overseer: {settings: {outpostDefenseFrequency: 5}},
    DirectiveOutpostDefense: {createIfNotPresent: pos => defended.push([context.Game.time, pos.roomName])},
    Pathing: {findPathablePosition: roomName => ({roomName})}});
  const Subject = loadClass('src/Overseer.ts', 'Overseer', ['handleOutpostDefense'], context);
  const subject = new Subject();
  const colony = {isRoomActive: () => true,
    outposts: ['E58S42', 'E58S43'].map(name => ({name, dangerousPlayerHostiles: [{}]}))};
  for (let tick = 0; tick < 10; tick++) {context.Game.time = tick; subject.handleOutpostDefense(colony);}
  assert.equal(defended.length, 4);
  assert.notEqual(defended[0][0], defended[1][0]);
  for (const room of colony.outposts) {
    const ticks = defended.filter(([, name]) => name === room.name).map(([tick]) => tick);
    assert.equal(ticks[1] - ticks[0], 5);
  }
});

test('routine directive checks are spaced out while home defense and bootstrapping run every tick', () => {
  const context = scheduleContext();
  const colony = {name: 'E58S42'};
  Object.assign(context, {LATEST_BUILD_TICK: -1, getAllColonies: () => [colony],
    _: {forEach: (items, fn) => items.forEach(fn)}, Memory: {settings: {powerCollection: {}, autoPoison: {}}},
    getAutonomyLevel: () => 0, Autonomy: {Manual: 0}, onPublicServer: () => true});
  const Subject = loadClass('src/Overseer.ts', 'Overseer', ['settings', 'placeDirectives'], context);
  context.Overseer = Subject;
  const subject = new Subject(), counts = {};
  for (const method of ['handleBootstrapping', 'handleOutpostDefense', 'handleColonyInvasions',
    'handleNukeResponse', 'handleUnkillableStrongholds']) {
    counts[method] = 0; subject[method] = () => counts[method]++;
  }
  for (let tick = 0; tick < 100; tick++) {context.Game.time = tick; subject.placeDirectives();}
  assert.equal(counts.handleBootstrapping, 100); assert.equal(counts.handleColonyInvasions, 100);
  assert.equal(counts.handleNukeResponse, 4); assert.equal(counts.handleUnkillableStrongholds, 1);
});

test('cached fortification candidates above the cap are skipped and new tasks receive the limit', () => {
  const tasks = [];
  const context = {exports: {}, _: {filter: (xs, fn) => xs.filter(fn), map: (xs, fn) => xs.map(fn),
    max: xs => Math.max(...xs), take: (xs, n) => xs.slice(0, n)}, Tasks: {fortify: (target, limit) => {
      const task = {target, limit}; tasks.push(task); return task;
    }}, WorkerOverlord: {settings: {hitTolerance: 100000}}};
  const Subject = loadClass('src/overlords/core/worker.ts', 'WorkerOverlord', ['fortifyActions'], context);
  const subject = new Subject(); subject.barrierTarget = 5000;
  const worker = {pos: {findClosestByMultiRoomRange: targets => targets[0]}};
  assert.equal(subject.fortifyActions(worker, [{hits: 5000}, {hits: 10000}]), false);
  assert.equal(subject.fortifyActions(worker, [{hits: 5000}, {hits: 2000}]), true);
  assert.equal(tasks[0].limit, 5000); assert.equal(tasks[0].target.hits, 2000);
});
