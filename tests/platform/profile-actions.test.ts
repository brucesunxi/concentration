import test from 'node:test';
import assert from 'node:assert/strict';
import { localRecoveryForExport, performProfileAction, serializeChildExport } from '../../packages/session-runtime/profile-actions.ts';
import type { ProfileActionPorts } from '../../packages/session-runtime/profile-actions.ts';
import { NetworkUnavailable } from '../../packages/session-runtime/offline-session.ts';
const me = { role: 'parent', family: { id: 'family-a' }, member: { role: 'owner', state: 'active' }, children: [{ id: 'child-a' }] };
const exported = { schemaVersion: 1, child: { id: 'child-a' }, sessions: [], events: [], observations: [], confirmations: [] };
function setup(override: Partial<ProfileActionPorts> = {}) {
  const calls: string[] = [];
  const ports: ProfileActionPorts = { authenticate: async () => me, identity: async () => me, current: () => true,
    request: async (path, method) => { calls.push(method + ' ' + path); return exported; }, cleanup: async () => { calls.push('cleanup'); }, share: async () => { calls.push('share'); return 'share-sheet-closed'; }, ...override };
  return { ports, calls };
}
test('a parent identity change or backgrounding before authorization prevents any profile mutation', async () => {
  for (const override of [{ authenticate: async () => ({ ...me, family: { id: 'other' } }) }, { current: () => false }]) {
    const { ports, calls } = setup(override);
    await assert.rejects(performProfileAction('delete', 'family-a', 'child-a', ports)); assert.deepEqual(calls, []);
  }
});
test('an unconfirmed server failure preserves unsynchronized local records', async () => {
  const { ports, calls } = setup({ request: async () => { throw new Error('network'); } });
  await assert.rejects(performProfileAction('withdraw', 'family-a', 'child-a', ports), /network/); assert.deepEqual(calls, []);
});
test('a confirmed server change is cleaned even after backgrounding and reports cleanup failure accurately', async () => {
  let current = true;
  const { ports, calls } = setup({ current: () => current, request: async () => { current = false; } });
  assert.equal((await performProfileAction('withdraw', 'family-a', 'child-a', ports)).localCleared, true); assert.deepEqual(calls, ['cleanup']);
  const failed = setup({ cleanup: async () => { throw new Error('storage locked'); } });
  assert.deepEqual(await performProfileAction('delete', 'family-a', 'child-a', failed.ports), { action: 'delete', serverConfirmed: true, localCleared: false, delivery: undefined });
});
test('lost deletion receipts require an authenticated same-family absence before cleanup', async () => {
  const { ports, calls } = setup({ authenticate: async () => ({ ...me, children: [] }) });
  assert.equal((await performProfileAction('delete', 'family-a', 'child-a', ports)).localCleared, true); assert.deepEqual(calls, ['cleanup']);
  const wrong = setup({ request: async () => { throw { code: 'NOT_FOUND' }; }, identity: async () => ({ ...me, family: { id: 'other' }, children: [] }) });
  await assert.rejects(performProfileAction('delete', 'family-a', 'child-a', wrong.ports), /PARENT_IDENTITY_CHANGED/); assert.deepEqual(wrong.calls, []);
});
test('a partial or pending parent list cannot certify deletion or clear local records', async () => {
  for (const member of [{ role: 'support', state: 'active' }, { role: 'owner', state: 'pending' }]) {
    const { ports, calls } = setup({ authenticate: async () => ({ ...me, member, children: [] }) });
    await assert.rejects(performProfileAction('delete', 'family-a', 'child-a', ports), /PARENT_SCOPE_INCOMPLETE/);
    assert.deepEqual(calls, []);
  }
  const changed = setup({ request: async () => { throw { code: 'NOT_FOUND' }; }, identity: async () => ({ ...me, member: { role: 'support', state: 'active' }, children: [] }) });
  await assert.rejects(performProfileAction('delete', 'family-a', 'child-a', changed.ports), /PARENT_SCOPE_INCOMPLETE/);
  assert.deepEqual(changed.calls, []);
});
test('a lost or unreadable deletion reply is confirmed only by a fresh owner list', async () => {
  for (const cause of [new NetworkUnavailable(), { code: 'RESPONSE_UNREADABLE', status: 200 }, { code: 'REQUEST_FAILED', status: 404 }, { code: 'REQUEST_FAILED', status: 503 }]) {
    const done = setup({ request: async () => { throw cause; }, identity: async () => ({ ...me, children: [] }) });
    assert.equal((await performProfileAction('delete', 'family-a', 'child-a', done.ports)).localCleared, true);
    assert.deepEqual(done.calls, ['cleanup']);
    const pending = setup({ request: async () => { throw cause; } });
    await assert.rejects(performProfileAction('delete', 'family-a', 'child-a', pending.ports), error => error === cause);
    assert.deepEqual(pending.calls, []);
  }
});
test('a lost withdrawal reply requires an explicit stopped-collection status', async () => {
  const stopped = setup({ request: async () => { throw new NetworkUnavailable(); }, identity: async () => ({ ...me, children: [{ id: 'child-a', collectionStatus: 'collection-withdrawn' }] }) });
  assert.equal((await performProfileAction('withdraw', 'family-a', 'child-a', stopped.ports)).localCleared, true);
  assert.deepEqual(stopped.calls, ['cleanup']);
  const active = setup({ request: async () => { throw new NetworkUnavailable(); } });
  await assert.rejects(performProfileAction('withdraw', 'family-a', 'child-a', active.ports), { message: 'NETWORK_UNAVAILABLE' });
  assert.deepEqual(active.calls, []);
});
test('exports never share after backgrounding and do not imply that a share sheet saved a file', async () => {
  let current = true;
  const stale = setup({ current: () => current, request: async () => { current = false; return exported; } });
  await assert.rejects(performProfileAction('export', 'family-a', 'child-a', stale.ports), /ACTION_INTERRUPTED/); assert.deepEqual(stale.calls, []);
  const good = setup(); const result = await performProfileAction('export', 'family-a', 'child-a', good.ports);
  assert.equal(result.delivery, 'share-sheet-closed'); assert.deepEqual(good.calls, ['GET /children/child-a/export', 'share']);
});
test('local recovery export distinguishes included, empty, and unreadable device records', async () => {
  const item = { sessionId: 'session-a', events: [{ id: 'event-a' }] };
  const included = await localRecoveryForExport('this-device-only', async () => [item]);
  assert.equal(included.status, 'included'); assert.deepEqual(included.records, [item]);
  assert.match(included.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
  const empty = await localRecoveryForExport('this-browser-only', async () => []);
  assert.equal(empty.status, 'none'); assert.deepEqual(empty.records, []);
  const unavailable = await localRecoveryForExport('this-device-only', async (): Promise<typeof item[]> => { throw new Error('corrupt encrypted journal'); });
  assert.equal(unavailable.status, 'unavailable'); assert.deepEqual(unavailable.records, []);
  assert.deepEqual(JSON.parse(serializeChildExport({ ...exported, localRecovery: unavailable }, 'child-a')).localRecovery, unavailable);
});
test('the export serializer rejects other children and nested credential fields', () => {
  assert.equal(JSON.parse(serializeChildExport(exported, 'child-a')).child.id, 'child-a');
  assert.equal(JSON.parse(serializeChildExport({...exported,schemaVersion:2,verifiedConsents:[]},'child-a')).schemaVersion,2);
  assert.throws(() => serializeChildExport({...exported,schemaVersion:2},'child-a'), /EXPORT_FORMAT_INVALID/);
  assert.throws(() => serializeChildExport(exported, 'other'), /EXPORT_FORMAT_INVALID/);
  assert.throws(() => serializeChildExport({ ...exported, sessions: [{ nested: { token_hash: 'secret' } }] }, 'child-a'), /EXPORT_CONTAINS_PRIVATE_CREDENTIALS/);
  const localRecovery = { scope: 'this-browser-only', status: 'included', records: [{ sessionId: 'session-a', events: [{ id: 'event-a', seq: 1, at: 1 }] }] };
  assert.deepEqual(JSON.parse(serializeChildExport({ ...exported, localRecovery }, 'child-a')).localRecovery, localRecovery);
  assert.throws(() => serializeChildExport({ ...exported, localRecovery: { records: [{ events: [{ device_id: 'secret' }] }] } }, 'child-a'), /EXPORT_CONTAINS_PRIVATE_CREDENTIALS/);
  assert.throws(() => serializeChildExport({ ...exported, observations: [{ note: 'long' }] }, 'child-a', 100), /EXPORT_TOO_LARGE/);
  assert.doesNotThrow(() => serializeChildExport({ ...exported, observations: [{ note: 'long' }] }, 'child-a', 1000));
});
