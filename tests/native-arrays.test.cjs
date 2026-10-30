const {createGameRuntime} = require('./helpers/game-runtime.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const creepUtils = require('./helpers/creep-utils.cjs');
const {installNative} = require('./helpers/native-runtime.cjs');

// Mock the remaining Lodash helpers; array traversal runs through the native methods.
const collections = {
  map: (xs, fn) => (xs || []).map(fn), // The nullable spawn-group memory mapping is intentionally retained.
  compact: xs => xs.filter(Boolean),
  unique: xs => [...new Set(xs)],
  countBy: (xs, fn) => xs.reduce((counts, value) => {
    const key = fn(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {}),
  min: xs => xs.length ? Math.min(...xs) : Infinity,
  max: xs => xs.length ? Math.max(...xs) : -Infinity,
  defaults: (value, defaults) => {
    for (const key of Object.keys(defaults)) {
      if (value[key] === undefined) value[key] = defaults[key];
    }
    return value;
  },
};

function evaluate(code, context) {
  context.exports ||= {};
  installNative(context);
  context._ ||= collections;
  context.require ||= () => creepUtils;
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2017,
      experimentalDecorators: true,
    },
  }).outputText, context);
  return context.exports;
}

function loadClass(file, name, members, context) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === name);
  const code = cls.members.filter(n => n.name && members.includes(n.name.getText(source)))
    .map(n => n.getText(source)).join('\n');
  return evaluate(`class Subject {${code}}; exports.Subject = Subject;`, context).Subject;
}

const plain = value => JSON.parse(JSON.stringify(value));

test('formation strength counts every body and preserves empty and damaged-body behavior', () => {
  const {calculateFormationStrength, calculateBodyPotential} = evaluate(
    fs.readFileSync('src/utilities/creepUtils.ts', 'utf8'), {});
  const empty = {move: 0, work: 0, carry: 0, attack: 0, ranged_attack: 0, tough: 0, heal: 0, claim: 0};
  assert.deepEqual(plain(calculateFormationStrength([])), empty);
  const bodies = [
    [{type: 'move', hits: 100}, {type: 'attack', hits: 0, boost: 'XUH2O'}],
    [{type: 'attack', hits: 100}, {type: 'heal', hits: 100}],
    [],
  ];
  assert.deepEqual(plain(calculateBodyPotential(bodies[0])), {...empty, move: 1, attack: 1});
  assert.deepEqual(plain(calculateFormationStrength(bodies.map(body => ({body})))),
    {...empty, move: 1, attack: 2, heal: 1});
});

test('movement weight preserves loaded carry, ignored carry analysis, and boosted move parts', () => {
  const context = {MOVE: 'move', CARRY: 'carry', BOOSTS: {move: {ZO: {fatigue: 2}}}};
  const {getCreepWeightInfo} = evaluate(fs.readFileSync('src/movement/helpers.ts', 'utf8'), context);
  const creep = {body: [{type: 'move', boost: 'ZO'}, {type: 'carry'}, {type: 'carry'}, {type: 'work'}],
    store: {getUsedCapacity: () => 25, getCapacity: () => 100}};
  assert.deepEqual(plain(getCreepWeightInfo(creep)), {move: 2, carry: 2, weighted: 2});
  assert.deepEqual(plain(getCreepWeightInfo(creep, false)), {move: 2, weighted: 3});
});

test('creep boost list preserves first occurrence order and cached identity', () => {
  const creepUtils = evaluate(fs.readFileSync('src/utilities/creepUtils.ts', 'utf8'), {});
  const context = {Creep: class {}, PERMACACHE: {}, require: name => {
    assert.equal(name, '../utilities/creepUtils');
    return creepUtils;
  }};
  const helpers = createGameRuntime(context).load('Creep');
  const creep = new context.Creep();
  creep.body = [{boost: 'UH'}, {}, {boost: 'UH'}, {boost: 'KO'}];
  assert.deepEqual(Array.from(helpers.getCreepBoosts(creep)), ['UH', 'KO']);
  assert.equal(helpers.getCreepBoosts(creep), helpers.getCreepBoosts(creep));
  const empty = new context.Creep(); empty.body = [];
  assert.deepEqual(Array.from(helpers.getCreepBoosts(empty)), []);
});

