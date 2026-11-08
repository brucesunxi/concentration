import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessPlayInternalHealth, playInternalApiOrigin } from '../packages/mobile-release/play-internal-android.ts';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));

try {
  if (process.argv.length !== 4 || process.argv[2] !== '--output' || !process.argv[3] || process.argv[3].startsWith('--')) throw new Error('UNEXPECTED_ARGUMENT');
  const origin = playInternalApiOrigin(process.env.EXPO_PUBLIC_FOCUS_API_ORIGIN);
  const output = resolve(process.argv[3]);
  if (!output.startsWith(root + sep)) throw new Error('PLAY_INTERNAL_REPORT_PATH_INVALID');
  async function readStatus(path) {
    let response;
    try {
      response = await fetch(`${origin}${path}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: { accept: 'application/json', 'user-agent': 'FocusIslandPlayInternalCheck/1' },
      });
    } catch {
      throw new Error('PLAY_INTERNAL_API_UNREACHABLE');
    }
    const redirected = response.status >= 300 && response.status < 400;
    if (redirected || response.status !== 200) throw new Error(path === '/api/ready' && response.status === 503 ? 'PLAY_INTERNAL_API_NOT_READY' : 'PLAY_INTERNAL_API_UNREACHABLE');
    const text = await response.text();
    if (text.length > 4000) throw new Error('PLAY_INTERNAL_API_HEALTH_INVALID');
    let body;
    try { body = JSON.parse(text); } catch { throw new Error('PLAY_INTERNAL_API_HEALTH_INVALID'); }
    return assessPlayInternalHealth({ httpStatus: response.status, redirected: false, body });
  }
  const health = await readStatus('/api/health');
  const ready = await readStatus('/api/ready');
  await mkdir(dirname(output), { recursive: true });
  if (!(await realpath(dirname(output))).startsWith(root + sep)) throw new Error('PLAY_INTERNAL_REPORT_PATH_INVALID');
  const report = { origin, httpStatus: 200, mode: health.mode, audience: health.audience, ready: ready.audience === health.audience, redirected: false };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
  console.log(JSON.stringify({ ok: true, origin, httpStatus: 200, mode: health.mode, audience: health.audience, ready: true }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PLAY_INTERNAL_API_CHECK_FAILED');
  process.exitCode = 1;
}
