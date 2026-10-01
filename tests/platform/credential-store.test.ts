import test from 'node:test';
import assert from 'node:assert/strict';
import { CredentialStore, CredentialInterrupted } from '../../packages/session-runtime/credential-store.ts';

test('a child credential written during backgrounding is erased before a newer identity can persist', async () => {
  let epoch = 1, stored: string | null = null;
  let started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const store = new CredentialStore({
    async set(value) { if (value === 'first') { started(); await gate; } stored = value; },
    async remove() { stored = null; },
  });
  const first = store.update('first', () => epoch === 1);
  const rejected = assert.rejects(first, CredentialInterrupted);
  await entered; epoch = 2;
  const newer = store.update('newer', () => epoch === 2);
  finish(); await rejected; await newer;
  assert.equal(stored, 'newer');
});

test('a stale authentication response cannot delete the current persisted identity', async () => {
  let stored: string | null = 'current';
  const store = new CredentialStore({ async set(value) { stored = value; }, async remove() { stored = null; } });
  await assert.rejects(store.update(null, () => false), CredentialInterrupted);
  assert.equal(stored, 'current');
  await store.update(null); assert.equal(stored, null);
});

test('a key-store failure does not prevent a later explicit sign-out from clearing credentials', async () => {
  let stored: string | null = 'old';
  const store = new CredentialStore({ async set() { throw new Error('locked'); }, async remove() { stored = null; } });
  await assert.rejects(store.update('next'), /locked/);
  await store.update(null); assert.equal(stored, null);
});