test('body potential preserves spawn-group capacity, missing colonies, and empty memory behavior', () => {
  const context = {Overmind: {colonies: {
    small: {room: {energyCapacityAvailable: 300}}, large: {room: {energyCapacityAvailable: 800}},
  }}};
  const Setup = loadClass('src/creepSetups/CreepSetup.ts', 'CreepSetup', ['getBodyPotential'], context);
  const subject = new Setup(), capacities = [];
  subject.generateBody = capacity => {capacities.push(capacity); return capacity > 0 ? ['move', 'work', 'work'] : [];};
  const colony = {room: {energyCapacityAvailable: 300},
    spawnGroup: {memory: {colonies: ['small', 'gone', 'large']}}};
  assert.equal(subject.getBodyPotential('work', colony), 2);
  assert.deepEqual(capacities, [800]);
  colony.spawnGroup.memory.colonies = undefined;
  assert.equal(subject.getBodyPotential('work', colony), 0);
  assert.equal(capacities[1], -Infinity);
});

test('room threat filters preserve order, ownership rules, and cached array identity', () => {
  const context = {
    Room: class {}, ATTACK: 'attack', RANGED_ATTACK: 'ranged_attack', WORK: 'work',
    require: () => ({isAlly: () => false, MY_USERNAME: 'me'}),
  };
  const helpers = createGameRuntime(context, {'./RoomStructures': {getRoomKeeperLairs: room => room.keeperLairs}}).load('Room');
  const creep = (name, owner, parts) => ({name, owner: {username: owner},
    isPlayer: !['Invader', 'Source Keeper', 'Screeps'].includes(owner),
    body: parts.map(type => ({type, hits: 100}))});
  const harmless = creep('harmless', 'enemy', []);
  const worker = creep('worker', 'enemy', ['work']);
  const invader = creep('invader', 'Invader', ['attack']);
  const ranger = creep('ranger', 'enemy', ['ranged_attack']);
  for (const owned of [true, false]) {
    const room = new context.Room();
    room.controller = {my: owned};
    const hostiles = [harmless, worker, invader, ranger];
    room.find = () => hostiles;
    room.keeperLairs = [{ticksToSpawn: 0}, {ticksToSpawn: 10}, {ticksToSpawn: 11}];
    assert.deepEqual(Array.from(helpers.getRoomPlayerHostiles(room)), [harmless, worker, ranger]);
    assert.deepEqual(Array.from(helpers.getRoomInvaders(room)), [invader]);
    assert.deepEqual(Array.from(helpers.getRoomDangerousHostiles(room)), owned ? [worker, invader, ranger] : [invader, ranger]);
    assert.deepEqual(Array.from(helpers.getRoomDangerousPlayerHostiles(room)), owned ? [worker, ranger] : [ranger]);
    assert.equal(helpers.getRoomDangerousHostiles(room), helpers.getRoomDangerousHostiles(room));
    assert.deepEqual(Array.from(helpers.getRoomFleeDefaults(room)), [...helpers.getRoomDangerousHostiles(room), room.keeperLairs[1]]);
    assert.deepEqual(room.find(), [harmless, worker, invader, ranger]);
  }
  const empty = new context.Room();
  empty.find = () => [];
  assert.deepEqual(Array.from(helpers.getRoomDangerousHostiles(empty)), []);
});

test('creep ownership predicate is isPlayer and excludes every NPC owner', () => {
  const context = {Creep: class {}, PERMACACHE: {}, require: () => creepUtils};
  const helpers = createGameRuntime(context).load('Creep');
  assert.equal('isHuman' in context.Creep.prototype, false);
  const creepFor = owner => {
    const creep = new context.Creep();
    creep.owner = {username: owner};
    return creep;
  };
  assert.equal(helpers.isPlayerCreep(creepFor('player')), true);
  assert.equal(helpers.isPlayerCreep(creepFor('Invader')), false);
  assert.equal(helpers.isPlayerCreep(creepFor('Source Keeper')), false);
  assert.equal(helpers.isPlayerCreep(creepFor('Screeps')), false);
});

function positionContext() {
  const context = {
    RoomPosition: class {
      constructor(x, y, roomName) {Object.assign(this, {x, y, roomName});}
    },
    LOOK_STRUCTURES: 'structures', LOOK_CREEPS: 'creeps',
    STRUCTURE_ROAD: 'road', TERRAIN_MASK_WALL: 1,
    PERMACACHE: {},
    Game: {map: {getRoomTerrain: () => ({get: () => 0})}},
    require: () => ({}),
  };
  context.helpers = createGameRuntime(context).load('RoomPosition');
  context.RoomPosition.prototype.lookFor = () => [];
  return context;
}

