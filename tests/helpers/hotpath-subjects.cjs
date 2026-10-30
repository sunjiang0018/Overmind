const {createGameRuntime} = require('./game-runtime.cjs');
const {installGameFixtures} = require('./game-fixtures.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const constants = require('@screeps/common/lib/constants');
const lodash = require('./screeps-lodash.cjs');
const creepUtils = require('./creep-utils.cjs');
const native = require('./native-helpers.cjs');

function compile(source, scope = {}) {
  const output = {};
  const code = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024},
  }).outputText;
  new Function('exports', ...Object.keys(scope), code)(output, ...Object.values(scope));
  return output;
}

function loadClass(file, name, members, scope) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === name);
  assert.ok(cls, `${file} must declare ${name}`);
  const selected = cls.members.filter(n => n.name && members.includes(n.name.getText(source)));
  assert.equal(selected.length, members.length);
  installGameFixtures(scope);
  return compile(`exports.Subject = class {${selected.map(n => n.getText(source)).join('\n')}};`, scope).Subject;
}

function createSubjects(overrides = {}) {
  const BOOST_PARTS = Object.fromEntries(Object.entries(constants.BOOSTS).flatMap(([part, boosts]) =>
    Object.keys(boosts).map(boost => [boost, part])));
  const scope = {...constants, BOOST_PARTS, _: lodash, ...creepUtils, ...native, ...overrides};
  const source = ts.createSourceFile('setup.ts', fs.readFileSync('src/creepSetups/CreepSetup.ts', 'utf8'),
    ts.ScriptTarget.Latest, true);
  const cost = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'bodyCost');
  const bodyCost = compile(cost.getText(source), scope).bodyCost;
  const weight = compile(fs.readFileSync('src/movement/helpers.ts', 'utf8'), scope).getCreepWeightInfo;
  const Chamber = loadClass('src/hiveClusters/evolutionChamber.ts', 'EvolutionChamber', ['requiredBoostAmount'], scope);
  const Intel = loadClass('src/intel/CombatIntel.ts', 'CombatIntel', ['uniqueBoosts'], scope);
  class Creep {}
  class RoomPosition {
    constructor(x, y, roomName = 'W1N1') {Object.assign(this, {x, y, roomName});}
    getRangeTo(pos) {return Math.max(Math.abs(pos.x - this.x), Math.abs(pos.y - this.y));}
  }
  const runtime = createGameRuntime({...scope, Creep, RoomPosition, PERMACACHE: {}, Game: {time: 1}});
  const creeps = runtime.load('Creep'), positions = runtime.load('RoomPosition');
  return {bodyCost, weight, requiredBoostAmount: Chamber.requiredBoostAmount, uniqueBoosts: Intel.uniqueBoosts,
    speed: body => creeps.getCreepApproxMoveSpeed({body}), Creep, RoomPosition, scope: runtime.scope, creeps, positions};
}

module.exports = {createSubjects, loadClass, constants, lodash, creepUtils};
