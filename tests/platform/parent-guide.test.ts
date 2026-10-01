import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeParentGuide } from '../../packages/family-support/parent-guide.ts';
import { ParentGuideClient } from '../../packages/family-support/parent-guide-client.ts';
import type { GuideState } from '../../packages/family-support/parent-guide-client.ts';
import type { LifeRequest } from '../../packages/family-support/client.ts';
import type { ParentGuide } from '../../packages/family-support/parent-guide-model.ts';
import { lifeTemplates } from '../../packages/family-support/catalogue.ts';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import type { FocusService } from '../../apps/api/service.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';

let db: Database, api: FocusService;
const now = Date.parse('2026-10-01T08:00:00Z');
before(async () => {
  db = await openDatabase('memory://'); await migrate(db);
  api = service(db, () => now, await createLocalContent(db, { now: () => now }), await createSessionAuthority(db));
});
after(async () => db.close());
const rejected = (code: string) => (e: unknown) => e instanceof ApiError && e.code === code;
async function family(ageBand: '6-8' | '9-11' | '12-14' | '15-17' = '15-17') {
  const credentials = { name: 'Guide-' + randomUUID().slice(0, 8), password: 'Synthetic-guide-2026!' };
  const auth = await api.setup({ ...credentials, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
  const parent = (await api.authenticate(auth.value))!;
  const child = await api.addChild(parent, { alias: 'Synthetic profile', ageBand, locale: 'en', localConfirmation: true });
  return { parent, child, credentials };
}

test('all four age groups have bilingual original drafts with valid everyday links and visibly unreviewed status', () => {
  const examples: string[][] = [];
  for (const age of ['6-8', '9-11', '12-14', '15-17'] as const) {
    const guide = makeParentGuide('child', age, 0, true);
    assert.equal(guide.review, 'unreviewed'); assert.equal(guide.lessons.length, 9);
    assert.deepEqual(guide.lessons.map(x => x.stage), [0,1,2,3,4,5,6,7,8]);
    for (const lesson of guide.lessons) {
      for (const text of [lesson.title, lesson.purpose, lesson.invitation, lesson.example, ...lesson.steps, lesson.fallback, lesson.notice]) {
        for (const language of ['zh-CN', 'en'] as const) assert.ok(text[language].trim().length > 0);
      }
      assert.equal(lesson.steps.length, 3);
      if (lesson.templateId) assert.equal(lifeTemplates(age).find(x => x.id === lesson.templateId)?.task, lesson.task);
      else assert.equal(lesson.stage, 0);
    }
    examples.push(guide.lessons.map(x => x.example.en));
  }
  // Age adaptation is present for every section, not only for its title.
  for (let stage = 0; stage <= 8; stage++) assert.equal(new Set(examples.map(row => row[stage])).size, 4);
});

test('recommendations follow all 25 course boundaries, never the calendar or free-choice completion count', async () => {
  const { parent, child } = await family();
  for (let units = 0; units <= 24; units++) {
    await db.query('UPDATE children SET course_units=$2,completed_sessions=99 WHERE id=$1', [child.id, units]);
    const guide = await api.parentGuide(parent, child.id);
    assert.equal(guide.recommended, Math.min(8, Math.floor(units / 3) + 1));
    assert.equal(guide.lessons.find(x => x.stage === guide.recommended)?.task, guide.course.task);
    assert.equal(guide.course.weekDone, units === 24 ? 3 : units % 3);
    assert.equal(guide.course.complete, units === 24);
  }
});

test('reading all lessons creates no goal, course progress, observation or exported read history', async () => {
  const f = await family('6-8'), before = await api.exportChild(f.parent, f.child.id);
  for (let i = 0; i < 9; i++) await api.parentGuide(f.parent, f.child.id);
  assert.deepEqual(await api.exportChild(f.parent, f.child.id), before);
});

test('guide access requires the owning parent and uses the requested sibling age', async () => {
  const f = await family('6-8'), other = await family();
  const sibling = await api.addChild(f.parent, { alias: 'Teen sibling', ageBand: '15-17', locale: 'en', localConfirmation: true });
  assert.equal((await api.parentGuide(f.parent, sibling.id)).ageBand, '15-17');
  await assert.rejects(api.parentGuide(other.parent, f.child.id), rejected('NOT_FOUND'));
  const entered = await api.enterChild(f.parent, f.child.id), child = (await api.authenticate(entered.auth.value))!;
  await assert.rejects(api.parentGuide(child, f.child.id), rejected('PARENT_REQUIRED'));
  await assert.rejects(api.parentGuide(child, sibling.id), rejected('PARENT_REQUIRED'));
});

test('withdrawal preserves readable guidance, blocks suggested goal writes and deletion removes guide access', async () => {
  const f = await family(); await api.withdraw(f.parent, f.child.id);
  const guide = await api.parentGuide(f.parent, f.child.id);
  assert.equal(guide.collectionActive, false); assert.equal(guide.lessons.length, 9);
  await assert.rejects(api.createLifeGoal(f.parent, f.child.id, { contentHash:guide.content.hash,intent: 'suggest', templateId: 'find', support: 'ask-first' }, randomUUID()), rejected('CONSENT_REVOKED'));
  await api.deleteChild(f.parent, f.child.id);
  await assert.rejects(api.parentGuide(f.parent, f.child.id), rejected('NOT_FOUND'));
});

const draft = ():ParentGuide => ({...makeParentGuide('guide-child', '9-11', 3, true),content:{hash:'a'.repeat(64),version:'1.0.0-preview',state:'available',review:'unreviewed'}});
function requester(run: () => Promise<unknown>): LifeRequest { return async <T>() => await run() as T; }
test('an unmounted guide ignores a late response and makes no further requests', async () => {
  const updates: GuideState[] = []; let resolve!: (x: ParentGuide) => void, calls = 0;
  const client = new ParentGuideClient('guide-child', requester(() => { calls++; return new Promise(done => resolve = done); }), state => updates.push(state));
  const pending = client.load(); client.dispose(); const count = updates.length;
  resolve(draft()); await pending; await client.load();
  assert.equal(updates.length, count); assert.equal(calls, 1); assert.equal(client.state.data, null);
});

test('guide refresh clears a stale family snapshot on access and network failures, then permits retry', async () => {
  let response: unknown = draft();
  const client = new ParentGuideClient('guide-child', requester(async () => { if (response instanceof Error) throw response; return response; }), () => {});
  await client.load(); assert.ok(client.state.data);
  response = Object.assign(new Error('no parent'), { code: 'PARENT_REQUIRED' }); await client.load();
  assert.equal(client.state.error, 'PARENT_REQUIRED'); assert.equal(client.state.data, null);
  response = draft(); await client.load(); assert.ok(client.state.data);
  response = new Error('offline'); await client.load(); assert.equal(client.state.error, 'LOAD_FAILED'); assert.equal(client.state.data, null);
  response = { ...draft(), collectionActive: false }; await client.load(); assert.equal((client.state as GuideState).data?.collectionActive, false);
});

test('a mismatched profile or preview contract cannot populate a guide view', async () => {
  for (const [value, code] of [[{ ...draft(), childId: 'other' }, 'ACCESS_CHANGED'], [{ ...draft(), version: 'old' }, 'GUIDE_UPDATE_REQUIRED'], [{ ...draft(), content: { ...draft().content, state:'recalled' } }, 'GUIDE_UPDATE_REQUIRED']] as const) {
    const client = new ParentGuideClient('guide-child', requester(async () => value), () => {}); await client.load();
    assert.equal(client.state.error, code); assert.equal(client.state.data, null);
  }
});
