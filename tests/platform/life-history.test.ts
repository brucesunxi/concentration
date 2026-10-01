import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase,migrate} from '../../apps/api/database.ts';
import type {Database} from '../../apps/api/database.ts';
import {service} from '../../apps/api/service.ts';
import type {FocusService} from '../../apps/api/service.ts';
import {openGoal} from '../../packages/family-support/model.ts';

let db:Database,api:FocusService;
before(async()=>{db=await openDatabase('memory://');await migrate(db);api=service(db);});
after(()=>db.close());
const rejected=(code:string)=>(error:unknown)=>(error as {code?:string}).code===code;
async function fixture() {
  const credentials={name:'LifeHistory-'+randomUUID().slice(0,8),password:'Synthetic-life-history-2026!'};
  const auth=await api.setup({...credentials,timezone:'UTC',locale:'en',acknowledgedLocalUse:true});
  const original=(await api.authenticate(auth.value))!;
  const c=await api.addChild(original,{alias:'Synthetic teen',ageBand:'15-17',locale:'en',localConfirmation:true});
  const entry=await api.enterChild(original,c.id),cp=(await api.authenticate(entry.auth.value))!;
  const p=(await api.authenticate((await api.login(credentials)).value))!;
  const contentHash=(await api.lifeSpace(cp,c.id)).content.hash!;
  return {credentials,p,cp,c,contentHash,original};
}
async function seed(f:Awaited<ReturnType<typeof fixture>>,count:number) {
  const goal=(await api.createLifeGoal(f.cp,f.c.id,{intent:'choose',templateId:'steps',support:'space',contentHash:f.contentHash},randomUUID())).goal;
  await api.actLifeGoal(f.cp,f.c.id,goal.id,{action:'reflect',sharing:'family',reflection:{outcome:'partly',helpful:'unsure',next:'rest'}},'"1"',randomUUID());
  await db.query("UPDATE life_goals SET created_at='2026-09-01T10:00:00Z' WHERE id=$1",[goal.id]);
  // Synthetic closed records exercise database precision and paging; they are
  // not family-use or training-effect evidence.
  if(count>1)await db.query(`INSERT INTO life_goals(id,child_id,version,state,template,support,created_by,reflection,reflection_sharing,created_at,updated_at,request_key,request_hash,content_hash)
    SELECT gen_random_uuid(),child_id,version,state,template,support,created_by,reflection,reflection_sharing,
      created_at+(i/3)*interval '1 microsecond',updated_at,gen_random_uuid()::text,'synthetic-clone',content_hash
    FROM life_goals CROSS JOIN generate_series(1,$2::int) i WHERE id=$1`,[goal.id,count-1]);
}
test('closed life history preserves tied microseconds while the oldest-dated open goal remains on every page',async()=>{
  const f=await fixture();await seed(f,47);
  const current=(await api.createLifeGoal(f.cp,f.c.id,{intent:'choose',templateId:'find',support:'space',contentHash:f.contentHash},randomUUID())).goal;
  await db.query("UPDATE life_goals SET created_at='2000-01-01T00:00:00Z' WHERE id=$1",[current.id]);
  const expected=(await db.query<{id:string}>("SELECT id FROM life_goals WHERE child_id=$1 AND state NOT IN ('active','proposed') ORDER BY created_at DESC,id DESC",[f.c.id])).rows.map(r=>r.id);
  let cursor:string|null=null;const ids:string[]=[],counts:number[]=[];
  do {const page=await api.lifeHistory(f.p,f.c.id,cursor?{cursor}:{});assert.equal(page.goals[0].id,current.id);assert.equal(page.total,48);assert.equal(page.history.version,'life-history-1');
    const history=page.goals.filter(g=>!openGoal(g));ids.push(...history.map(g=>g.id));counts.push(history.length);cursor=page.history.nextCursor;
  }while(cursor);
  assert.deepEqual(counts,[20,20,7]);assert.deepEqual(ids,expected);assert.equal(new Set(ids).size,47);
  const legacy=await api.lifeSpace(f.p,f.c.id);assert.equal(legacy.goals.length,20);assert.equal(legacy.goals[0].id,current.id);assert.equal('history' in legacy,false);
});
test('boundary deletion and newer closure preserve older positions across a new service instance',async()=>{
  const f=await fixture();await seed(f,25);const first=await api.lifeHistory(f.p,f.c.id),cursor=first.history.nextCursor!;
  const expected=(await api.lifeHistory(f.p,f.c.id,{cursor})).goals.map(g=>g.id);
  await db.query('DELETE FROM life_goals WHERE id=$1',[first.goals.at(-1)!.id]);
  const goal=(await api.createLifeGoal(f.cp,f.c.id,{intent:'choose',templateId:'find',support:'space',contentHash:f.contentHash},randomUUID())).goal;
  await api.actLifeGoal(f.cp,f.c.id,goal.id,{action:'stop'},'"1"',randomUUID());
  const restarted=service(db),older=await restarted.lifeHistory(f.cp,f.c.id,{cursor});assert.deepEqual(older.goals.map(g=>g.id),expected);assert.equal(older.history.nextCursor,null);
});
test('life history cursors enforce profile and kind; reads retain owner and child-space permissions',async()=>{
  const f=await fixture(),other=await fixture();await seed(f,21);const cursor=(await api.lifeHistory(f.p,f.c.id)).history.nextCursor!;
  const sibling=await api.addChild(f.p,{alias:'Synthetic sibling',ageBand:'6-8',locale:'en',localConfirmation:true});
  await assert.rejects(api.lifeHistory(other.p,f.c.id,{cursor}),rejected('NOT_FOUND'));
  await assert.rejects(api.lifeHistory(f.cp,sibling.id,{cursor}),rejected('NOT_FOUND'));
  await assert.rejects(api.lifeHistory(f.p,sibling.id,{cursor}),rejected('INVALID_LIFE_HISTORY_CURSOR'));
  await assert.rejects(api.lifeHistory(f.original,f.c.id,{cursor}),rejected('UNAUTHENTICATED'));
  const wrongKind=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(cursor,'base64url').toString()),kind:'observations'})).toString('base64url');
  for(const value of ['%%%','e30',wrongKind])await assert.rejects(api.lifeHistory(f.p,f.c.id,{cursor:value}),rejected('INVALID_LIFE_HISTORY_CURSOR'));
  for(const query of [{limit:100},{cursor:''},{cursor:'x'.repeat(513)},{cursor:[cursor,cursor]}])await assert.rejects(api.lifeHistory(f.p,f.c.id,query));
  const invite=await api.inviteMember(f.p,{childIds:[f.c.id],acknowledged:true},randomUUID());
  const joined=await api.join({code:invite.code,loginName:'life-helper',displayName:'Synthetic helper',password:'Synthetic-life-helper!',acknowledgedLocalUse:true},'native');
  let helper=(await api.authenticate(joined.value,'native'))!;await assert.rejects(api.lifeHistory(helper,f.c.id),rejected('MEMBER_PENDING'));
  await api.actMember(f.p,helper.member_id,{action:'approve',acknowledged:true},'"1"');helper=(await api.authenticate(joined.value,'native'))!;
  await assert.rejects(api.lifeHistory(helper,f.c.id,{cursor}),rejected('OWNER_REQUIRED'));
  await api.actMember(f.p,helper.member_id,{action:'revoke',acknowledged:true},'"2"');await assert.rejects(api.lifeHistory(helper,f.c.id,{cursor}),rejected('UNAUTHENTICATED'));
});
test('older shared answers can be removed in place and stay removed after collection withdrawal',async()=>{
  const f=await fixture();await seed(f,24);const first=await api.lifeHistory(f.cp,f.c.id),cursor=first.history.nextCursor!,page=await api.lifeHistory(f.cp,f.c.id,{cursor}),goal=page.goals[0];
  assert.equal(goal.reflectionSharing,'family');await api.actLifeGoal(f.cp,f.c.id,goal.id,{action:'unshare'},`"${goal.version}"`,randomUUID());
  const updated=await api.lifeHistory(f.cp,f.c.id,{cursor});assert.deepEqual(updated.goals.map(g=>g.id),page.goals.map(g=>g.id));assert.equal(updated.goals[0].reflection,null);assert.equal(updated.goals[0].reflectionSharing,'withdrawn');
  await api.withdraw(f.p,f.c.id);const stopped=await api.lifeHistory(f.p,f.c.id,{cursor});assert.equal(stopped.collectionActive,false);assert.equal(stopped.goals[0].reflection,null);
  await assert.rejects(api.lifeHistory(f.cp,f.c.id,{cursor}),rejected('UNAUTHENTICATED'));
  await api.deleteChild(f.p,f.c.id);await assert.rejects(api.lifeHistory(f.p,f.c.id,{cursor}),rejected('NOT_FOUND'));
});
test('empty and exactly twenty closed goals do not advertise a missing next page',async()=>{
  const f=await fixture();const empty=await api.lifeHistory(f.p,f.c.id);assert.deepEqual(empty.goals,[]);assert.equal(empty.history.nextCursor,null);
  await seed(f,20);const exact=await api.lifeHistory(f.cp,f.c.id);assert.equal(exact.goals.length,20);assert.equal(exact.history.nextCursor,null);
});