test('position lookups keep first-match, no-match, occupancy, and neighbor ordering', () => {
  const context = positionContext(), pos = new context.RoomPosition();
  const first = {structureType: 'road', isWalkable: true};
  const second = {structureType: 'road', isWalkable: true};
  let structures = [first, second], creeps = [];
  pos.roomName = 'E1S1'; context.Game.rooms = {E1S1: {}};
  pos.lookFor = type => type === 'structures' ? structures : creeps;
  assert.equal(context.helpers.roomPositionLookForStructure(pos, 'road'), first);
  assert.equal(context.helpers.roomPositionLookForStructure(pos, 'spawn'), undefined);
  assert.equal(context.helpers.roomPositionIsWalkable(pos), true);
  structures.push({structureType: 'spawn', isWalkable: false});
  assert.equal(context.helpers.roomPositionIsWalkable(pos), false);
  structures = []; creeps = [{}];
  assert.equal(context.helpers.roomPositionIsWalkable(pos), false);
  assert.equal(context.helpers.roomPositionIsWalkable(pos, true), true);
  // Invisible rooms use terrain-only fallback and keep the original x-major neighbor order.
  context.Game.rooms = {};
  pos.x = 10; pos.y = 10;
  context.Game.map.getRoomTerrain = () => ({get: (x, y) => x === 9 && y === 10 ? 1 : 0});
  assert.deepEqual(Array.from(context.helpers.roomPositionAvailableNeighbors(pos, true), p => [p.x, p.y]),
    [[9, 9], [9, 11], [10, 9], [10, 11], [11, 9], [11, 10], [11, 11]]);
});

test('availableNeighbors uses one area query, skips blockers, and keeps neighbor order', () => {
  const context = positionContext(), pos = new context.RoomPosition(10, 10, 'E1S1');
  const calls = [];
  const structures = [{x: 11, y: 10, structure: {structureType: 'spawn'}}];
  const creeps = [{x: 10, y: 11, creep: {}}];
  context.Game.rooms = {E1S1: {lookForAtArea: (type, top, left, bottom, right, asArray) => {
    calls.push({type, top, left, bottom, right, asArray});
    return type === 'structures' ? structures : creeps;
  }}};
  assert.deepEqual(Array.from(context.helpers.roomPositionAvailableNeighbors(pos, false), p => [p.x, p.y]),
    [[9, 9], [9, 10], [9, 11], [10, 9], [11, 9], [11, 11]]);
  assert.equal(calls.length, 2);
  calls.length = 0;
  assert.deepEqual(Array.from(context.helpers.roomPositionAvailableNeighbors(pos, true), p => [p.x, p.y]),
    [[9, 9], [9, 10], [9, 11], [10, 9], [10, 11], [11, 9], [11, 11]]);
  assert.equal(calls.length, 1);
});

test('closest-by-range-then-path preserves all distance ties and the empty-list fallback', () => {
  const context = positionContext(), {RoomPosition} = context, pos = new RoomPosition();
  const near = {range: 2}, farther = {range: 3}, tied = {range: 2};
  pos.getRangeTo = obj => obj.range;
  pos.findClosestByPath = xs => {assert.deepEqual(Array.from(xs), [near, tied]); return tied;};
  assert.equal(context.helpers.roomPositionFindClosestByRangeThenPath(pos, [near, farther, tied]), tied);
  pos.findClosestByRange = xs => xs[0];
  assert.equal(context.helpers.roomPositionFindClosestByRangeThenPath(pos, [{range: 5}]).range, 5);
  assert.equal(context.helpers.roomPositionFindClosestByRangeThenPath(pos, []), undefined);
});

test('cached structure refresh removes missing objects in order and refreshes only once per tick', () => {
  const objects = {a: {id: 'a'}, b: {id: 'b'}}, lookedUp = [];
  const context = {
    CACHE_TIMEOUT: 50, getCacheExpiration: timeout => context.Game.time + timeout,
    Game: {time: 1, getObjectById: id => {lookedUp.push(id); return objects[id] || null;}},
    _cache: {structures: {}, expiration: {}, accessed: {}},
  };
  const Cache = loadClass('src/caching/GlobalCache.ts', '$', ['structures', 'refresh'], context);
  let builds = 0;
  const callback = () => {builds++; return [{id: 'b'}, {id: 'gone'}, {id: 'a'}];};
  Cache.structures({ref: 'room'}, 'links', callback);
  context.Game.time++;
  const refreshed = Cache.structures({ref: 'room'}, 'links', callback);
  assert.deepEqual(Array.from(refreshed), [objects.b, objects.a]);
  assert.deepEqual(lookedUp, ['b', 'gone', 'a']);
  assert.equal(Cache.structures({ref: 'room'}, 'links', callback), refreshed);
  assert.equal(lookedUp.length, 3);
  const thing = {links: [{id: 'gone'}, {id: 'a'}], target: {id: 'b'}, missing: undefined};
  Cache.refresh(thing, 'links', 'target', 'missing');
  assert.deepEqual(Array.from(thing.links), [objects.a]);
  assert.equal(thing.target, objects.b);
  assert.equal(thing.missing, undefined);
  context.Game.time = 100;
  Cache.structures({ref: 'room'}, 'links', callback);
  assert.equal(builds, 2);
});

