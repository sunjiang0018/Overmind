const fs = require('node:fs');
const ts = require('typescript');

const exportsObject = {};
const code = ts.transpileModule(fs.readFileSync('src/utilities/native.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024},
}).outputText;
new Function('exports', code)(exportsObject);
// Aliases used where a source file has a local identifier with the plain helper name.
exportsObject.nativeMax = exportsObject.max;
exportsObject.nativeDefaults = exportsObject.defaults;
module.exports = exportsObject;
