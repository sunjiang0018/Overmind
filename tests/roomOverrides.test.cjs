const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const fixture = require('./fixtures/E58S42.json');
const {installNative} = require('./helpers/native-runtime.cjs');
const plan = JSON.parse(fs.readFileSync('src/roomPlanner/layouts/E58S42.ts', 'utf8').split(' = ')[1].trim().slice(0, -1));
function setup(shard = 'shard3') {
  const limits = {
    spawn: [0,1,1,1,1,1,1,2,3], extension: [0,0,5,10,20,30,40,50,60],
    tower: [0,0,0,1,1,2,2,3,6], storage: [0,0,0,0,1,1,1,1,1],
    link: [0,0,0,0,0,2,3,4,6], terminal: [0,0,0,0,0,0,1,1,1],
    lab: [0,0,0,0,0,0,3,6,10], extractor: [0,0,0,0,0,0,1,1,1],
    factory: [0,0,0,0,0,0,0,1,1], container: [0,5,5,5,5,5,5,5,5],
    road: [0,2500,2500,2500,2500,2500,2500,2500,2500],
    observer: [0,0,0,0,0,0,0,0,1], powerSpawn: [0,0,0,0,0,0,0,0,1], nuker: [0,0,0,0,0,0,0,0,1],
  };
  const created = [];
  const context = installNative({
    exports: {}, console: {log() {}}, CONTROLLER_STRUCTURES: limits, TERRAIN_MASK_WALL: 1,
    FIND_MY_STRUCTURES: 1, FIND_MY_CONSTRUCTION_SITES: 2, LOOK_CONSTRUCTION_SITES: 3, OK: 0,
    Game: {shard:{name:shard},time:100,rooms:{E58S42:{controller:{level:4}}},map:{getRoomTerrain:()=>({get:(x,y)=>+fixture.terrain[y*50+x]})}},
    RoomPosition: class {
      constructor(x,y,roomName) {Object.assign(this,{x,y,roomName});}
      lookForStructure() { return undefined; }
      lookFor() { return []; }
      createConstructionSite(type) {created.push([this.x,this.y,type]);return 0;}
    },
    require: name => name.includes('layouts') ? {E58S42_PLAN:plan} : {packCoordList: ps => JSON.stringify(ps)},
  });
  for (const t of ['road','extractor','rampart','controller','link']) context['STRUCTURE_'+t.toUpperCase()] = t;
  const code = ts.transpileModule(fs.readFileSync('src/roomPlanner/roomOverrides.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
  vm.runInNewContext(code,context);
  const existing=fixture.objects.filter(o=>['spawn','extension','tower','storage'].includes(o.type)).map(o=>({structureType:o.type,pos:{x:o.x,y:o.y}}));
  const colony={name:'E58S42',level:4,controller:{my:true},memory:{unrelated:{keep:true}},room:{find:type=>type===1?existing:[]}};
  return {api:context.exports,colony,context,created,existing};
}
test('migration preserves existing buildings at RCL4, removes bunker mode, and is idempotent',()=>{
  const {api,colony,existing}=setup();
  const memory={active:false,bunkerData:{anchor:{x:36,y:31}},savedFlags:[]};
  api.installRoomOverride(colony,memory);
  assert.equal(memory.customLayout,'E58S42-terrain-v4');
  assert.equal(memory.bunkerData,undefined);
  assert.equal(memory.relocating,false);
  assert.equal(memory.mapsByLevel[4].extension.length,20);
  for(const s of existing)assert.ok(memory.mapsByLevel[4][s.structureType].some(p=>p.x===s.pos.x&&p.y===s.pos.y));
  assert.deepEqual(colony.memory.unrelated,{keep:true});
  const installed=memory.mapsByLevel;
  api.installRoomOverride(colony,memory);
  assert.equal(memory.mapsByLevel,installed);
});
test('other shards are untouched',()=>{
  const {api,colony}=setup('shard2');const memory={};api.installRoomOverride(colony,memory);assert.deepEqual(memory,{});
});
test('stale live structures reject migration before changing memory',()=>{
  const {api,colony,existing}=setup();existing.push({structureType:'spawn',pos:{x:10,y:10}});const memory={};
  assert.throws(()=>api.installRoomOverride(colony,memory),/needs review/);assert.deepEqual(memory,{});
});
test('tunnel site scheduling honors room site budget and RCL',()=>{
  const {api,colony,created}=setup();colony.room.find=()=>Array(9).fill({});
  for (const level of [4,5]) {colony.level=level;api.buildOverrideTunnel(colony);assert.equal(created.length,0);}
  colony.level=6;api.buildOverrideTunnel(colony);
  assert.deepEqual(created,[[30,28,'road']]);created.length=0;
  colony.level=3;api.buildOverrideTunnel(colony);assert.equal(created.length,0);
  colony.level=6;colony.room.find=()=>Array(10).fill({});api.buildOverrideTunnel(colony);assert.equal(created.length,0);
});
test('road obstacles reserve RCL8 buildings when the active map is only RCL4',()=>{
  const {api,colony,context}=setup();const memory={};api.installRoomOverride(colony,memory);
  const source=ts.createSourceFile('RoomPlanner.ts',fs.readFileSync('src/roomPlanner/RoomPlanner.ts','utf8'),ts.ScriptTarget.Latest,true);
  const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='RoomPlanner');
  const method=cls.members.find(n=>n.name&&n.name.getText(source)==='getObstacles');
  const code=ts.transpileModule('class Planner {'+method.getText(source)+'}; exports.Planner=Planner;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
  Object.assign(context,{STRUCTURE_CONTAINER:'container',hasRoomOverride:api.hasRoomOverride,derefRoomPosition:p=>p,_:{map:(ps,fn)=>ps.map(fn),unique:ps=>ps,keys:Object.keys}});
  vm.runInNewContext(code,context);
  const planner=new context.exports.Planner();
  Object.assign(planner,{colony:{name:'E58S42',sources:[],extractors:[],controller:{pos:{x:17,y:23}}},memory,map:memory.mapsByLevel[4]});
  const obstacles=planner.getObstacles();
  for(const t of ['link','lab','factory','spawn','extension']){
    for(const p of plan.buildings[t])assert.ok(obstacles.some(q=>p.x===q.x&&p.y===q.y),t+' '+JSON.stringify(p));
  }
});

test('existing tunnel tasks pause below RCL6 and resume without losing progress',()=>{
  const {api,context}=setup();
  const source=ts.createSourceFile('build.ts',fs.readFileSync('src/tasks/instances/build.ts','utf8'),ts.ScriptTarget.Latest,true);
  const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='TaskBuild');
  const methods=cls.members.filter(n=>n.name&&['isValidTarget','work'].includes(n.name.getText(source)));
  const code=ts.transpileModule('class BuildTask {'+methods.map(m=>m.getText(source)).join('\n')+'}; exports.BuildTask=BuildTask;',
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
  Object.assign(context,{isDeferredTunnel:api.isDeferredTunnel,ERR_INVALID_TARGET:-7});
  vm.runInNewContext(code,context);
  const task=new context.exports.BuildTask();let builds=0;
  task.target={my:true,structureType:'road',pos:{roomName:'E58S42',x:30,y:28},progress:5400,progressTotal:45000,isWalkable:true};
  task.creep={build(){builds++;return 0;}};
  for(const level of [4,5]) {
    context.Game.rooms.E58S42.controller.level=level;
    assert.equal(task.isValidTarget(),false);assert.equal(task.work(),-7);
  }
  assert.equal(builds,0);assert.equal(task.target.progress,5400);
  context.Game.rooms.E58S42.controller.level=6;
  assert.equal(task.isValidTarget(),true);assert.equal(task.work(),0);assert.equal(builds,1);
  context.Game.rooms.E58S42.controller.level=4;task.target.pos.x=29;
  assert.equal(task.isValidTarget(),true,'ordinary roads must remain buildable');
});
test('generic road planner respects the tunnel gate as well as the dedicated scheduler',()=>{
  const {api,context}=setup();
  const source=ts.createSourceFile('RoadPlanner.ts',fs.readFileSync('src/roomPlanner/RoadPlanner.ts','utf8'),ts.ScriptTarget.Latest,true);
  const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='RoadPlanner');
  const method=cls.members.find(n=>n.name&&n.name.getText(source)==='buildMissing');
  const code=ts.transpileModule('class RoadPlanner {'+method.getText(source)+'}; exports.RoadPlanner=RoadPlanner;',
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText;
  const built=[];
  const positions=[{x:30,y:28},{x:31,y:27},{x:29,y:29}].map(p=>({...p,roomName:'E58S42',room:{},
    getMultiRoomRangeTo(){return 0;},lookForStructure(){return undefined;},createConstructionSite(){built.push([p.x,p.y]);return 0;}}));
  Object.assign(context,{isDeferredTunnel:api.isDeferredTunnel,RoomPlanner:{settings:{maxSitesPerColony:10}},
    unpackCoordListAsPosList:()=>positions,_:{sortBy:ps=>ps}});
  vm.runInNewContext(code,context);
  const planner=new context.exports.RoadPlanner();
  Object.assign(planner,{colony:{constructionSites:[],pos:{}},memory:{roadCoordsPacked:{E58S42:'test'}},roomPlanner:{requestRecheck(){}}});
  planner.buildMissing();assert.deepEqual(built,[[29,29]]);
  built.length=0;context.Game.rooms.E58S42.controller.level=6;
  planner.buildMissing();assert.deepEqual(built,[[30,28],[31,27],[29,29]]);
});

test('v2 migration drops redundant shields without relocating the economy',()=>{
  const {api,colony}=setup();
  const memory={customLayout:'E58S42-terrain-v2',active:false};
  api.installRoomOverride(colony,memory);
  assert.equal(memory.customLayout,'E58S42-terrain-v4');
  assert.equal(memory.relocating,false);
  const barriers=JSON.parse(colony.memory.barrierPlanner.barrierCoordsPacked);
  assert.equal(barriers.length,31);
  for(const [x,y] of [[18,24],[22,47],[23,47],[33,46],[34,35],[34,36],[34,37],[34,38],[26,37]]) {
    assert.ok(!barriers.some(p=>p.x===x&&p.y===y));
  }
});

test('critical shields follow completed owned buildings and do not cache vacant positions',()=>{
  const {api,context}=setup();
  const source=ts.createSourceFile('BarrierPlanner.ts',fs.readFileSync('src/roomPlanner/BarrierPlanner.ts','utf8'),ts.ScriptTarget.Latest,true);
  const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='BarrierPlanner');
  const method=cls.members.find(n=>n.name&&n.name.getText(source)==='barrierShouldBeHere');
  Object.assign(context,{hasRoomOverride:api.hasRoomOverride,LOOK_STRUCTURES:4,
    packCoord:p=>`${p.x},${p.y};`,isOwnedStructure:s=>typeof s.my==='boolean'});
  for(const t of ['spawn','tower','storage','terminal'])context['STRUCTURE_'+t.toUpperCase()]=t;
  vm.runInNewContext(ts.transpileModule('class BarrierPlanner {'+method.getText(source)+'};exports.BarrierPlanner=BarrierPlanner;',
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText,context);
  const planner=new context.exports.BarrierPlanner();
  planner.colony={name:'E58S42'};
  planner.memory={barrierCoordsPacked:plan.barriers.map(context.packCoord).join('')};
  const position=(x,y,structures=[])=>({x,y,roomName:'E58S42',lookFor:()=>structures});
  for(const p of plan.barriers)assert.equal(planner.barrierShouldBeHere(position(p.x,p.y)),true);
  for(const type of ['spawn','tower','storage','terminal']) {
    const structures=[];
    const p=position(26,37,structures);
    assert.equal(planner.barrierShouldBeHere(p),false,'empty future site');
    structures.push({structureType:type,my:true});
    assert.equal(planner.barrierShouldBeHere(p),true,'new completed critical building');
    structures[0].my=false;
    assert.equal(planner.barrierShouldBeHere(p),false,'hostile building');
    structures[0]={structureType:'rampart',my:true};
    assert.equal(planner.barrierShouldBeHere(p),false,'old shield alone must not keep itself alive');
  }
  assert.equal(planner.barrierShouldBeHere(position(18,24)),false,'redundant historic shield');
});

test('fixed home roads are not duplicated by local replanning; remotes and other rooms still route',()=>{
  const {api,context}=setup();
  const source=ts.createSourceFile('RoadPlanner.ts',fs.readFileSync('src/roomPlanner/RoadPlanner.ts','utf8'),ts.ScriptTarget.Latest,true);
  const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='RoadPlanner');
  const method=cls.members.find(n=>n.name&&n.name.getText(source)==='planRoad');
  Object.assign(context,{hasRoomOverride:api.hasRoomOverride});
  vm.runInNewContext(ts.transpileModule('class RoadPlanner {'+method.getText(source)+'};exports.RoadPlanner=RoadPlanner;',
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2017}}).outputText,context);
  const planner=new context.exports.RoadPlanner();let calls=0;
  Object.assign(planner,{roadPositions:[],generateRoadPath(){calls++;return ['new road'];}});
  planner.planRoad({roomName:'E58S42'},{roomName:'E58S42'},[]);assert.equal(calls,0);
  planner.planRoad({roomName:'E58S42'},{roomName:'E59S42'},[]);assert.equal(calls,1);
  planner.planRoad({roomName:'E59S42'},{roomName:'E59S42'},[]);assert.equal(calls,2);
  context.Game.shard.name='shard2';planner.planRoad({roomName:'E58S42'},{roomName:'E58S42'},[]);assert.equal(calls,3);
});
