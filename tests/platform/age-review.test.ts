import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';

let db: Database;
let clock = Date.parse('2026-10-01T08:00:00Z');
let api: ReturnType<typeof service>;
const denied = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
before(async () => {
  db = await openDatabase('memory://'); await migrate(db);
  const content = await createLocalContent(db, { now: () => clock });
  api = service(db, () => clock, content, await createSessionAuthority(db));
});
after(() => db.close());
async function fixture() {
  clock = Date.parse('2026-10-01T08:00:00Z');
  const credentials={name:`Age-${randomUUID().slice(0,8)}`,password:'Synthetic-age-passphrase!'};
  const auth = await api.setup({ ...credentials, timezone:'UTC',locale:'en',acknowledgedLocalUse:true });
  const parent = (await api.authenticate(auth.value))!;
  const child = await api.addChild(parent,{alias:'Synthetic Child',ageBand:'6-8',locale:'en',localConfirmation:true});
  return {parent,child,credentials};
}
const login=async(f:Awaited<ReturnType<typeof fixture>>)=> (await api.authenticate((await api.login(f.credentials)).value))!;
const version = (n: number) => `"${n}"`;
const start = (parent: Awaited<ReturnType<typeof fixture>>['parent'], id: string) =>
  api.start(parent,id,{task:'search',environment:TEST_ENVIRONMENT,deviceId:randomUUID()},randomUUID());

test('a due review pauses new practice; same-band confirmation is versioned and family scoped', async () => {
  const f=await fixture(); const initial=await api.ageReviewSpace(f.parent,f.child.id);
  assert.equal(initial.state,'current'); assert.equal(initial.version,1);
  clock=Date.parse(initial.dueAt)+1;
  f.parent=await login(f);
  assert.equal((await api.ageReviewSpace(f.parent,f.child.id)).state,'due');
  await assert.rejects(start(f.parent,f.child.id),denied('AGE_REVIEW_REQUIRED'));
  const other=await fixture(); await assert.rejects(api.ageReviewSpace(other.parent,f.child.id),denied('NOT_FOUND'));
  f.parent=await login(f);
  const confirmed=await api.requestAgeReview(f.parent,f.child.id,{targetAgeBand:'6-8',acknowledged:true},version(1),randomUUID());
  assert.equal(confirmed.state,'current'); assert.equal(confirmed.version,2);
  await assert.rejects(api.requestAgeReview(f.parent,f.child.id,{targetAgeBand:'9-11',acknowledged:true},version(1),randomUUID()),denied('AGE_REVIEW_VERSION_CONFLICT'));
  assert.equal((await start(f.parent,f.child.id)).session.plan.ageBand,'6-8');
});

test('a pending transition preserves signed uploads, blocks new plans and waits for unfinished sessions', async () => {
  const f=await fixture(); const old=await start(f.parent,f.child.id);
  f.parent=await login(f);
  const oldChild=(await api.authenticate(old.auth.value))!;
  const key=randomUUID();
  const pending=await api.requestAgeReview(f.parent,f.child.id,{targetAgeBand:'9-11',acknowledged:true},version(1),key);
  assert.equal(pending.state,'pending'); assert.equal(pending.unfinished.length,1);
  assert.equal((await api.requestAgeReview(f.parent,f.child.id,{targetAgeBand:'9-11',acknowledged:true},version(1),key)).version,2);
  await assert.rejects(start(f.parent,f.child.id),denied('AGE_REVIEW_REQUIRED'));
  await assert.rejects(api.applyAgeReview(f.parent,f.child.id,{acknowledged:true,localConfirmation:true},version(2)),denied('UNFINISHED_SESSIONS'));
  const trial=old.session.plan.trials[0];
  await api.append(oldChild,old.session.id,{events:[
    {id:randomUUID(),seq:1,at:0,type:'present',trialId:trial.id,presentation:{frameDeltaMs:16,assetsReady:true,method:'raf-pair'}},
    {id:randomUUID(),seq:2,at:1000,type:'interrupt',reason:'pause'},
    {id:randomUUID(),seq:3,at:2000,type:'end',reason:'child_stopped'},
  ]});
  await api.finalize(oldChild,old.session.id,{lastSeq:3});
  const applied=await api.applyAgeReview(f.parent,f.child.id,{acknowledged:true,localConfirmation:true},version(2));
  assert.equal(applied.currentAgeBand,'9-11'); assert.equal(applied.state,'current');
  assert.equal((await api.me(f.parent)).children[0].ageBand,'9-11');
  assert.equal((await db.query<{plan:{ageBand:string}}>('SELECT plan FROM sessions WHERE id=$1',[old.session.id])).rows[0].plan.ageBand,'6-8');
  assert.equal(await api.authenticate(old.auth.value),null);
  assert.equal((await start(f.parent,f.child.id)).session.plan.ageBand,'9-11');
});

test('adult transition remains pending until independent identity and rights flow exists',async()=>{
  const f=await fixture();
  const pending=await api.requestAgeReview(f.parent,f.child.id,{targetAgeBand:'18+',acknowledged:true},version(1),randomUUID());
  assert.equal(pending.state,'adult-pending');
  await assert.rejects(api.applyAgeReview(f.parent,f.child.id,{acknowledged:true,localConfirmation:true},version(2)),denied('ADULT_RIGHTS_REVIEW_REQUIRED'));
  await assert.rejects(start(f.parent,f.child.id),denied('AGE_REVIEW_REQUIRED'));
});

test('a handover is still an upload obligation until its signed record is finalized',async()=>{
  const f=await fixture();const old=await start(f.parent,f.child.id);const original=(await api.authenticate(old.auth.value))!;
  f.parent=await login(f);
  await api.requestAgeReview(f.parent,f.child.id,{targetAgeBand:'9-11',acknowledged:true},version(1),randomUUID());
  const recovery=await api.recoverySpace(f.parent,f.child.id,{deviceId:randomUUID()});
  await api.handover(f.parent,f.child.id,old.session.id,{deviceId:randomUUID(),acknowledged:true},recovery.active!.etag,randomUUID());
  assert.equal((await api.ageReviewSpace(f.parent,f.child.id)).unfinished.length,1);
  await assert.rejects(api.applyAgeReview(f.parent,f.child.id,{acknowledged:true,localConfirmation:true},version(2)),denied('UNFINISHED_SESSIONS'));
  const trial=old.session.plan.trials[0];
  await api.append(original,old.session.id,{events:[
    {id:randomUUID(),seq:1,at:0,type:'present',trialId:trial.id,presentation:{frameDeltaMs:16,assetsReady:true,method:'raf-pair'}},
    {id:randomUUID(),seq:2,at:1000,type:'interrupt',reason:'pause'},
    {id:randomUUID(),seq:3,at:2000,type:'end',reason:'child_stopped'},
  ]});
  await api.finalize(original,old.session.id,{lastSeq:3});
  assert.equal((await api.ageReviewSpace(f.parent,f.child.id)).unfinished.length,0);
  assert.equal((await api.applyAgeReview(f.parent,f.child.id,{acknowledged:true,localConfirmation:true},version(2))).currentAgeBand,'9-11');
});
