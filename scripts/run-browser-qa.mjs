import { spawnSync } from 'node:child_process';

const python = process.env.FOCUS_BROWSER_PYTHON || 'python3';
const check = spawnSync(python, ['-c', 'import playwright'], { stdio: 'ignore' });
if (check.error || check.status !== 0) {
  console.error(`Playwright is unavailable in ${python}. Install scripts/qa/requirements.txt and a Playwright Chromium browser first.`);
  process.exit(1);
}

for (const [command, args] of [
  [process.execPath, ['scripts/build-vercel-web.mjs']],
  [python, ['scripts/qa/browser_family.py']],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
