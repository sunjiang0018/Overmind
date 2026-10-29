const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('src/utilities/pixels.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function setup(bucket,codeResult=0){
 let calls=0;const ctx={exports:{},Game:{time:123,cpu:{bucket,generatePixel(){calls++;return codeResult;}}},Memory:{stats:{persistent:{}}},PIXEL_CPU_COST:10000,OK:0};
 vm.runInNewContext(code,ctx);return {ctx,calls:()=>calls};
}
test('generates one pixel when the bucket is full',()=>{const {ctx,calls}=setup(10000);ctx.exports.generatePixelIfFull();assert.equal(calls(),1);assert.equal(ctx.Memory.stats.persistent.lastPixelTick,123);});
test('leaves a partially filled bucket untouched',()=>{const {ctx,calls}=setup(9999);ctx.exports.generatePixelIfFull();assert.equal(calls(),0);});
test('does not report failed generation as success',()=>{const {ctx,calls}=setup(10000,-6);ctx.exports.generatePixelIfFull();assert.equal(calls(),1);assert.equal(ctx.Memory.stats.persistent.lastPixelTick,undefined);});
test('skips servers without pixel generation',()=>{const {ctx,calls}=setup(10000);delete ctx.Game.cpu.generatePixel;ctx.exports.generatePixelIfFull();assert.equal(calls(),0);});
