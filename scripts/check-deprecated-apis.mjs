import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = ts.readConfigFile(path.join(root, "tests/tsconfig.json"), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.join(root, "tests"));
if (parsed.errors.length) {
  throw new Error(
    parsed.errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
      .join("\n"),
  );
}
const files = ts.sys.readDirectory(
  root,
  [".ts", ".js", ".mjs", ".cjs"],
  [],
  ["src/**/*", "tests/**/*", "scripts/**/*", "vite.config.mjs"],
);
const program = ts.createProgram(files, { ...parsed.options, rootDir: root, noEmit: true });
const checker = program.getTypeChecker();
const findings = [];
let scanned = 0;

for (const source of program.getSourceFiles()) {
  const relative = path.relative(root, source.fileName);
  if (relative.startsWith("..") || relative.startsWith("node_modules/") || source.isDeclarationFile)
    continue;
  scanned++;
  function visit(node) {
    let deprecated = false;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      // Check the selected overload: getObjectById has both current and deprecated signatures.
      deprecated = checker
        .getResolvedSignature(node)
        ?.getJsDocTags()
        .some((tag) => tag.name === "deprecated");
    } else if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node) ||
      ts.isIdentifier(node)
    ) {
      const parent = node.parent;
      const isCalled =
        (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        ts.isElementAccessExpression(parent);
      const isDeclarationName = parent.name === node && !ts.isShorthandPropertyAssignment(parent);
      if (!isCalled && !isPropertyName && !isDeclarationName) {
        let symbol = checker.getSymbolAtLocation(
          ts.isPropertyAccessExpression(node)
            ? node.name
            : ts.isElementAccessExpression(node)
              ? node.argumentExpression
              : node,
        );
        if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        deprecated = symbol?.getJsDocTags(checker).some((tag) => tag.name === "deprecated");
      }
    }
    if (deprecated) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      findings.push(
        `${relative}:${position.line + 1}:${position.character + 1}: ${node.getText(source)}`,
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (findings.length) {
  console.error(`Found ${findings.length} deprecated API usages:\n${findings.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    `No deprecated API usages in ${scanned} project files (installed type declarations).`,
  );
}
