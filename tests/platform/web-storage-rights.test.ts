import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';

test('a failed browser journal cannot block parent sign-in or child data rights, but blocks new practice', async () => {
  const previousIndexedDB = globalThis.indexedDB;
  const previousFetch = globalThis.fetch;
  const originalPut = IDBObjectStore.prototype.put;
  const paths: string[] = [];
  try {
    globalThis.indexedDB = new IDBFactory();
    const { journal } = await import('../../apps/family-web/src/journal.ts');
    await journal().generation();
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
      if (this.name === 'meta') throw new DOMException('Synthetic browser storage failure', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
    globalThis.fetch = async input => {
      paths.push(String(input));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const api = await import('../../apps/family-web/src/api.ts');
    api.setCsrf('synthetic-csrf');
    await api.request('/auth/login', 'POST', { name: 'Synthetic family', password: 'synthetic-password' });
    await api.request('/children/synthetic-child/withdraw', 'POST', {});
    await api.request('/children/synthetic-child', 'DELETE');
    assert.deepEqual(paths, ['/api/auth/login', '/api/children/synthetic-child/withdraw', '/api/children/synthetic-child']);
    await assert.rejects(api.request('/children/synthetic-child/sessions', 'POST', {}), /Synthetic browser storage failure/);
    assert.equal(paths.length, 3);
  } finally {
    IDBObjectStore.prototype.put = originalPut;
    globalThis.indexedDB = previousIndexedDB;
    globalThis.fetch = previousFetch;
  }
});
