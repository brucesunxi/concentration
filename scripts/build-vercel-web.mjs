import { build } from 'vite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/web');

async function check(script) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(root, script), '--directory', output], { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${script} exited ${code}`)));
  });
}

await build({ configFile: resolve(root, 'vite.config.ts'), build: { outDir: output, emptyOutDir: true } });
await check('scripts/audit-web-budget.mjs');
await check('scripts/build-offline-shell.mjs');
