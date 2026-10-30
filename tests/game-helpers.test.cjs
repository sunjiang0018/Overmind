const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createGameRuntime} = require('./helpers/game-runtime.cjs');
const constants = require('@screeps/common/lib/constants');

test('truncateNumber preserves sign and handles exponent notation without extending Number', () => {
  const {truncateNumber, toPercent} = createGameRuntime().load('Miscellaneous');
  assert.equal(truncateNumber(-1.2345, 2), -1.23);
  assert.equal(truncateNumber(1e-7, 2), 0);
  assert.equal(truncateNumber(123.999, 2), 123.99);
  assert.equal(truncateNumber(-1.239, 0), -1);
  assert.equal(toPercent(0.1234, 2), '12.34%');
  assert.equal(Object.hasOwn(Number.prototype, 'truncate'), false);
  assert.equal(Object.hasOwn(Number.prototype, 'toPercent'), false);
});

test('marketDeal uses each tick market receiver and marks only successful owned terminal intents', () => {
  const scope = {Game: {time: 1, rooms: {}, market: {}}, OK: 0};
  const runtime = createGameRuntime(scope);
  const {marketDeal} = runtime.load('Game');
  const {isTerminalReady} = runtime.load('Structures');
  const terminal = Object.freeze({my: true, cooldown: 0});
  scope.Game.rooms = {target: {terminal}};
  const calls = [];
  const makeMarket = response => ({
    deal(orderId, amount, targetRoomName) {
      calls.push({thisArg: this, orderId, amount, targetRoomName});
      return response;
    },
  });
  const first = makeMarket(0), originalDeal = first.deal;
  scope.Game.market = first;
  assert.equal(marketDeal('first', 5, 'target'), 0);
  assert.equal(calls[0].thisArg, first);
  assert.equal(first.deal, originalDeal);
  assert.equal(isTerminalReady(terminal), false);

  scope.Game.time++;
  const second = makeMarket(-6);
  scope.Game.market = second;
  assert.equal(isTerminalReady(terminal), true);
  assert.equal(marketDeal('failed', 1, 'target'), -6);
  assert.equal(calls[1].thisArg, second);
  assert.equal(isTerminalReady(terminal), true);
  scope.Game.market = makeMarket(0);
  marketDeal('no-room', 1);
  assert.equal(isTerminalReady(terminal), true);
  scope.Game.rooms.target.terminal = {my: false, cooldown: 0};
  marketDeal('foreign', 1, 'target');
  assert.equal(isTerminalReady(scope.Game.rooms.target.terminal), true);
  scope.Game.rooms.target.terminal = terminal;
  marketDeal('success', 1, 'target');
  assert.equal(isTerminalReady(terminal), false);
});

function roomStructuresScope() {
  const objects = {};
  const scope = {
    Room: class Room {
      constructor(name, structures) {this.name = name; this._structures = structures;}
      find(type) {return type === constants.FIND_STRUCTURES ? this._structures : [];}
    },
    Game: {time: 1000, objects, getObjectById: id => objects[id] || null,
      map: {getRoomTerrain: () => ({get: () => 0})}},
  };
  scope.helpers = createGameRuntime(scope).load('RoomStructures');
  return scope;
}

