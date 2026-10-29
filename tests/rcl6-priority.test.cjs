const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
function method(file, className, name) {
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text===className);
  return cls.members.find(n=>n.name&&n.name.getText(source)===name).getText(source);
}
function setup() {
  const room={name:'E58S42',controller:{level:4,my:true},dangerousHostiles:[],find:()=>[]};
  const context={exports:{},Game:{shard:{name:'shard3'},rooms:{E58S42:room}},FIND_NUKES:1,
    require:name=>name.includes('~settings')?{PEACETIME_BARRIER_HITS:5000}:{},console,ERR_INVALID_TARGET:-7};
  vm.runInNewContext(compile(fs.readFileSync('src/roomPlanner/roomOverrides.ts','utf8')),context);
  const api=context.exports;
  Object.assign(context,api);
  return {context,api,room};
}
test('rush policy ends at RCL6 and is scoped to this room and shard',()=>{
  const {context,api}=setup();
  assert.equal(api.prioritizesRCL6('E58S42',4),true);
  assert.equal(api.prioritizesRCL6('E58S42',5),true);
  assert.equal(api.prioritizesRCL6('E58S42',6),false);
  assert.equal(api.prioritizesRCL6('E59S42',4),false);
  context.Game.shard.name='shard2';assert.equal(api.prioritizesRCL6('E58S42',4),false);
});
test('old fortify tasks stop spending at 5k across RCLs; attacks and nukes lift the upkeep cap',()=>{
  const {context,room}=setup();
  vm.runInNewContext(compile('class Fortify {'+['isValidTarget','work'].map(n=>method('src/tasks/instances/fortify.ts','TaskFortify',n)).join('\n')+'};exports.Fortify=Fortify;'),context);
  const task=new context.exports.Fortify();let repairs=0;
  Object.assign(task,{data:{},target:{pos:{roomName:'E58S42',x:34,y:36},hits:5000,hitsMax:3000000},creep:{repair(){repairs++;return 0;}}});
  assert.equal(task.isValidTarget(),false);assert.equal(task.work(),-7);assert.equal(repairs,0);
  task.target.hits=2000;assert.equal(task.work(),0);assert.equal(repairs,1);
  task.target.hits=50000;room.dangerousHostiles=[{}];assert.equal(task.isValidTarget(),true);
  room.dangerousHostiles=[];room.find=()=>[{}];assert.equal(task.isValidTarget(),true);
  room.find=()=>[];room.controller.level=6;assert.equal(task.isValidTarget(),false);
  room.controller.level=8;assert.equal(task.isValidTarget(),false);
  task.data.hitsMax=3000;task.target.hits=3000;assert.equal(task.isValidTarget(),false);
});
test('most workers upgrade ahead of building; one worker handles maintenance',()=>{
  const {context}=setup();
  Object.assign(context,{DEFCON:{safe:0},CONTROLLER_DOWNGRADE:{4:50000},ColonyStage:{Larva:0}});
  vm.runInNewContext(compile('class Workers {'+method('src/overlords/core/worker.ts','WorkerOverlord','handleWorker')+'};exports.Workers=Workers;'),context);
  const obj=new context.exports.Workers();const maint={carry:{energy:100}},worker={carry:{energy:100}};let action;
  Object.assign(obj,{colony:{name:'E58S42',level:4,defcon:0,controller:{ticksToDowngrade:50000,progress:0,progressTotal:45000}},
    workers:[maint,worker],repairStructures:[],criticalBarriers:[],constructionSites:[{}],nukeDefenseRamparts:[],
    upgradeActions(){action='upgrade';return true;},buildActions(){action='build';return true;}});
  obj.handleWorker(worker);assert.equal(action,'upgrade');
  obj.handleWorker(maint);assert.equal(action,'build');
  obj.criticalBarriers=[{}];obj.fortifyActions=()=>{action='emergencyRepair';return true;};
  obj.handleWorker(worker);assert.equal(action,'emergencyRepair');
});
test('upgrader recruitment uses the reduced reserve and returns to normal at RCL6',()=>{
  const {context}=setup();let requests=0;
  Object.assign(context,{Setups:{upgraders:{default:{getBodyPotential:()=>9}}},UpgradeSite:{settings:{energyBuffer:100000}},WORK:'work'});
  vm.runInNewContext(compile('class Upgraders {'+method('src/overlords/core/upgrader.ts','UpgradingOverlord','init')+'};exports.Upgraders=Upgraders;'),context);
  const obj=new context.exports.Upgraders();
  Object.assign(obj,{colony:{name:'E58S42',level:4,assets:{energy:2001}},upgradeSite:{controller:{ticksToDowngrade:50000},upgradePowerNeeded:9},wishlist(n){requests+=n;}});
  obj.init();assert.equal(requests,1);
  obj.colony.assets.energy=2000;obj.init();assert.equal(requests,1);
  obj.colony.level=6;obj.colony.assets.energy=5000;obj.init();assert.equal(requests,1);
});
test('signature accepts unbranded text, retaining the length check',()=>{
  const context={exports:{},Memory:{settings:{}},DEFAULT_OVERMIND_SIGNATURE:'星海为途，长路有光'};
  vm.runInNewContext(compile('class Console {'+method('src/console/Console.ts','OvermindConsole','setSignature')+'};exports.Console=Console;'),context);
  context.exports.Console.setSignature('星海为途，长路有光');
  assert.equal(context.Memory.settings.signature,'星海为途，长路有光');
  context.exports.Console.setSignature('A quiet colony');assert.equal(context.Memory.settings.signature,'A quiet colony');
  assert.throws(()=>context.exports.Console.setSignature('x'.repeat(101)),/over 100/);
});
test('an old owned signature is replaced when configured text changes',()=>{
  const file='src/prototypes/Structures.ts';const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const statement=source.statements.find(n=>n.getText(source).startsWith("Object.defineProperty(StructureController.prototype, 'signedByMe'"));
  const context={StructureController:class {},MY_USERNAME:'harland',Memory:{settings:{signature:'星海为途，长路有光'}},Game:{time:100}};
  vm.runInNewContext(compile(statement.getText(source)),context);
  const controller=new context.StructureController();controller.sign={username:'harland',text:'«ᴏᴠᴇʀᴍɪɴᴅ»',time:90};
  assert.equal(controller.signedByMe,false);controller.sign.text=context.Memory.settings.signature;assert.equal(controller.signedByMe,true);
});
