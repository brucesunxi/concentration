import { chmod, open, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));

try {
  if (process.argv.length !== 4 || process.argv[2] !== '--output' || !process.argv[3] || process.argv[3].startsWith('--')) throw new Error('UNEXPECTED_ARGUMENT');
  const output = resolve(process.argv[3]);
  const parent = await realpath(dirname(output));
  if (output.startsWith(root + sep) || parent === root || parent.startsWith(root + sep)) throw new Error('PLAY_INTERNAL_KEYSTORE_PATH_INVALID');
  const compact = (process.env.FOCUS_PLAY_UPLOAD_KEYSTORE_BASE64 ?? '').replace(/\s+/g, '');
  if (!compact || compact.length > 350000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error('PLAY_INTERNAL_KEYSTORE_UNREADABLE');
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length < 16 || bytes.length > 256 * 1024) throw new Error('PLAY_INTERNAL_KEYSTORE_UNREADABLE');
  const handle = await open(output, 'wx', 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
  await chmod(output, 0o600);
  const info = await stat(output);
  if ((info.mode & 0o077) !== 0) throw new Error('PLAY_INTERNAL_KEYSTORE_UNREADABLE');
  console.log(JSON.stringify({ ok: true, bytes: info.size }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'PLAY_INTERNAL_KEYSTORE_UNREADABLE');
  process.exitCode = 1;
}
