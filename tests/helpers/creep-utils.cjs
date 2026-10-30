const fs = require('node:fs');
const ts = require('typescript');

const exportsObject = {};
const code = ts.transpileModule(fs.readFileSync('src/utilities/creepUtils.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024},
}).outputText;
new Function('exports', code)(exportsObject);
module.exports = exportsObject;
