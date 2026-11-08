import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import { hashObject } from '../../packages/content/index.ts';
import { registerExistingSessionAuthority, sessionAuthorityFromPrivateJwk } from '../../apps/api/session-authority.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function privateJwk() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return crypto.subtle.exportKey('jwk', pair.privateKey);
}

test('session authority registration appends a public identity and preserves existing rows', async () => {
  const db = await openDatabase('memory://');
  try {
    await migrate(db);
    const first = await sessionAuthorityFromPrivateJwk(await privateJwk());
    const second = await sessionAuthorityFromPrivateJwk(await privateJwk());
    const inserted = await registerExistingSessionAuthority(db, first);
    assert.equal(inserted.inserted, true);
    assert.equal(inserted.preserved, 0);
    const added = await registerExistingSessionAuthority(db, second);
    assert.equal(added.preserved, 1);
    const again = await registerExistingSessionAuthority(db, first);
    assert.equal(again.inserted, false);
    assert.equal(again.preserved, 2);
    const rows = (await db.query<{ id: string; identity: { jwk: JsonWebKey } }>('SELECT id, identity FROM session_authorities ORDER BY id')).rows;
    assert.deepEqual(rows.map(row => row.id).sort(), [first.id, second.id].sort());
    assert.equal(rows.some(row => 'd' in row.identity.jwk), false);
    await db.query('UPDATE session_authorities SET identity=$2 WHERE id=$1', [first.id, second]);
    await assert.rejects(registerExistingSessionAuthority(db, first), /SESSION_AUTHORITY_CONFLICT/);
    const after = (await db.query<{ identity: unknown }>('SELECT identity FROM session_authorities WHERE id=$1', [first.id])).rows[0];
    assert.equal(await hashObject(after.identity), await hashObject(second));
    assert.equal((await db.query('SELECT id FROM session_authorities')).rows.length, 2);
  } finally { await db.close(); }
});

test('the registration command writes a private JWK outside the repo and never prints it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'focus-play-jwk-'));
  try {
    const file = join(directory, 'session.jwk.json');
    const written = spawnSync(process.execPath, ['scripts/register-play-session-authority.ts', '--write-new-jwk', '--jwk-file', file], { cwd: root, encoding: 'utf8' });
    assert.equal(written.status, 0, written.stderr);
    assert.doesNotMatch(written.stdout, /"d"\s*:/);
    const key = JSON.parse(await readFile(file, 'utf8')) as JsonWebKey;
    assert.equal(typeof key.d, 'string');
    assert.equal((await stat(file)).mode & 0o077, 0);
    const report = JSON.parse(written.stdout);
    assert.equal(report.id, (await sessionAuthorityFromPrivateJwk(key)).id);
    const inside = spawnSync(process.execPath, ['scripts/register-play-session-authority.ts', '--write-new-jwk', '--jwk-file', join(root, 'session.jwk.json')], { cwd: root, encoding: 'utf8' });
    assert.equal(inside.status, 1);
    assert.match(inside.stderr, /SESSION_JWK_PATH_INVALID/);
    const missingDb = spawnSync(process.execPath, ['scripts/register-play-session-authority.ts', '--register', '--jwk-file', file], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(missingDb.status, 1);
    assert.match(missingDb.stderr, /SESSION_AUTHORITY_DATABASE_REQUIRED/);
    assert.doesNotMatch(`${missingDb.stdout}${missingDb.stderr}`, /"d"\s*:/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
