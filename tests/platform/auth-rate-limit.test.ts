import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import { authClientFingerprint, authClientIp, authRateKind, takeAuthSlot } from '../../apps/api/auth-rate-limit.ts';

test('authentication slots survive process restarts and concurrent requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'focus-auth-rate-'));
  const start = new Date('2026-10-01T09:00:00.000Z');
  const fingerprint = authClientFingerprint('synthetic-test-secret', '203.0.113.7');
  let db = await openDatabase(directory);
  try {
    await migrate(db);
    const allowed = await Promise.all(Array.from({ length: 12 }, () => takeAuthSlot(db, 'login', fingerprint, start)));
    assert.equal(allowed.filter(Boolean).length, 12);
    assert.equal(await takeAuthSlot(db, 'login', fingerprint, start), false);
    assert.equal(await takeAuthSlot(db, 'setup', fingerprint, start), true);
    await db.close();
    db = await openDatabase(directory);
    assert.equal(await takeAuthSlot(db, 'login', fingerprint, new Date(start.getTime() + 599_999)), false);
    assert.equal(await takeAuthSlot(db, 'login', fingerprint, new Date(start.getTime() + 600_000)), true);
    assert.equal(await takeAuthSlot(db, 'login', authClientFingerprint('synthetic-test-secret', '203.0.113.8'), start), true);
    assert.equal((await db.query<{ n: number }>('SELECT count(*)::int n FROM auth_rate_limits')).rows[0].n, 3);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('local requests ignore forwarding headers while hosted requests use the platform client IP', () => {
  const request = { headers: { 'x-forwarded-for': '203.0.113.7' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(authClientIp(request, false), '127.0.0.1');
  assert.equal(authClientIp(request, true), '203.0.113.7');
  assert.equal(authRateKind('/api/auth/login'), 'login');
  assert.equal(authRateKind('/api/auth/login/other'), undefined);
  request.headers['x-forwarded-for'] = 'not-an-ip';
  assert.equal(authClientIp(request, true), 'unknown');
});
