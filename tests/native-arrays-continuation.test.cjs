const {createGameRuntime} = require('./helpers/game-runtime.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const {groupBy} = require('./helpers/native-helpers.cjs');
const {mapValues} = require('./helpers/native-helpers.cjs');
const {installNative} = require('./helpers/native-runtime.cjs');

const collections = {
  map: (xs, fn) => Array.from(xs || [], fn),
  filter: (xs, fn) => Object.values(xs || {}).filter(fn),
  compact: xs => xs.filter(Boolean),
  max: xs => xs.length ? Math.max(...xs) : -Infinity,
  min: xs => xs.length ? Math.min(...xs) : Infinity,
};

function loadClass(file, name, members, context = {}) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === name);
  assert.ok(cls, `${file} must declare ${name}`);
  const selected = cls.members.filter(n => n.name && members.includes(n.name.getText(source)));
  context.exports = {};
  installNative(context);
  context._ ||= collections;
  context.groupBy ||= groupBy;
  context.mapValues ||= mapValues;
  vm.runInNewContext(ts.transpileModule(
    `class Subject {${selected.map(n => n.getText(source)).join('\n')}}; exports.Subject = Subject;`,
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017}},
  ).outputText, context);
  return context.exports.Subject;
}

test('swarm checks keep vacuous truth and stop after the first failing creep', () => {
  const Swarm = loadClass('src/zerg/Swarm.ts', 'Swarm', ['safelyInRoom', 'isInFormation']);
  const swarm = new Swarm(), visited = [];
  swarm.creeps = [];
  swarm.getFormationPositionsFromAnchor = () => ({});
  assert.equal(swarm.safelyInRoom('home'), true);
  assert.equal(swarm.isInFormation(), true);
  swarm.creeps = [true, false, true].map((safe, i) => ({name: String(i),
    safelyInRoom: room => {visited.push([i, room]); return safe;},
    pos: {isEqualTo: goal => goal === i},
  }));
  assert.equal(swarm.safelyInRoom('home'), false);
  assert.deepEqual(visited, [[0, 'home'], [1, 'home']]);
  swarm.getFormationPositionsFromAnchor = () => ({0: 0, 1: 1, 2: 2});
  assert.equal(swarm.isInFormation(), true);
  swarm.getFormationPositionsFromAnchor = () => ({0: 0, 1: 9, 2: 2});
  assert.equal(swarm.isInFormation(), false);
});

test('lab state transitions preserve empty lab sets, reservations, and mineral membership', () => {
  const LabStatus = {Idle: 0, AcquiringMinerals: 1, LoadingLabs: 2, Synthesizing: 3, UnloadingLabs: 4};
  const context = {LabStatus, REAGENTS: {OH: ['O', 'H']}, LAB_REACTION_AMOUNT: 5,
    Game: {time: 42}, log: {warning() {}}};
  const Chamber = loadClass('src/hiveClusters/evolutionChamber.ts', 'EvolutionChamber', ['initLabStatus'], context);
  const chamber = new Chamber();
  let checks = 0;
  chamber.statusTimeoutCheck = () => checks++;
  chamber.colony = {assets: {O: 100, H: 100}};
  chamber.labReservations = {reserved: {}};
  chamber.labs = [{id: 'reserved', mineralAmount: 500}, {id: 'free', mineralAmount: 0}];
  chamber.memory = {status: LabStatus.UnloadingLabs, activeReaction: {mineralType: 'OH', amount: 20}};
  chamber.initLabStatus();
  assert.equal(chamber.memory.status, LabStatus.Idle);
  assert.equal(chamber.memory.statusTick, 42);
  chamber.memory.status = LabStatus.LoadingLabs;
  chamber.reagentLabs = [];
  chamber.initLabStatus();
  assert.equal(chamber.memory.status, LabStatus.Synthesizing);
  chamber.initLabStatus();
  assert.equal(chamber.memory.status, LabStatus.Synthesizing);
  chamber.memory.status = LabStatus.LoadingLabs;
  chamber.reagentLabs = [{mineralType: 'X', mineralAmount: 100}];
  chamber.initLabStatus();
  assert.equal(chamber.memory.status, LabStatus.LoadingLabs);
  chamber.reagentLabs = [{mineralType: null, mineralAmount: 100}];
  chamber.initLabStatus();
  assert.equal(chamber.memory.status, LabStatus.LoadingLabs);
  chamber.reagentLabs = [{mineralType: 'O', mineralAmount: 20}, {mineralType: 'H', mineralAmount: 20}];
  chamber.initLabStatus();
  assert.equal(chamber.memory.status, LabStatus.Synthesizing);
  chamber.reagentLabs[1].mineralAmount = 4;
  chamber.initLabStatus();
  assert.equal(chamber.memory.status, LabStatus.UnloadingLabs);
  assert.equal(checks, 7);
});