function pathingContext() {
  const calls = [], matrix = {};
  const context = {Game: {rooms: {}}, normalizePos: obj => obj.pos || obj,
    pathOptsToMatrixAndVolatileOpts: () => [{}, {}],
    MatrixLib: {getMatrix: () => matrix},
    PathFinder: {search: (origin, goals, options) => {calls.push({origin, goals, options}); return {path: []};}}};
  const Pathing = loadClass('src/movement/Pathing.ts', 'Pathing',
    ['findKitingPath', 'findFleePath', 'roomCallback'], context);
  context.Pathing = Pathing; Pathing.shouldAvoid = () => false;
  return {Pathing, calls, matrix};
}

test('flee and kiting paths preserve goal order, positions, defaults, and empty goals', () => {
  const {Pathing, calls} = pathingContext();
  const origin = {roomName: 'E1S1'}, first = {x: 10}, second = {x: 20};
  const threats = [{pos: first}, second];
  Pathing.findKitingPath(origin, threats);
  Pathing.findFleePath(origin, threats);
  Pathing.findFleePath(origin, threats, {terrainCosts: {plainCost: 2, swampCost: 10}});
  Pathing.findKitingPath(origin, []);
  assert.deepEqual(plain(calls[0].goals), [{pos: first, range: 5}, {pos: second, range: 5}]);
  assert.deepEqual(plain(calls[1].goals), [{pos: first, range: 10}, {pos: second, range: 10}]);
  assert.equal(calls[2].goals[0].range, 20);
  assert.deepEqual(Array.from(calls[3].goals), []);
  assert.equal(calls[0].goals[0].pos, first);
  assert.equal(calls[0].options.flee, true);
  assert.deepEqual(threats, [{pos: first}, second]);
});

test('route restrictions preserve endpoint exceptions and empty or absent route behavior', () => {
  const {Pathing, matrix} = pathingContext();
  const origin = {roomName: 'origin'}, destination = {roomName: 'destination'};
  assert.equal(Pathing.roomCallback('other', origin, destination, [], {}), false);
  assert.equal(Pathing.roomCallback('other', origin, destination, undefined, {}), matrix);
  assert.equal(Pathing.roomCallback('other', origin, destination, [{room: 'other'}], {}), matrix);
  assert.equal(Pathing.roomCallback('origin', origin, destination, [], {}), matrix);
  assert.equal(Pathing.roomCallback('destination', origin, destination, [], {}), matrix);
});

test('idle creep assignment preserves existing Zerg instances, order, and refresh side effects', () => {
  const refreshed = [], created = [], assigned = {name: 'assigned', overlord: {}};
  const first = {name: 'first'}, second = {name: 'second'};
  const existing = {refresh: () => refreshed.push('first')};
  const context = {getOverlord: creep => creep.overlord, Overmind: {zerg: {first: existing}},
    Zerg: class {constructor(creep) {this.name = creep.name; created.push(creep);}
      refresh() {refreshed.push(this.name);}}};
  const Default = loadClass('src/overlords/core/default.ts', 'DefaultOverlord', ['init'], context);
  const subject = new Default(); subject.colony = {creeps: [assigned, first, second]};
  subject.init();
  assert.equal(subject.idleZerg[0], existing);
  assert.deepEqual(created, [second]);
  assert.deepEqual(refreshed, ['first', 'second']);
  assert.deepEqual(subject.colony.creeps, [assigned, first, second]);
  subject.colony.creeps = []; subject.init();
  assert.deepEqual(Array.from(subject.idleZerg), []);
});

test('paving manifest chooses the first eligible road and never repairs a road twice', () => {
  const context = {REPAIR_POWER: 100, Tasks: {repair: road => ({road}), chain: tasks => tasks}};
  const Roads = loadClass('src/logistics/RoadLogistics.ts', 'RoadLogistics', ['buildPavingManifest'], context);
  const pos = {getRangeTo: () => 1};
  const roads = [{id: 'full', hits: 100, hitsMax: 100, pos},
    {id: 'first', hits: 0, hitsMax: 100, pos}, {id: 'second', hits: 50, hitsMax: 100, pos}];
  const subject = new Roads(); subject.repairableRoads = () => roads;
  const tasks = subject.buildPavingManifest({carry: {energy: 2}}, {});
  assert.deepEqual(Array.from(tasks, task => task.road.id), ['first', 'second']);
  assert.equal(tasks[0].road, roads[1]);
  assert.deepEqual(Array.from(subject.buildPavingManifest({carry: {energy: 0}}, {})), []);
});
