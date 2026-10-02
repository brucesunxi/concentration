import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import type { FocusService, AuthTransport } from '../../apps/api/service.ts';
import {createLocalContent} from '../../apps/api/content.ts';
import {createSessionAuthority} from '../../apps/api/session-authority.ts';
import { initialFamilyPack } from '../../apps/api/family-content.ts';
import { hashObject } from '../../packages/content/index.ts';
import { lifeTemplates } from '../../packages/family-support/catalogue.ts';
import { lifeTemplateForTask } from '../../packages/family-support/model.ts';
import { serializeChildExport } from '../../packages/session-runtime/profile-actions.ts';

let db: Database, api: FocusService;
test('each practice task opens the matching age-specific activity without changing its content',()=>{
  for(const age of ['6-8','9-11','12-14','15-17'] as const)for(const template of lifeTemplates(age))
    assert.equal(lifeTemplateForTask[template.task],template.id);
});
let localContent:Awaited<ReturnType<typeof createLocalContent>>,sessionAuthority:Awaited<ReturnType<typeof createSessionAuthority>>;
const now = Date.parse('2026-09-30T12:00:00Z');
before(async () => { db = await openDatabase('memory://'); await migrate(db); localContent=await createLocalContent(db,{now:()=>now});sessionAuthority=await createSessionAuthority(db);api = service(db, () => now,localContent,sessionAuthority); });
after(async () => { await db.close(); });
const suggested = { contentHash:await hashObject(initialFamilyPack('15-17')), intent: 'suggest', templateId: 'steps', support: 'ask-first' };
const chosen = { ...suggested, intent: 'choose' };
const reflection = { outcome: 'not-today', helpful: 'unsure', next: 'rest' };
const status = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
async function family(transport: AuthTransport = 'web') {
  const name = 'Life-test-' + randomUUID().slice(0, 8), password = 'synthetic-life-password';
  const auth = await api.setup({ name, password, locale: 'en', timezone: 'America/New_York', acknowledgedLocalUse: true }, transport);
  const p = (await api.authenticate(auth.value, transport))!;
  const c = await api.addChild(p, { alias: 'Fictional explorer', ageBand: '15-17', locale: 'en', localConfirmation: true });
  return { name, password, transport, auth, p, c };
}
async function parent(f: Awaited<ReturnType<typeof family>>) { return (await api.authenticate((await api.login({ name: f.name, password: f.password }, f.transport)).value, f.transport))!; }
async function enter(f: Awaited<ReturnType<typeof family>>) { const { auth } = await api.enterChild(f.p, f.c.id); return (await api.authenticate(auth.value, f.transport))!; }

test('entering a child space atomically rotates credentials without starting a practice, for both transports', async () => {
  for (const transport of ['web', 'native'] as const) {
    const f = await family(transport);
    const { auth, child } = await api.enterChild(f.p, f.c.id);
    assert.equal(child.id, f.c.id); assert.equal(await api.authenticate(f.auth.value, transport), null);
    const cp = (await api.authenticate(auth.value, transport))!;
    assert.equal(cp.scope, 'child'); assert.equal(cp.child_id, f.c.id); assert.equal(cp.transport, transport);
    assert.equal(await api.authenticate(auth.value, transport === 'web' ? 'native' : 'web'), null);
    assert.equal(await api.active(cp), null);
    const report = await api.report(await parent(f), f.c.id);
    assert.equal(report.child.completedSessions, 0); assert.equal(report.sessions.length, 0);
    await assert.rejects(api.enterChild(f.p, f.c.id), status('UNAUTHENTICATED'));
    await assert.rejects(api.enterChild(cp, f.c.id), status('PARENT_REQUIRED'));
  }
});