test('Room walls/constructedWalls/barriers stay defined and repairables exclude invader cores', () => {
  const scope = roomStructuresScope();
  const wall = {id: 'wall', structureType: constants.STRUCTURE_WALL, hits: 1000, pos: {x: 4, y: 5}};
  const indestructible = {id: 'indestructible', structureType: constants.STRUCTURE_WALL, hits: undefined,
    pos: {x: 5, y: 5}};
  const rampart = {id: 'rampart', structureType: constants.STRUCTURE_RAMPART, hits: 500, my: true,
    isPublic: false, isWalkable: true, pos: {x: 6, y: 5}};
  const core = {id: 'core', structureType: constants.STRUCTURE_INVADER_CORE, hits: 100, pos: {x: 7, y: 5}};
  const structures = [wall, indestructible, rampart, core];
  for (const structure of structures) {
    structure.isWalkable = Boolean(structure.isWalkable);
    scope.Game.objects[structure.id] = structure;
  }
  const room = new scope.Room('W1N1', structures);

  assert.deepEqual(Array.from(scope.helpers.getRoomWalls(room), s => s.id), ['wall', 'indestructible']);
  assert.deepEqual(Array.from(scope.helpers.getRoomConstructedWalls(room), s => s.id), ['wall', 'indestructible']);
  assert.deepEqual(Array.from(scope.helpers.getRoomBarriers(room), s => s.id), ['rampart', 'wall', 'indestructible']);
  assert.equal(scope.helpers.getRoomBarriers(room).includes(undefined), false);
  assert.equal(scope.helpers.getRoomRepairables(room).some(s => s.structureType === constants.STRUCTURE_INVADER_CORE), false);
  assert.deepEqual(Array.from(scope.helpers.getRoomWalkableRamparts(room), s => s.id), ['rampart']);
});

test('Room.walls aliases the generated constructedWalls cache rather than reading an undefined field', () => {
  const scope = roomStructuresScope();
  const wall = {id: 'wall', structureType: constants.STRUCTURE_WALL, hits: 1000, pos: {x: 4, y: 5},
    isWalkable: false};
  scope.Game.objects.wall = wall;
  const room = new scope.Room('W3N3', [wall]);
  assert.equal(scope.helpers.getRoomWalls(room), scope.helpers.getRoomConstructedWalls(room));
  assert.deepEqual(Array.from(scope.helpers.getRoomWalls(room)), [wall]);
});

test('walkableRamparts matches per-rampart walkability and excludes walls or blocking structures', () => {
  const scope = roomStructuresScope();
  const makeStructure = (id, structureType, x, y, extra = {}) => {
    const structure = {id, structureType, pos: {x, y}, hits: 100, isWalkable: true, my: true, ...extra};
    scope.Game.objects[id] = structure;
    return structure;
  };
  const openRampart = makeStructure('open', constants.STRUCTURE_RAMPART, 10, 10);
  const blockedRampart = makeStructure('blocked', constants.STRUCTURE_RAMPART, 11, 10);
  const wallTileRampart = makeStructure('wallTile', constants.STRUCTURE_RAMPART, 12, 10);
  const tower = makeStructure('tower', constants.STRUCTURE_TOWER, 11, 10, {isWalkable: false});
  const room = new scope.Room('W2N2', [openRampart, blockedRampart, wallTileRampart, tower]);
  // Simulate wall terrain at (12, 10) only.
  scope.Game.map.getRoomTerrain = () => ({get: (x, y) => x === 12 && y === 10 ? constants.TERRAIN_MASK_WALL : 0});

  assert.deepEqual(Array.from(scope.helpers.getRoomWalkableRamparts(room), s => s.id), ['open']);
});

test('room and creep caches preserve object shape, cache empty results, and expire across ticks', () => {
  const runtime = createGameRuntime({Game: {time: 1}});
  const rooms = runtime.load('Room'), creeps = runtime.load('Creep');
  let finds = 0, hostiles = [];
  const room = Object.freeze({name: 'W1N1', find: () => {finds++; return hostiles;}});
  const keys = Reflect.ownKeys(room);
  assert.equal(rooms.getRoomHostiles(room), hostiles);
  assert.equal(rooms.getRoomHostiles(room), hostiles);
  assert.equal(finds, 1);
  assert.deepEqual(Reflect.ownKeys(room), keys);
  const body = [{type: 'work', boost: 'UH'}];
  const creep = Object.freeze({body});
  const boosts = creeps.getCreepBoosts(creep);
  assert.equal(creeps.getCreepBoosts(creep), boosts);
  body.push({type: 'attack', boost: 'KO'});
  assert.deepEqual(creeps.getCreepBoosts(creep), ['UH']);
  hostiles = [{owner: {username: 'enemy'}}];
  runtime.scope.Game.time++;
  assert.deepEqual(rooms.getRoomHostiles(room), hostiles);
  assert.equal(finds, 2);
  assert.deepEqual(creeps.getCreepBoosts(creep), ['UH', 'KO']);
  assert.deepEqual(Reflect.ownKeys(creep), ['body']);
});

