const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function runtime(){
 const code=ts.transpileModule(fs.readFileSync('src/overlords/defense/npcDefense.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2024,useDefineForClassFields:false,experimentalDecorators:true}}).outputText;
 const out={},Creep=class{};
 const deps={'../Overlord':{Overlord:class{}},'../../profiler/decorator':{profile:x=>x},'../../game/RoomStructures':{getRoomInvaderCore:r=>r.core},'../../game/Room':{getRoomInvaders:r=>r.invaders||[]},'../../intel/RoomIntel':{RoomIntel:{isInvasionLikely:()=>false}},'../../creepSetups/setups':{CombatSetups:{broodlings:{default:{}}}},'../../game/RoomPosition':{isPositionOnEdge:p=>p.y===0},'../../priorities/priorities_overlords':{OverlordPriority:{outpostDefense:{guard:551}}}};
 new Function('Creep',`return function(exports,require){${code}}`)(Creep)(out,n=>deps[n]||{});
 const o=Object.create(out.DefenseNPCOverlord.prototype);o.pos={roomName:'target'};return{o,Creep};
}
test('guard combat paths stay in the defended room and still heal',()=>{
 const {o,Creep}=runtime(),calls=[],g={pos:{isNearTo:()=>false},goTo:(t,opts)=>calls.push(opts),healSelfIfPossible:()=>calls.push('heal')};
 o.combatActions(g,new Creep());assert.equal(calls[0].pathOpts.maxRooms,1);assert.equal(calls[0].movingTarget,true);assert.equal(calls[1],'heal');
});
test('adjacent guards keep attacking instead of replacing attacks with movement',()=>{
 const {o}=runtime();let attacks=0;o.combatActions({pos:{isNearTo:()=>true},attackAndChase:()=>attacks++,healSelfIfPossible(){}},{});assert.equal(attacks,1);
});
test('reinforcements may cross rooms but arrival on an exit cannot route back out',()=>{
 const {o}=runtime(),calls=[],g={pos:{y:0},inSameRoomAs:()=>false,goToRoom:(r,opts)=>calls.push({r,opts})};o.handleGuard(g);assert.equal(calls[0].opts,undefined);
 g.inSameRoomAs=()=>true;o.handleGuard(g);assert.equal(calls[1].opts.pathOpts.maxRooms,1);
});

test('a level zero core alone requests a guard without requiring invader creeps',()=>{
 const {o}=runtime();let requested;o.wishlist=n=>requested=n;o.room={core:{level:0}};o.init();assert.equal(requested,1);
 o.room={};o.init();assert.equal(requested,0);
 o.room={core:{level:3}};o.init();assert.equal(requested,0);
});
