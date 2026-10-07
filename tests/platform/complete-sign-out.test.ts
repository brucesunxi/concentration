import test from 'node:test';
import assert from 'node:assert/strict';
import { completeSignOut } from '../../packages/session-runtime/complete-sign-out.ts';

test('a failed offline cleanup still erases the credential and revokes the captured token', async () => {
  const called: string[] = [];
  const failed = new Error('local database unavailable');
  await assert.rejects(completeSignOut({
    eraseCredential: async () => { called.push('erase'); },
    invalidateOffline: async () => { called.push('invalidate'); throw failed; },
    revokeRemote: async () => { called.push('revoke'); },
  }), error => error === failed);
  assert.deepEqual(new Set(called), new Set(['erase', 'invalidate', 'revoke']));
});

test('a failed credential erase still allows remote token revocation', async () => {
  const called: string[] = [];
  const failed = new Error('secure store unavailable');
  await assert.rejects(completeSignOut({
    eraseCredential: async () => { called.push('erase'); throw failed; },
    invalidateOffline: async () => { called.push('invalidate'); },
    revokeRemote: async () => { called.push('revoke'); },
  }), error => error === failed);
  assert.deepEqual(new Set(called), new Set(['erase', 'invalidate', 'revoke']));
});

test('a remote outage does not skip local sign-out', async () => {
  const called: string[] = [];
  const failed = new Error('network unavailable');
  await assert.rejects(completeSignOut({
    eraseCredential: async () => { called.push('erase'); },
    invalidateOffline: async () => { called.push('invalidate'); },
    revokeRemote: async () => { called.push('revoke'); throw failed; },
  }), error => error === failed);
  assert.deepEqual(new Set(called), new Set(['erase', 'invalidate', 'revoke']));
});

test('a blocked local database does not delay remote revocation', async () => {
  let finishLocal: (() => void) | undefined;
  let remoteRevoked = false;
  const pending = completeSignOut({
    eraseCredential: async () => undefined,
    invalidateOffline: () => new Promise<void>(resolve => { finishLocal = resolve; }),
    revokeRemote: async () => { remoteRevoked = true; },
  });
  await Promise.resolve();
  assert.equal(remoteRevoked, true);
  finishLocal?.();
  await pending;
});