test('failure during child credential creation leaves the parent login and database unchanged', async () => {
  const f = await family();
  const broken: Database = { ...db, transaction: fn => db.transaction(tx => fn({ query: (sql, values) => {
    if (sql.startsWith('INSERT INTO auth_sessions')) return Promise.reject(new Error('simulated token storage failure'));
    return tx.query(sql, values);
  } })) };
  await assert.rejects(service(broken, () => now,localContent,sessionAuthority).enterChild(f.p, f.c.id), /simulated token/);
  assert.ok(await api.authenticate(f.auth.value));
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int n FROM auth_sessions WHERE child_id=$1', [f.c.id])).rows[0].n, 0);
});

test('a suggestion requires a child-space choice and reflection; records cannot advance practice scores or courses', async () => {
  const f = await family();
  await assert.rejects(api.createLifeGoal(f.p, f.c.id, chosen, randomUUID()), status('CHILD_REQUIRED'));
  const proposal = (await api.createLifeGoal(f.p, f.c.id, suggested, randomUUID())).goal;
  assert.equal(proposal.state, 'proposed'); assert.equal(proposal.version, 1);
  assert.deepEqual(proposal.template, initialFamilyPack('15-17').templates.find(t => t.id === 'steps'));
  const cp = await enter(f), p = await parent(f);
  await assert.rejects(api.createLifeGoal(cp, f.c.id, suggested, randomUUID()), status('PARENT_REQUIRED'));
  await assert.rejects(api.actLifeGoal(p, f.c.id, proposal.id, { action: 'accept', support: 'space' }, '"1"', randomUUID()), status('CHILD_REQUIRED'));
  const active = (await api.actLifeGoal(cp, f.c.id, proposal.id, { action: 'accept', support: 'space' }, '"1"', randomUUID())).goal;
  assert.equal(active.state, 'active'); assert.equal(active.support, 'space'); assert.equal(active.version, 2);
  await assert.rejects(api.actLifeGoal(p, f.c.id, proposal.id, { action: 'reflect', sharing: 'family', reflection }, '"2"', randomUUID()), status('CHILD_REQUIRED'));
  const done = (await api.actLifeGoal(cp, f.c.id, proposal.id, { action: 'reflect', sharing: 'family', reflection }, '"2"', randomUUID())).goal;
  assert.equal(done.state, 'reflected'); assert.deepEqual(done.reflection, reflection);
  const report = await api.report(p, f.c.id), weekly = await api.weekly(p, f.c.id), exported = await api.exportChild(p, f.c.id);
  assert.equal(report.child.completedSessions, 0); assert.equal(report.child.course.unit, 0); assert.equal(report.observationCount, 0);
  assert.equal(weekly.coverage.completed, 0); assert.equal(weekly.life.reduce((n, item) => n + item.current.count, 0), 0);
  assert.equal(exported.life.goals.length, 1);
  assert.deepEqual(exported.life.actions.map(item => item.version), [1, 2, 3]);
  assert.deepEqual(exported.life.actions.map(item => item.actor_scope), ['parent', 'child', 'child']);
  assert.equal(JSON.parse(serializeChildExport(exported, f.c.id)).life.goals[0].state, 'reflected');
});

test('family and sibling boundaries apply to reads, writes, retries and child entry', async () => {
  const a = await family(), b = await family();
  const sibling = await api.addChild(a.p, { alias: 'Fictional sibling', ageBand: '6-8', locale: 'zh-CN', localConfirmation: true });
  const key = randomUUID(), goal = (await api.createLifeGoal(a.p, a.c.id, suggested, key)).goal;
  const cp = await enter(a);
  for (const [scope, id] of [[b.p, a.c.id], [cp, sibling.id]] as const) {
    await assert.rejects(api.lifeSpace(scope, id), status('NOT_FOUND'));
    await assert.rejects(api.createLifeGoal(scope, id, { ...suggested, intent: scope.scope === 'child' ? 'choose' : 'suggest' }, key), status('NOT_FOUND'));
    await assert.rejects(api.actLifeGoal(scope, id, goal.id, { action: 'stop' }, '"1"', randomUUID()), status('NOT_FOUND'));
  }
  await assert.rejects(api.enterChild(b.p, a.c.id), status('NOT_FOUND'));
  const p = await parent(a);
  await assert.rejects(api.actLifeGoal(p, sibling.id, goal.id, { action: 'stop' }, '"1"', randomUUID()), status('NOT_FOUND'));
  assert.equal((await api.lifeSpace(cp, a.c.id)).role, 'child');
});

