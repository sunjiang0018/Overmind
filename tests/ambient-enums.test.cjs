const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const {ambientEnumDefines} = require('../scripts/ambient-enums.cjs');

test('every generated memory key matches the TypeScript compiler output', () => {
  const defines = ambientEnumDefines();
  const names = Object.keys(defines);
  assert.ok(names.length > 60, 'all global memory key enums must be included');
  const file = path.resolve('enum-validation.ts');
  const host = ts.createCompilerHost({});
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) => name === file
    ? ts.createSourceFile(name, `globalThis.result = [${names.join(',')}];`, languageVersion, true)
    : originalGetSourceFile(name, languageVersion, ...rest);
  const declarations = fs.readdirSync('src/declarations')
    .filter(name => name.endsWith('.d.ts')).map(name => path.resolve('src/declarations', name));
  const program = ts.createProgram([...declarations, file], {
    target: ts.ScriptTarget.ES2024, types: [], noResolve: true,
  }, host);
  let emitted;
  program.emit(undefined, (name, text) => {if (name.endsWith('enum-validation.js')) emitted = text;});
  assert.ok(emitted);
  const context = {};
  vm.runInNewContext(emitted, context);
  assert.deepEqual(Array.from(context.result), names.map(name => JSON.parse(defines[name])));
});

test('unsupported ambient enum values fail the build instead of silently changing memory keys', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'overmind-enum-test-'));
  try {
    fs.writeFileSync(path.join(directory, 'test.d.ts'), 'declare const enum Invalid {Implicit}');
    assert.throws(() => ambientEnumDefines(directory), /explicit literal value/);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
