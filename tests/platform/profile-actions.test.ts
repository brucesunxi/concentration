import test from 'node:test';
import assert from 'node:assert/strict';
import { performProfileAction, serializeChildExport } from '../../packages/session-runtime/profile-actions.ts';
import type { ProfileActionPorts } from '../../packages/session-runtime/profile-actions.ts';
const me = { role: 'parent', family: { id: 'family-a' }, children: [{ id: 'child-a' }] };
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
test('exports never share after backgrounding and do not imply that a share sheet saved a file', async () => {
  let current = true;
  const stale = setup({ current: () => current, request: async () => { current = false; return exported; } });
  await assert.rejects(performProfileAction('export', 'family-a', 'child-a', stale.ports), /ACTION_INTERRUPTED/); assert.deepEqual(stale.calls, []);
  const good = setup(); const result = await performProfileAction('export', 'family-a', 'child-a', good.ports);
  assert.equal(result.delivery, 'share-sheet-closed'); assert.deepEqual(good.calls, ['GET /children/child-a/export', 'share']);
});
test('the export serializer rejects other children and nested credential fields', () => {
  assert.equal(JSON.parse(serializeChildExport(exported, 'child-a')).child.id, 'child-a');
  assert.equal(JSON.parse(serializeChildExport({...exported,schemaVersion:2,verifiedConsents:[]},'child-a')).schemaVersion,2);
  assert.throws(() => serializeChildExport({...exported,schemaVersion:2},'child-a'), /EXPORT_FORMAT_INVALID/);
  assert.throws(() => serializeChildExport(exported, 'other'), /EXPORT_FORMAT_INVALID/);
  assert.throws(() => serializeChildExport({ ...exported, sessions: [{ nested: { token_hash: 'secret' } }] }, 'child-a'), /EXPORT_CONTAINS_PRIVATE_CREDENTIALS/);
});