test('cached undefined singletons resolve once per tick, separate room objects, and refresh expired IDs', () => {
  const scope = roomStructuresScope(), api = scope.helpers;
  let finds = 0, resolves = 0, objects = {};
  const room = Object.freeze({name: 'missing', find: () => {finds++; return [];}});
  scope.Game.getObjectById = id => {resolves++; return objects[id] || null;};
  assert.equal(api.getRoomFactory(room), undefined);
  assert.equal(api.getRoomFactory(room), undefined);
  assert.equal(finds, 1);
  const factory = {id: 'factory', structureType: constants.STRUCTURE_FACTORY};
  const populated = Object.freeze({name: 'home', find: () => {finds++; return [factory];}});
  // IDs can outlive the object returned by the engine.
  assert.equal(api.getRoomFactory(populated), undefined);
  assert.equal(api.getRoomFactory(populated), undefined);
  assert.equal(resolves, 1);
  objects.factory = factory;
  scope.Game.time++;
  assert.equal(api.getRoomFactory(populated), factory);
  assert.equal(resolves, 2);
  const replacement = Object.freeze({name: 'home', find: () => {throw new Error('IDs should be reused');}});
  assert.equal(api.getRoomFactory(replacement), factory);
  assert.equal(resolves, 3);
  scope.Game.time += 51;
  delete objects.factory;
  assert.equal(api.getRoomFactory(populated), undefined);
  assert.equal(finds, 3);
});

test('terminal sends preserve receiver and return code, mark arrivals, and reset without instance writes', () => {
  const scope = {Game: {time: 1, rooms: {}}};
  const runtime = createGameRuntime(scope), api = runtime.load('Structures');
  let response = -6;
  const calls = [];
  const sender = Object.freeze({cooldown: 0, send(...args) {calls.push([this, ...args]); return response;}});
  const receiver = Object.freeze({cooldown: 0});
  scope.Game.rooms.target = {terminal: receiver};
  assert.equal(api.sendTerminalResources(sender, 'energy', 10, 'target', 'note'), -6);
  assert.equal(api.isTerminalReady(sender), true);
  assert.equal(api.hasTerminalReceived(receiver), undefined);
  response = 0;
  assert.equal(api.sendTerminalResources(sender, 'energy', 10, 'target', 'note'), 0);
  assert.deepEqual(calls[1], [sender, 'energy', 10, 'target', 'note']);
  assert.equal(api.isTerminalReady(sender), false);
  assert.equal(api.hasTerminalReceived(receiver), true);
  scope.Game.time++;
  assert.equal(api.isTerminalReady(sender), true);
  assert.equal(api.hasTerminalReceived(receiver), undefined);
  assert.equal(api.sendTerminalResources(sender, 'energy', 1, 'invisible'), 0);
});

test('reference, targeting, serialization, and store helpers support engine and application objects', () => {
  const runtime = createGameRuntime({Overmind: {cache: {targets: {id: ['creep']}}}});
  const api = runtime.load('RoomObject'), structures = runtime.load('Structures');
  const pos = {x: 1, y: 2, roomName: 'W1N1'};
  const object = Object.freeze({id: 'id', name: 'name', pos});
  assert.equal(api.getRoomObjectRef(object), 'id');
  assert.equal(api.getRoomObjectRef({name: 'flag', pos}), 'flag');
  assert.equal(api.getRoomObjectRef({pos}), '');
  assert.equal(api.getRoomObjectRef({ref: 'wrapper', id: 'id', pos}), 'wrapper');
  assert.deepEqual(api.getTargetedBy(object), ['creep']);
  assert.deepEqual(api.getTargetedBy({ref: 'wrapper', pos, targetedBy: ['other']}), ['other']);
  assert.deepEqual(api.roomObjectSerialize(object), {pos, ref: 'id'});
  assert.notEqual(api.roomObjectSerialize(object).pos, pos);
  assert.deepEqual(structures.getStoreContents({energy: 10, H: 2}), [['energy', 10], ['H', 2]]);
  assert.equal(structures.isStructureFull({structureType: 'container', store: {energy: 7, H: 3}, storeCapacity: 10}), true);
  assert.equal(structures.isStructureEmpty({structureType: 'spawn', energy: 0}), true);
});

