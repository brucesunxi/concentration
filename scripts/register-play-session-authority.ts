import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../apps/api/database.ts';
import { registerExistingSessionAuthority, sessionAuthorityFromPrivateJwk } from '../apps/api/session-authority.ts';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('UNEXPECTED_ARGUMENT');
  return value;
}

async function outsideRepo(file: string): Promise<string> {
  const parent = await realpath(dirname(resolve(file)));
  if (parent === root || parent.startsWith(root + sep)) throw new Error('SESSION_JWK_PATH_INVALID');
  return resolve(file);
}

async function writeJwk(file: string): Promise<{ id: string; bytes: number }> {
  const destination = await outsideRepo(file);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const exported = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const identity = await sessionAuthorityFromPrivateJwk(exported);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(JSON.stringify(exported));
  await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
  return { id: identity.id, bytes: bytes.length };
}

async function readJwk(file: string): Promise<JsonWebKey> {
  const destination = await outsideRepo(file);
  const info = await lstat(destination);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 32 || info.size > 16384) throw new Error('SESSION_JWK_INVALID');
  if ((info.mode & 0o077) !== 0) throw new Error('SESSION_JWK_FILE_EXPOSED');
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(destination, 'utf8')); } catch { throw new Error('SESSION_JWK_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('SESSION_JWK_INVALID');
  return parsed as JsonWebKey;
}

try {
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === '--write-new-jwk' || arg === '--register') continue;
    if (arg === '--jwk-file') { index += 1; if (!process.argv[index] || process.argv[index].startsWith('--')) throw new Error('UNEXPECTED_ARGUMENT'); continue; }
    throw new Error('UNEXPECTED_ARGUMENT');
  }
  const file = argument('--jwk-file');
  if (!file) throw new Error('SESSION_JWK_FILE_REQUIRED');
  const write = process.argv.includes('--write-new-jwk');
  const register = process.argv.includes('--register');
  if (!write && !register) throw new Error('SESSION_AUTHORITY_ACTION_REQUIRED');
  if (write) {
    const created = await writeJwk(file);
    console.log(JSON.stringify({ event: 'PLAY_SESSION_JWK_WRITTEN', id: created.id, bytes: created.bytes }));
  }
  if (register) {
    const url = process.env.DATABASE_MIGRATION_URL;
    if (!url) throw new Error('SESSION_AUTHORITY_DATABASE_REQUIRED');
    if (process.env.APP_MODE === 'production') throw new Error('PRODUCTION_RELEASE_GATED');
    const identity = await sessionAuthorityFromPrivateJwk(await readJwk(file));
    const db = await openDatabase('memory://', url);
    try {
      const result = await registerExistingSessionAuthority(db, identity);
      console.log(JSON.stringify({ event: 'SESSION_AUTHORITY_REGISTERED', id: result.id, inserted: result.inserted, preserved: result.preserved, schema: 32 }));
    } finally { await db.close(); }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'SESSION_AUTHORITY_REGISTRATION_FAILED';
  console.error(/^[A-Z0-9_]+$/.test(message) ? message : 'SESSION_AUTHORITY_REGISTRATION_FAILED');
  process.exitCode = 1;
}