test('transport selection keeps priority order and applies the filter after choosing the closest target', () => {
  const Group = loadClass('src/logistics/TransportRequestGroup.ts', 'TransportRequestGroup',
    ['getPrioritizedClosestRequest']);
  const group = new Group(), a = {ref: 'a'}, b = {ref: 'b'};
  const first = {target: a, amount: 5}, second = {target: b, amount: 10};
  group.supply = {0: undefined, 1: [first, second]};
  group.withdraw = {1: [second]};
  const pos = {findClosestByRangeThenPath: targets => targets[0]};
  assert.equal(group.getPrioritizedClosestRequest(pos, 'supply'), first);
  assert.equal(group.getPrioritizedClosestRequest(pos, 'supply', request => request.amount > 5), undefined);
  assert.equal(group.getPrioritizedClosestRequest(pos, 'withdraw'), second);
  assert.deepEqual(group.supply[1], [first, second]);
});

test('market cache preserves object-backed owned orders and per-resource price bounds', () => {
  const owned = {id: 'mine', active: true, amount: 5000, type: 'buy', resourceType: 'H', price: 99};
  const orders = [owned,
    {id: 'a', amount: 5000, type: 'buy', resourceType: 'H', price: 2},
    {id: 'b', amount: 5000, type: 'buy', resourceType: 'H', price: 4},
    {id: 'c', amount: 5000, type: 'sell', resourceType: 'O', price: 8},
    {id: 'tiny', amount: 1, type: 'buy', resourceType: 'H', price: 100}];
  const context = {Game: {time: 99, market: {orders: {mine: owned},
    getAllOrders: predicate => orders.filter(predicate)}}, ORDER_BUY: 'buy', ORDER_SELL: 'sell'};
  const Market = loadClass('src/logistics/TradeNetwork.ts', 'TraderJoe', ['buildMarketCache'], context);
  const market = new Market(); market.debug = () => {};
  market.memory = {cache: {buy: {}, sell: {}}};
  market.invalidateMarketCache = () => {};
  market.buildMarketCache();
  assert.deepEqual(JSON.parse(JSON.stringify(market.memory.cache)), {
    buy: {H: {high: 4, low: 2}}, sell: {O: {high: 8, low: 8}}, tick: 99,
  });
});

test('road cost preferences visit every road while preserving blocked cells', () => {
  const Matrix = loadClass('src/matrix/MatrixLib.ts', 'MatrixLib', ['preferRoads', 'blockHostileCreeps']);
  const cells = new Map([[0, 0], [1, 0xfe], [2, 0xff]]), writes = [];
  const matrix = {get: x => cells.get(x), set: (x, y, cost) => {writes.push([x, cost]); cells.set(x, cost);}};
  const room = {roads: [0, 1, 2].map(x => ({pos: {x, y: 0}})),
    hostiles: [3, 4].map(x => ({pos: {x, y: 0}}))};
  Matrix.preferRoads(matrix, room);
  Matrix.blockHostileCreeps(matrix, room);
  assert.deepEqual(writes, [[0, 1], [3, 0xff], [4, 0xff]]);
  assert.equal(cells.get(1), 0xfe);
  assert.equal(cells.get(2), 0xff);
});

test('vacating a clear tile still blocks every nearby managed creep', () => {
  const first = {}, second = {};
  const context = {FIND_MY_CREEPS: 'myCreeps', LOOK_CREEPS: 'creeps',
    Overmind: {zerg: {first, second}}};
  const Movement = loadClass('src/movement/Movement.ts', 'Movement', ['vacatePos'], context);
  const pos = {findInRange: () => [{name: 'first'}, {name: 'missing'}, {name: 'second'}], lookFor: () => []};
  assert.equal(Movement.vacatePos(pos), true);
  assert.equal(first.blockMovement, true);
  assert.equal(second.blockMovement, true);
});

