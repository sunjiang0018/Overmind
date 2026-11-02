const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const constants = require('@screeps/common/lib/constants');
function methods(file, className, names, scope) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className);
  const body = names.map(name => cls.members.find(n => n.name?.getText(source) === name).getText(source)).join('\n');
  const code = ts.transpileModule(`class ${className} {${body}}`, {
    compilerOptions: {target: ts.ScriptTarget.ES2020},
  }).outputText;
  return new Function('scope', `with(scope){${code};return ${className};}`)(scope);
}
function pos(x, y, roomName = 'E58S42') {
  return {x, y, roomName,
    isEqualTo(p) {return this.x === p.x && this.y === p.y && this.roomName === p.roomName;},
    isNearTo(p) {return this.roomName === p.roomName && Math.max(Math.abs(this.x - p.x), Math.abs(this.y - p.y)) <= 1;},
  };
}
function movement() {
  const source = ts.createSourceFile('Movement.ts', fs.readFileSync('src/movement/Movement.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations])
    .find(n => n.name.getText(source) === 'MovePriorities');
  const Roles = {manager: 'manager', drone: 'drone', transport: 'transport', worker: 'worker'};
  const MovePriorities = new Function('Roles', `return (${declaration.initializer.getText(source)});`)(Roles);
  const Overmind = {overlords: {mine: {harvestPos: pos(27, 29)}}};
  const scope = {Roles, MovePriorities, Overmind, MEM: {OVERLORD: 'O'},
    normalizeAnyZerg: x => x, isPowerZerg: () => false, isAnyZerg: () => false};
  return {Movement: methods('src/movement/Movement.ts', 'Movement', ['getPushPriority', 'shouldPush'], scope), Overmind};
}
test('transport and worker traffic cannot displace an assigned miner, even asleep or with stale path data', () => {
  const {Movement} = movement();
  const miner = {my: true, pos: pos(27, 29), memory: {role: 'drone', O: 'mine', sleepUntil: 500, _go: {path: '227722'}}};
  for (const role of ['transport', 'worker', 'drone']) {
    assert.equal(Movement.shouldPush({memory: {role}}, miner), false);
  }
  miner.pos = pos(26, 30);
  assert.equal(Movement.shouldPush({memory: {role: 'transport'}}, miner), true);
  miner.pos = pos(27, 29, 'E58S43');
  assert.equal(Movement.shouldPush({memory: {role: 'transport'}}, miner), true);
  miner.memory.O = 'missing';
  assert.doesNotThrow(() => Movement.getPushPriority(miner));
});
test('zero movement priorities survive defaults for managers and explicit overrides', () => {
  const {Movement} = movement();
  assert.equal(Movement.getPushPriority({memory: {role: 'manager'}}), 0);
  assert.equal(Movement.getPushPriority({memory: {role: 'worker', _go: {priority: 0}}}), 0);
  assert.equal(Movement.getPushPriority({memory: {role: 'unknown'}}), 10);
});
test('paths avoid source containers without blocking access or overwriting impassable tiles', () => {
  class CostMatrix {
    constructor() {this.data = new Map();}
    set(x, y, value) {this.data.set(`${x},${y}`, value);}
    get(x, y) {return this.data.get(`${x},${y}`) || 0;}
  }
  const source = {pos: pos(28, 28)};
  const mining = {pos: pos(27, 29)}, hatchery = {pos: pos(27, 40)};
  const blocker = {pos: pos(27, 29), blocking: true};
  let structures = [];
  const scope = {...constants, PathFinder: {CostMatrix}, normalizePos: x => x.pos || x,
    getRoomRoads: () => [mining, hatchery], getRoomSources: () => [source],
    getRoomContainers: () => [mining, hatchery], getRoomStructures: () => structures,
    getRoomConstructionSites: () => [], getRoomHostileConstructionSites: () => [], getRoomPortals: () => [],
    isStructureWalkable: s => !s.blocking, isConstructionSiteWalkable: () => true, isAlly: () => false};
  const MatrixLib = methods('src/matrix/MatrixLib.ts', 'MatrixLib', ['generateCostMatrixForRoom', 'block'], scope);
  const opts = {terrainCosts: {plainCost: 2, swampCost: 10}, roadCost: 1, obstacles: '', swarmWidth: 1, swarmHeight: 1};
  let matrix = MatrixLib.generateCostMatrixForRoom({name: 'E58S42'}, opts);
  assert.ok(matrix.get(27, 29) > matrix.get(27, 40));
  assert.ok(matrix.get(27, 29) < 255, 'miner must still be able to reach its station');
  assert.equal(matrix.get(27, 40), 1, 'hatchery supply roads remain unrestricted');
  structures = [blocker];
  matrix = MatrixLib.generateCostMatrixForRoom({name: 'E58S42'}, opts);
  assert.equal(matrix.get(27, 29), 255);
});
