import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const app = fileURLToPath(new URL('../apps/family-mobile/', import.meta.url));
const require = createRequire(join(app, 'package.json'));
const cli = join(dirname(require.resolve('expo/package.json')), 'bin/cli');
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: app, stdio: 'inherit', env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
