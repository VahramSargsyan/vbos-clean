// Repository-layout preflight only. Does not start the server, access a DB or use GitHub Actions.
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const required = [
  'package.json', 'server.mjs', 'schema.sql', 'public/index.html',
  'public/app.js', 'public/estimate-plumbing.mjs',
  'migrations/0035_estimator_card_editor_TEST_ONLY.sql',
  'migrations/0036_estimator_pricebook_TEST_ONLY.sql',
];
const errors = [];
for (const name of required) if (!existsSync(join(root, name))) errors.push('MISSING_REQUIRED '+name);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.scripts?.start !== 'node server.mjs') errors.push('START_COMMAND_MISMATCH');
if (!pkg.dependencies?.pg) errors.push('POSTGRES_DRIVER_MISSING');
if (Number(process.versions.node.split('.')[0]) < 20) errors.push('NODE_20_REQUIRED');

const sources = [];
function visit(dir) {
  for (const entry of readdirSync(dir, {withFileTypes:true})) {
    if (['.git', 'node_modules', 'coverage'].includes(entry.name)) continue;
    const name = join(dir, entry.name);
    if (entry.isDirectory()) visit(name);
    else if (/\.(?:mjs|js)$/.test(entry.name)) sources.push(name);
  }
}
visit(root);
let references = 0;
for (const file of sources) {
  const code = readFileSync(file, 'utf8');
  // Relative static imports and literal dynamic imports only; no code is executed.
  const imports = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*)['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)];
  for (const match of imports) {
    const spec = match[1] ?? match[2];
    references++;
    const path = resolve(dirname(file), spec);
    if (!existsSync(path)) errors.push('MISSING_IMPORT '+file.slice(root.length)+' -> '+spec);
  }
  // Fail closed if a source-relative file read escapes this standalone checkout.
  // This includes historical parity fixtures: they must be shipped in THIS repository.
  const fileUrls = [...code.matchAll(/\bnew\s+URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)];
  for (const match of fileUrls) {
    const p = resolve(dirname(file), match[1]);
    const source = file.slice(root.length);
    if (!(p === resolve(root) || p.startsWith(resolve(root) + '/'))) {
      errors.push('EXTERNAL_SOURCE_REF '+source+' -> '+match[1]);
    } else if (!existsSync(p)) {
      errors.push('MISSING_SOURCE_FILE_REF '+source+' -> '+match[1]);
    }
  }
}
if (errors.length) {
  console.error('SOURCE_PREFLIGHT_FAIL files='+sources.length+' imports='+references);
  for (const message of errors) console.error(message);
  process.exitCode = 1;
} else {
  console.log('SOURCE_PREFLIGHT_PASS files='+sources.length+' imports='+references+' (static layout only)');
}
