import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('a sign-out blocks offline recovery across a browser reload until local reconciliation succeeds', async () => {
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
  };
  const values = new Map<string, string>();
  let cookie = '';
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    get cookie() { return cookie; },
    set cookie(value: string) { cookie = value.includes('Max-Age=0') ? '' : value.split(';')[0]; },
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'https:' } });
  try {
    const first = await import(`../../apps/family-web/src/offline-access.ts?${randomUUID()}`);
    assert.equal(first.offlineRecoveryBlocked(), false);
    first.blockOfflineRecovery();
    assert.equal(first.offlineRecoveryBlocked(), true);
    assert.match(cookie, /^focus-offline-access-blocked=1$/);
    values.clear();
    const reloaded = await import(`../../apps/family-web/src/offline-access.ts?${randomUUID()}`);
    assert.equal(reloaded.offlineRecoveryBlocked(), true);
    values.set('focus-offline-access-blocked', '1');
    cookie = '';
    const withoutCookie = await import(`../../apps/family-web/src/offline-access.ts?${randomUUID()}`);
    assert.equal(withoutCookie.offlineRecoveryBlocked(), true);
    assert.equal(withoutCookie.allowOfflineRecovery(), true);
    assert.equal(withoutCookie.offlineRecoveryBlocked(), false);
  } finally {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
});
