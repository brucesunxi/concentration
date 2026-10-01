import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['--watch', 'apps/api/main.ts'], { stdio: 'inherit', env: { ...process.env, APP_MODE: 'local' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) child.on('exit', code => stop(code ?? 1));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