test('visual road state is external, isolated by visual instance, and reset each tick', () => {
  const runtime = createGameRuntime({Game: {time: 1}}), api = runtime.load('RoomVisual');
  const lines = [];
  const visual = Object.freeze({circle() {}, line(...args) {lines.push(args);}});
  const other = Object.freeze({line() {throw new Error('roads leaked across instances');}});
  api.roomVisualStructure(visual, 10, 10, 'road');
  api.roomVisualStructure(visual, 11, 10, 'road');
  api.roomVisualConnectRoads(visual);
  assert.equal(lines.length, 1);
  api.roomVisualConnectRoads(other);
  runtime.scope.Game.time++;
  api.roomVisualConnectRoads(visual);
  assert.equal(lines.length, 1);
  assert.deepEqual(Reflect.ownKeys(visual), ['circle', 'line']);
});

test('game helper modules contain no prototype installation', () => {
  for (const file of fs.readdirSync('src/game')) {
    const source = fs.readFileSync(`src/game/${file}`, 'utf8');
    assert.doesNotMatch(source, /Object\.definePropert(?:y|ies)|Reflect\.defineProperty|\.prototype\s*[.\[]/);
  }
  assert.doesNotMatch(fs.readFileSync('src/main.ts', 'utf8'), /prototypes\//);
});

test('task serialization and Zerg task assignment keep real target IDs without a ref getter', () => {
  const ts = require('typescript');
  const runtime = createGameRuntime({Game: {time: 42}, Overmind: {cache: {targets: {old: ['worker', 'other']}}}});
  const {getRoomObjectRef} = runtime.load('RoomObject');
  const {remove} = require('./helpers/native-helpers.cjs');
  const members = (file, className, select) => {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    return source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className).members
      .filter(select).map(n => n.getText(source)).join('\n');
  };
  const target = Object.freeze({id: 'new', pos: {x: 3, y: 4, roomName: 'W1N1'}});
  const source = `
    class Task {${members('src/tasks/Task.ts', 'Task', n => ts.isConstructorDeclaration(n)
      || ts.isGetAccessorDeclaration(n) && ['target', 'targetManifest'].includes(n.name.text))}}
    class Zerg {${members('src/zerg/Zerg.ts', 'Zerg', n => ts.isSetAccessorDeclaration(n) && n.name.text === 'task')}}
    exports.Task = Task; exports.Zerg = Zerg;
  `;
  const output = {};
  new Function('exports', 'Game', 'Overmind', 'getRoomObjectRef', 'remove', 'deref',
    ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2024}}).outputText)(
      output, runtime.scope.Game, runtime.scope.Overmind, getRoomObjectRef, remove, ref => ref === 'new' ? target : null);
  const task = new output.Task('build', target);
  assert.deepEqual(task._target, {ref: 'new', _pos: target.pos});
  assert.equal(task.target, target);
  assert.deepEqual(task.targetManifest, [target]);
  const worker = new output.Zerg();
  worker.name = 'worker'; worker.memory = {task: {_target: {ref: 'old'}}};
  worker.task = {target, proto: {_target: {ref: 'new'}}};
  assert.deepEqual(runtime.scope.Overmind.cache.targets, {old: ['other'], new: ['worker']});
  assert.deepEqual(worker.memory.task._target, {ref: 'new'});
});
