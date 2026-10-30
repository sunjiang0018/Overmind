const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Oxc transforms files independently and cannot inline globals declared in .d.ts files.
// Read the existing declarations as the single source of truth for compressed memory keys.
function ambientEnumDefines(directory = path.resolve(__dirname, '../src')) {
  const defines = {};
  const declarations = fs.readdirSync(directory, {recursive: true})
    .filter(file => file.endsWith('.d.ts')).sort();
  for (const file of declarations) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(directory, file), 'utf8'),
      ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isEnumDeclaration(node) || !node.modifiers?.some(m => m.kind === ts.SyntaxKind.ConstKeyword)) continue;
      for (const member of node.members) {
        const value = member.initializer;
        if (!value || !(ts.isStringLiteral(value) || ts.isNumericLiteral(value))) {
          throw new Error(`${file}: ${node.name.text}.${member.name.getText(source)} must have an explicit literal value`);
        }
        const key = `${node.name.text}.${member.name.text}`;
        if (Object.hasOwn(defines, key)) throw new Error(`Duplicate ambient enum member: ${key}`);
        defines[key] = JSON.stringify(ts.isStringLiteral(value) ? value.text : Number(value.text));
      }
    }
  }
  return defines;
}

module.exports = {ambientEnumDefines};
