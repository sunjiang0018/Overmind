const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('src/utilities/outpostDevelopment.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,out={};new Function('exports',code)(out);
test('configured expansion order preserves existing income before new double mines and cleanup remote',()=>{
 const input=['E58S43','E58S44','E59S43'];assert.deepEqual(out.orderOutposts(input,['E58S43','E59S43','E58S44']),['E58S43','E59S43','E58S44']);assert.deepEqual(input,['E58S43','E58S44','E59S43']);assert.equal(out.orderOutposts(input),input);
});
test('selected swamp and shared roads precede ordinary roads without changing ordinary ordering',()=>{
 const p=(roomName,x)=>({roomName,x,y:1}),a=p('home',1),b=p('remote',1),swamp=p('remote',2),shared=p('home',2);
 assert.deepEqual(out.orderDevelopmentRoads([a,shared,b,swamp],[swamp,shared]),[swamp,shared,a,b]);assert.notEqual(out.developmentPositionKey(a),out.developmentPositionKey(b));
});
