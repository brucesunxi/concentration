import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedPostgresUrl } from '../../packages/database/neon-tls.ts';

test('Neon runtime URL always keeps full certificate and hostname verification', () => {
  const value = verifiedPostgresUrl('postgresql://runtime:secret@ep-sample-pooler.us-east-2.aws.neon.tech/db?sslmode=require&channel_binding=require');
  const url = new URL(value);
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.equal(url.searchParams.get('channel_binding'), 'require');
  assert.equal(url.username, 'runtime');
  assert.equal(url.password, 'secret');
});

test('explicitly insecure Neon modes cannot be silently used', () => {
  for (const mode of ['disable', 'no-verify']) assert.throws(
    () => verifiedPostgresUrl(`postgres://runtime:secret@ep-sample.neon.tech/db?sslmode=${mode}`),
    /NEON_TLS_VERIFICATION_REQUIRED/,
  );
});

test('other PostgreSQL endpoints remain governed by their own configuration', () => {
  const local = 'postgresql://postgres@127.0.0.1/focus?sslmode=disable';
  assert.equal(verifiedPostgresUrl(local), local);
  assert.equal(verifiedPostgresUrl('postgresql://example.com'), 'postgresql://example.com');
});

test('duplicate Neon SSL modes are replaced by one verified mode', () => {
  const url = new URL(verifiedPostgresUrl('postgres://runtime:secret@ep-sample.neon.tech/db?sslmode=require&sslmode=disable'));
  assert.deepEqual(url.searchParams.getAll('sslmode'), ['verify-full']);
  const dotted = new URL(verifiedPostgresUrl('postgres://runtime:secret@ep-sample.neon.tech./db?sslmode=require'));
  assert.equal(dotted.searchParams.get('sslmode'), 'verify-full');
});
