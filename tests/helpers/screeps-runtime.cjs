const fs = require('node:fs');
const vm = require('node:vm');
const constants = require('@screeps/common/lib/constants');
const lodash = require('./screeps-lodash.cjs');

// A deliberately small world: real game constants and Lodash 3, no network or owned rooms.
// Run the complete bundle so circular imports, decorators and game helper initialization are exercised.
function loadBundle(file, {bucket = 9999, training = false} = {}) {
  const logs = [];
  const calls = {pixels: 0, segments: []};
  const memory = training ? {reinforcementLearning: {enabled: true}} : {};
  const context = vm.createContext({
    ...constants,
    _: lodash.runInContext(),
    console: {log: (...args) => logs.push(args.join(' '))},
    module: {exports: {}},
    Memory: memory,
    RawMemory: {
      _parsed: memory, segments: {},
      get: () => JSON.stringify(context.Memory),
      setActiveSegments: ids => calls.segments.push(Array.from(ids)),
      setPublicSegments() {}, setDefaultPublicSegment() {}, setActiveForeignSegment() {},
    },
    Game: {
      time: 1001, rooms: {}, creeps: {}, powerCreeps: {}, spawns: {}, flags: {},
      structures: {}, constructionSites: {}, resources: {},
      gcl: {level: 1, progress: 0, progressTotal: 1000}, gpl: {level: 0},
      shard: {name: 'shard3'},
      cpu: {bucket, limit: 20, tickLimit: 500, getUsed: () => 1,
        getHeapStatistics: () => ({}), generatePixel: () => {calls.pixels++; return constants.OK;}},
      map: {getRoomLinearDistance: () => 1, describeExits: () => ({}),
        getRoomTerrain: () => ({get: () => 0}), getRoomStatus: () => ({status: 'normal', timestamp: null})},
      market: {credits: 0, orders: {}, incomingTransactions: [], outgoingTransactions: [],
        deal: () => constants.OK, getAllOrders: () => [], getHistory: () => [],
        calcTransactionCost: () => 0, cancelOrder: () => constants.OK},
      getObjectById: () => null, notify() {},
    },
    // A Screeps module must be self-contained: an external require is a build failure.
    require: name => {throw new Error(`Unexpected external module: ${name}`);},
  });
  vm.runInContext(`
    globalThis.global = globalThis;
    globalThis.exports = module.exports;
    class RoomObject {}
    globalThis.RoomObject = RoomObject;
    class Structure extends RoomObject {isActive() {return true;}}
    globalThis.Structure = Structure;
    globalThis.OwnedStructure = class OwnedStructure extends Structure {};
    for (const name of ['Creep', 'PowerCreep', 'Flag', 'ConstructionSite', 'Source', 'Mineral',
                        'Deposit', 'Tombstone', 'Ruin', 'Nuke', 'Resource']) {
      globalThis[name] = class extends RoomObject {};
    }
    for (const name of ['StructureSpawn', 'StructureExtension', 'StructureRoad', 'StructureWall',
                        'StructureRampart', 'StructureKeeperLair', 'StructurePortal', 'StructureLink',
                        'StructureTower', 'StructureLab', 'StructureContainer', 'StructurePowerBank',
                        'StructureObserver', 'StructurePowerSpawn', 'StructureExtractor', 'StructureNuker',
                        'StructureFactory', 'StructureInvaderCore', 'StructureTerminal',
                        'StructureController', 'StructureStorage']) {
      globalThis[name] = class extends OwnedStructure {};
    }
    globalThis.Room = class Room {
      static Terrain = class {get() {return 0;}};
      static serializePath() {return '';}
      static deserializePath() {return [];}
    };
    globalThis.RoomPosition = class RoomPosition {
      constructor(x, y, roomName) {Object.assign(this, {x, y, roomName});}
    };
    globalThis.RoomVisual = class RoomVisual {};
    globalThis.Store = class Store {};
    globalThis.PathFinder = {CostMatrix: class CostMatrix {
      constructor() {this.data = new Uint8Array(2500);}
      set(x, y, value) {this.data[y * 50 + x] = value;}
      get(x, y) {return this.data[y * 50 + x];}
      clone() {return new PathFinder.CostMatrix();}
      serialize() {return Array.from(this.data);}
    }};
  `, context);
  const script = new vm.Script(fs.readFileSync(file, 'utf8'), {filename: file});
  script.runInContext(context, {timeout: 10000});
  return {context, calls, logs, tick() {
    vm.runInContext('module.exports.loop()', context, {timeout: 10000});
    context.Game.time++;
  }};
}

module.exports = {loadBundle};