test('concurrent creation permits one open goal and exact retries do not duplicate history', async () => {
  const f = await family(), key = randomUUID();
  const replies = await Promise.all([api.createLifeGoal(f.p, f.c.id, suggested, key), api.createLifeGoal(f.p, f.c.id, suggested, key)]);
  assert.equal(replies[0].goal.id, replies[1].goal.id); assert.equal(replies.filter(r => r.replayed).length, 1);
  await assert.rejects(api.createLifeGoal(f.p, f.c.id, { ...suggested, support: 'together' }, key), status('IDEMPOTENCY_CONFLICT'));
  await api.actLifeGoal(f.p, f.c.id, replies[0].goal.id, { action: 'stop' }, '"1"', randomUUID());
  const race = await Promise.allSettled([api.createLifeGoal(f.p, f.c.id, suggested, randomUUID()), api.createLifeGoal(f.p, f.c.id, suggested, randomUUID())]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  const failure = race.find(r => r.status === 'rejected'); assert.ok(failure?.status === 'rejected' && status('GOAL_EXISTS')(failure.reason));
  const space = await api.lifeSpace(f.p, f.c.id); assert.equal(space.total, 2);
  assert.equal(space.goals.filter(g => ['active', 'proposed'].includes(g.state)).length, 1);
});

test('version conflicts preserve the winning choice and receipt retries return current state without overwriting it', async () => {
  const f = await family(), createKey = randomUUID();
  const goal = (await api.createLifeGoal(f.p, f.c.id, suggested, createKey)).goal, cp = await enter(f);
  const key = randomUUID();
  const accept = { action: 'accept', support: 'together' };
  await api.actLifeGoal(cp, f.c.id, goal.id, accept, '"1"', key);
  await assert.rejects(api.actLifeGoal(cp, f.c.id, goal.id, { action: 'decline' }, '"1"', randomUUID()), status('GOAL_CONFLICT'));
  await assert.rejects(api.actLifeGoal(cp, f.c.id, goal.id, { ...accept, support: 'space' }, '"1"', key), status('IDEMPOTENCY_CONFLICT'));
  await api.actLifeGoal(cp, f.c.id, goal.id, { action: 'stop' }, '"2"', randomUUID());
  const retried = await api.actLifeGoal(cp, f.c.id, goal.id, accept, '"1"', key);
  assert.equal(retried.replayed, true); assert.equal(retried.goal.state, 'stopped'); assert.equal(retried.goal.version, 3);
  const p = await parent(f);
  assert.equal((await api.createLifeGoal(p, f.c.id, suggested, createKey)).goal.state, 'stopped');
  await assert.rejects(api.actLifeGoal(cp, f.c.id, goal.id, { action: 'reflect', sharing: 'family', reflection }, '"3"', randomUUID()), status('GOAL_CLOSED'));
  const next = (await api.createLifeGoal(cp, f.c.id, chosen, randomUUID())).goal;
  assert.equal(next.state, 'active');
  const stopKey = randomUUID();
  await api.actLifeGoal(cp, f.c.id, next.id, { action: 'stop' }, '"1"', stopKey);
  await assert.rejects(api.actLifeGoal(p, f.c.id, next.id, { action: 'stop' }, '"1"', stopKey), status('IDEMPOTENCY_CONFLICT'));
  assert.equal((await api.exportChild(p, f.c.id)).life.actions.length, 5);
});

test('strict schemas and state preconditions reject unintended data without changing the goal', async () => {
  const f = await family();
  await assert.rejects(api.createLifeGoal(f.p, f.c.id, { ...suggested, notes: 'unwanted personal data' }, randomUUID()));
  await assert.rejects(api.createLifeGoal(f.p, f.c.id, suggested, 'short'), status('INVALID_IDEMPOTENCY_KEY'));
  const goal = (await api.createLifeGoal(f.p, f.c.id, suggested, randomUUID())).goal, cp = await enter(f);
  await assert.rejects(api.actLifeGoal(cp, f.c.id, goal.id, { action: 'stop' }, undefined, randomUUID()), status('PRECONDITION_REQUIRED'));
  for (const match of ['', '1', '"0"', 'W/"1"', '*', '"1", "2"']) await assert.rejects(api.actLifeGoal(cp, f.c.id, goal.id, { action: 'stop' }, match, randomUUID()), status('INVALID_PRECONDITION'));
  await assert.rejects(api.actLifeGoal(cp, f.c.id, goal.id, { action: 'reflect', sharing: 'family', reflection }, '"1"', randomUUID()), status('GOAL_CONFLICT'));
  await assert.rejects(api.actLifeGoal(cp, f.c.id, goal.id, { action: 'reflect', sharing: 'family', reflection: { ...reflection, notes: 'unwanted' } }, '"1"', randomUUID()));
  assert.equal((await api.lifeSpace(cp, f.c.id)).goals[0].version, 1);
  const declined = await api.actLifeGoal(cp, f.c.id, goal.id, { action: 'decline' }, '"1"', randomUUID());
  assert.equal(declined.goal.state, 'declined');
  assert.equal((await api.exportChild(await parent(f), f.c.id)).life.actions.length, 2);
});

test('withdrawal closes an open goal, revokes child entry and takes precedence over successful old receipts', async () => {
  const f = await family(), cp = await enter(f), p = await parent(f);
  const key = randomUUID(), goal = (await api.createLifeGoal(cp, f.c.id, chosen, key)).goal;
  await api.withdraw(p, f.c.id); await api.withdraw(p, f.c.id);
  const space = await api.lifeSpace(p, f.c.id);
  assert.equal(space.collectionActive, false); assert.equal(space.goals[0].state, 'stopped'); assert.equal(space.goals[0].closedReason, 'withdrawn');
  assert.equal(space.goals[0].version, 2); assert.equal((await api.exportChild(p, f.c.id)).life.actions.length, 2);
  await assert.rejects(api.createLifeGoal(cp, f.c.id, chosen, key), status('UNAUTHENTICATED'));
  await assert.rejects(api.actLifeGoal(cp, f.c.id, goal.id, { action: 'reflect', sharing: 'family', reflection }, '"1"', randomUUID()), status('UNAUTHENTICATED'));
  await assert.rejects(api.enterChild(p, f.c.id), status('CONSENT_REVOKED'));
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int n FROM auth_sessions WHERE child_id=$1', [f.c.id])).rows[0].n, 0);
});

test('export retains all life goals beyond the display limit, and deletion cascades without leaking request secrets', async () => {
  const f = await family(), cp = await enter(f), p = await parent(f), keys: string[] = [];
  for (let i = 0; i < 21; i++) {
    const key = randomUUID(); keys.push(key);
    const goal = (await api.createLifeGoal(cp, f.c.id, chosen, key)).goal;
    await api.actLifeGoal(cp, f.c.id, goal.id, { action: 'stop' }, '"1"', randomUUID());
  }
  const current = (await api.createLifeGoal(cp, f.c.id, chosen, randomUUID())).goal;
  // A server clock correction must never hide the one open goal behind history.
  await db.query('UPDATE life_goals SET created_at=$2 WHERE id=$1', [current.id, '2000-01-01T00:00:00Z']);
  await migrate(db);
  const space = await api.lifeSpace(p, f.c.id), exported = await api.exportChild(p, f.c.id);
  assert.equal(space.total, 22); assert.equal(space.goals.length, 20); assert.equal(space.goals[0].id, current.id);
  assert.equal(exported.life.goals.length, 22); assert.equal(exported.life.actions.length, 43);
  const json = serializeChildExport(exported, f.c.id);
  for (const key of [...keys, 'request_key', 'request_hash', 'token_hash', 'csrf']) assert.equal(json.includes(key), false);
  await api.deleteChild(p, f.c.id);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int n FROM life_goals WHERE child_id=$1', [f.c.id])).rows[0].n, 0);
  const ids = exported.life.goals.map(g => g.id);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int n FROM life_goal_actions WHERE goal_id=ANY($1::uuid[])', [ids])).rows[0].n, 0);
  await assert.rejects(api.createLifeGoal(cp, f.c.id, chosen, keys[0]), status('UNAUTHENTICATED'));
});

test('every age requires an explicit sharing choice, and a no-save reflection stores no answers in records or history',async()=>{
  for(const ageBand of ['6-8','9-11','12-14','15-17']){
    const f=await family();await db.query('UPDATE children SET age_band=$2 WHERE id=$1',[f.c.id,ageBand]);const cp=await enter(f),p=await parent(f);
    const goal=(await api.createLifeGoal(cp,f.c.id,{...chosen,contentHash:(await api.lifeSpace(cp,f.c.id)).content.hash},randomUUID())).goal;
    await assert.rejects(api.actLifeGoal(cp,f.c.id,goal.id,{action:'reflect',reflection},'"1"',randomUUID()),status('SHARING_CHOICE_REQUIRED'));
    await assert.rejects(api.actLifeGoal(cp,f.c.id,goal.id,{action:'reflect',sharing:'none',reflection},'"1"',randomUUID()));
    const saved=(await api.actLifeGoal(cp,f.c.id,goal.id,{action:'reflect',sharing:'none'},'"1"',randomUUID())).goal;
    assert.equal(saved.state,'reflected');assert.equal(saved.reflection,null);assert.equal(saved.reflectionSharing,'not-stored');
    const out=(await api.exportChild(p,f.c.id)).life;
    assert.equal(out.goals[0].reflection,null);assert.deepEqual(out.actions.at(-1)!.payload,{action:'reflect',sharing:'none'});
    assert.equal(JSON.stringify(out).includes('"helpful"'),false);
    assert.equal((await api.lifeSpace(p,f.c.id)).sharingPolicy,'reflection-sharing-1');
  }
});

test('withdrawn reflection clears live answers, history copies and answer-derived hashes; old retries cannot restore it',async()=>{
  const f=await family(),cp=await enter(f),p=await parent(f);
  const goal=(await api.createLifeGoal(cp,f.c.id,chosen,randomUUID())).goal;
  const key=randomUUID(),shared={action:'reflect',sharing:'family',reflection};
  const saved=(await api.actLifeGoal(cp,f.c.id,goal.id,shared,'"1"',key)).goal;
  assert.equal(saved.reflectionSharing,'family');assert.deepEqual((await api.lifeSpace(p,f.c.id)).goals[0].reflection,reflection);
  const removeKey=randomUUID(),removed=await api.actLifeGoal(cp,f.c.id,goal.id,{action:'unshare'},'"2"',removeKey);
  assert.equal(removed.goal.reflectionSharing,'withdrawn');assert.equal(removed.goal.reflection,null);assert.equal(removed.goal.version,3);
  assert.equal((await api.actLifeGoal(cp,f.c.id,goal.id,{action:'unshare'},'"2"',removeKey)).replayed,true);
  await assert.rejects(api.actLifeGoal(cp,f.c.id,goal.id,shared,'"1"',key),status('REFLECTION_WITHDRAWN'));
  await assert.rejects(api.actLifeGoal(cp,f.c.id,goal.id,shared,'"3"',randomUUID()),status('GOAL_CLOSED'));
  const row=(await db.query<{payload:unknown;request_hash:string|null;answers_removed:boolean}>('SELECT payload,request_hash,answers_removed FROM life_goal_actions WHERE goal_id=$1 AND request_key=$2',[goal.id,key])).rows[0];
  assert.equal(row.request_hash,null);assert.equal(row.answers_removed,true);assert.deepEqual(row.payload,{action:'reflect',sharing:'withdrawn',answersRemoved:true});
  const out=(await api.exportChild(p,f.c.id)).life;
  assert.equal(JSON.stringify(out).includes('"helpful"'),false);assert.equal(out.actions.length,3);assert.equal(out.goals[0].state,'reflected');
  assert.equal((await api.report(p,f.c.id)).child.course.unit,0);
});

test('sharing removal enforces profile scope, fresh parent identity, version races and continued access after collection stops',async()=>{
  const f=await family(),other=await family(),cp=await enter(f),p=await parent(f);
  const goal=(await api.createLifeGoal(cp,f.c.id,chosen,randomUUID())).goal;
  await api.actLifeGoal(cp,f.c.id,goal.id,{action:'reflect',sharing:'family',reflection},'"1"',randomUUID());
  await assert.rejects(api.actLifeGoal(other.p,f.c.id,goal.id,{action:'unshare'},'"2"',randomUUID()),status('NOT_FOUND'));
  await assert.rejects(api.actLifeGoal(p,f.c.id,goal.id,{action:'reflect',sharing:'family',reflection},'"2"',randomUUID()),status('CHILD_REQUIRED'));
  await assert.rejects(api.actLifeGoal(cp,f.c.id,goal.id,{action:'unshare'},'"1"',randomUUID()),status('GOAL_CONFLICT'));
  const later=service(db,()=>now+11*60000,localContent,sessionAuthority);
  await assert.rejects(later.actLifeGoal(p,f.c.id,goal.id,{action:'unshare'},'"2"',randomUUID()),status('REAUTH_REQUIRED'));
  await api.withdraw(p,f.c.id);assert.equal(await api.authenticate((await api.login({name:f.name,password:f.password})).value)!==null,true);
  const current=await parent(f);
  const removed=await api.actLifeGoal(current,f.c.id,goal.id,{action:'unshare'},'"2"',randomUUID());assert.equal(removed.goal.reflection,null);
  assert.equal((await api.lifeSpace(current,f.c.id)).collectionActive,false);
});

test('racing removals serialize and a failure after answer redaction rolls back the whole removal',async()=>{
  const f=await family(),cp=await enter(f);
  const goal=(await api.createLifeGoal(cp,f.c.id,chosen,randomUUID())).goal;
  await api.actLifeGoal(cp,f.c.id,goal.id,{action:'reflect',sharing:'family',reflection},'"1"',randomUUID());
  const broken:Database={...db,transaction:fn=>db.transaction(tx=>fn({query:(sql,values)=>sql.startsWith('INSERT INTO life_goal_actions')?Promise.reject(new Error('simulated audit write failure')):tx.query(sql,values)}))};
  await assert.rejects(service(broken,()=>now,localContent,sessionAuthority).actLifeGoal(cp,f.c.id,goal.id,{action:'unshare'},'"2"',randomUUID()),/simulated audit/);
  assert.deepEqual((await api.lifeSpace(cp,f.c.id)).goals[0].reflection,reflection);
  assert.ok((await db.query('SELECT id FROM life_goal_actions WHERE goal_id=$1 AND payload ? \'reflection\' AND request_hash IS NOT NULL',[goal.id])).rows.length);
  const race=await Promise.allSettled([api.actLifeGoal(cp,f.c.id,goal.id,{action:'unshare'},'"2"',randomUUID()),api.actLifeGoal(cp,f.c.id,goal.id,{action:'unshare'},'"2"',randomUUID())]);
  assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal((await api.lifeSpace(cp,f.c.id)).goals[0].version,3);
});
