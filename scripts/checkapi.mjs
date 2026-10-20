// Compiles api/ the way a Node ES-module runtime (Vercel) sees it and makes sure it loads and answers.
// Catches the "500: ERR_MODULE_NOT_FOUND" class of deploy failures (e.g. a relative import without a .js extension).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(join(tmpdir(), 'apicheck-'));
writeFileSync(join(out, 'package.json'), '{"type":"module"}');
try {
  execFileSync('npx', ['tsc', '--ignoreConfig', 'api/claude.ts', 'api/_prompts.ts', '--outDir', out, '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--skipLibCheck', '--types', 'node'], { stdio: 'pipe' });
} catch (e) {
  console.error('FAIL: api/ does not compile for a Node ESM runtime:\n' + (e.stdout?.toString() || e.message));
  process.exit(1);
}
let result;
try {
  const mod = await import(pathToFileURL(join(out, 'claude.js')).href);
  const res = { status(c) { this.c = c; return this; }, json(b) { result = { code: this.c, body: b }; } };
  await mod.default({ method: 'GET', headers: {} }, res);
} catch (e) {
  console.error('FAIL: api/claude does not load:', e.code ?? '', e.message.split('\n')[0]);
  process.exit(1);
}
if (result?.code !== 200) { console.error('FAIL: GET /api/claude returned', JSON.stringify(result)); process.exit(1); }
console.log('PASS: api/claude compiles and loads under Node ESM; GET ->', JSON.stringify(result.body));
