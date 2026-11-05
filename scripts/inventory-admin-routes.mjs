import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const routes = [];

async function scan(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(filename);
      continue;
    }
    if (entry.name !== 'route.ts') continue;
    const source = ts.createSourceFile(
      filename,
      await readFile(filename, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const statement of source.statements) {
      let exports = [];
      if (
        ts.isExportDeclaration(statement) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        exports = statement.exportClause.elements.map((element) => ({
          method: element.name.text,
          handler: (element.propertyName ?? element.name).text,
        }));
      } else if (
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        const declarations = ts.isVariableStatement(statement)
          ? statement.declarationList.declarations
          : [statement];
        exports = declarations.map((declaration) => ({
          method: declaration.name?.getText(source),
          handler: declaration.name?.getText(source),
        }));
      }
      for (const item of exports) {
        if (!methods.has(item.method)) continue;
        routes.push({
          file: path.relative(root, filename).split(path.sep).join('/'),
          ...item,
        });
      }
    }
  }
}

await scan(path.join(root, 'apps/admin/app'));
const writeVerbs = routes.filter((route) =>
  ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method),
);
process.stdout.write(
  JSON.stringify(
    {
      scope:
        'Declared HTTP exports. Handler policy determines whether a verb writes, reads, or refuses.',
      writeVerbExports: writeVerbs.length,
      routesWithWriteVerbs: new Set(writeVerbs.map((route) => route.file)).size,
      routes,
    },
    null,
    2,
  ) + '\n',
);