test('planner recall keeps missing position lists empty without losing other map entries', () => {
  const context = {_:{...collections, mapValues: (record, fn) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]))},
    derefRoomPosition: p => ({...p, restored: true})};
  const Planner = loadClass('src/roomPlanner/RoomPlanner.ts', 'RoomPlanner', ['recallMap'], context);
  const planner = new Planner();
  planner.colony = {controller: {level: 4}};
  planner.memory = {mapsByLevel: {4: {road: undefined, spawn: [{x: 3, y: 7}]}}};
  planner.recallMap();
  assert.deepEqual(Array.from(planner.map.road), []);
  assert.deepEqual(Array.from(planner.map.spawn), [{x: 3, y: 7, restored: true}]);
});

test('terminal summaries tolerate resources without provider or requestor groups', () => {
  const output = [], context = {Colony: class {}, bullet: '* ', console: {log: value => output.push(value)}};
  const Network = loadClass('src/logistics/TerminalNetwork_v2.ts', 'TerminalNetworkV2', ['summarize'], context);
  const network = new Network();
  const groups = ['activeRequestors', 'passiveRequestors', 'equilibriumNodes', 'passiveProviders', 'activeProviders'];
  network.stats = {states: Object.fromEntries(groups.map(key => [key, {}]))};
  for (const key of groups) network[key] = {};
  network.summarize('H');
  assert.equal(output.length, 1);
  assert.equal(output[0].split('\n').filter(line => line === '* ').length, 5);
  network.activeProviders.H = [{printAligned: 'home', assets: {H: 50}}];
  network.summarize('H');
  assert.ok(output[1].includes('home (50), '));
});

test('room structure refresh preserves ID order, missing-object removal, and callback arguments', () => {
  const source = fs.readFileSync('src/game/RoomStructures.ts', 'utf8');
  const context = {exports: {}, Room: class {}, FIND_STRUCTURES: 'structures', TERRAIN_MASK_WALL: 1,
    _: {...collections, mapValues: (record, fn) =>
      Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]))}};
  for (const match of source.matchAll(/\bSTRUCTURE_[A-Z_]+\b/g)) context[match[0]] = match[0].slice(10).toLowerCase();
  const towerA = {id: 'towerA', structureType: context.STRUCTURE_TOWER, pos: {x: 5, y: 5}, isWalkable: false};
  const towerB = {id: 'towerB', structureType: context.STRUCTURE_TOWER, pos: {x: 6, y: 5}, isWalkable: false};
  const rampart = {id: 'rampart', structureType: context.STRUCTURE_RAMPART, pos: {x: 10, y: 10},
    isWalkable: true, my: true};
  const blocked = {id: 'blocked', structureType: context.STRUCTURE_RAMPART, pos: {x: 11, y: 10},
    isWalkable: false};
  const objects = {towerA, towerB, rampart, blocked}, calls = [];
  context.Game = {time: 1, map: {getRoomTerrain: () => ({get: () => 0})}, getObjectById: (...args) => {
    calls.push([args[0], args[1], Array.isArray(args[2])]);
    return objects[args[0]] || null;
  }};
  context.require = () => ({onPublicServer: () => false, getCacheExpiration: () => 11, groupBy});
  installNative(context);
  const helpers = createGameRuntime(context).load('RoomStructures');
  let finds = 0;
  context.Room.prototype.find = () => {finds++; return [towerA, towerB, rampart, blocked];};
  const first = new context.Room(); first.name = 'home';
  assert.deepEqual(Array.from(helpers.getRoomTowers(first)), [towerA, towerB]);
  assert.deepEqual(calls.slice(0, 2), [['towerA', 0, true], ['towerB', 1, true]]);
  assert.deepEqual(Array.from(helpers.getRoomWalkableRamparts(first)), [rampart]);
  delete objects.towerB; delete objects.rampart;
  context.Game.time = 2;
  const next = new context.Room(); next.name = 'home';
  assert.deepEqual(Array.from(helpers.getRoomTowers(next)), [towerA]);
  assert.deepEqual(Array.from(helpers.getRoomWalkableRamparts(next)), []);
  // One scan builds the ID cache and one supplies the walkability scan; neither repeats next tick.
  assert.equal(finds, 2);
});

test('stack resolution preserves blank lines and leaves traces untouched without source maps', () => {
  const context = {resolve: line => ({final: 'mapped:' + line})};
  const Log = loadClass('src/console/log.ts', 'Log', ['resolveStack'], context);
  context.Log = Log;
  const log = new Log(), stack = 'first\n\nlast';
  assert.equal(log.resolveStack(stack), stack);
  Log.sourceMap = {};
  assert.equal(log.resolveStack(stack), 'mapped:first\nmapped:\nmapped:last');
});
