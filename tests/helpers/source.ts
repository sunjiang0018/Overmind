import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

export function classMembers(
  file: string,
  name: string,
  members: string[] | ((member: ts.ClassElement) => boolean),
): string {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name,
  );
  assert.ok(declaration, `${file} must declare ${name}`);
  if (typeof members === "function") {
    return declaration.members
      .filter(members)
      .map((node) => node.getText(source))
      .join("\n");
  }
  return members
    .map((member) => {
      const node = declaration.members.find((node) => node.name?.getText(source) === member);
      assert.ok(node, `${name} must declare ${member}`);
      return node.getText(source);
    })
    .join("\n");
}
