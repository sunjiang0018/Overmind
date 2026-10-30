const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function sourceFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(file, files);
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      files.push(file);
    }
  }
  return files;
}

test('source contains no executable Lodash calls or imports', () => {
  const offenders = [];
  for (const file of sourceFiles('src')) {
    const source = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isImportDeclaration(node) && /^lodash(\.|$)/.test(node.moduleSpecifier.text)) {
        offenders.push(`${file}: import ${node.moduleSpecifier.text}`);
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && callee.text === '_') {
          offenders.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: lodash chain`);
        } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          && callee.expression.text === '_') {
          offenders.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: _.${callee.name.text}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  assert.deepEqual(offenders, []);
});
