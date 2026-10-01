import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase,migrate} from '../../apps/api/database.ts';
import type {Database} from '../../apps/api/database.ts';
import {service} from '../../apps/api/service.ts';
import type {FocusService} from '../../apps/api/service.ts';
import {HistoryClient} from '../../packages/session-runtime/history-client.ts';
import type {Report} from '../../packages/contracts/models.ts';

let db:Database,api:FocusService;
before(async()=>{db=await openDatabase('memory://');await migrate(db);api=service(db);});
after(()=>db.close());
async function fixture() {
  const credentials={name:'History-'+randomUUID(),password:'Synthetic-history-2026!'};
  credentials.name=credentials.name.slice(0,40);
  const a=await api.setup({...credentials,timezone:'UTC',locale:'en',acknowledgedLocalUse:true}),p=(await api.authenticate(a.value))!;
  const c=await api.addChild(p,{alias:'Synthetic history',ageBand:'15-17',locale:'en',localConfirmation:true});return {p,c,credentials};
}
async function seed(childId:string,count:number) {
  // Identical timestamp groups and microseconds below the JS Date precision.
  await db.query(`INSERT INTO observations(id,child_id,task,context,prompts,child_choice,created_at)
    SELECT gen_random_uuid(),$1,'search','packing',0,true,'2026-09-01T10:00:00.000000Z'::timestamptz + (i/3)*interval '1 microsecond' FROM generate_series(1,$2::int) i`,[childId,count]);
  await db.query(`INSERT INTO sessions(id,child_id,request_key,request_hash,device_id,plan,state,budget_day,budget_ms,result,created_at)
    SELECT gen_random_uuid(),$1,gen_random_uuid()::text,'synthetic',gen_random_uuid(),'{}','aborted','2026-09-01',0,'{}',created_at FROM observations WHERE child_id=$1`,[childId]);
}
test('all pages include every tied and microsecond timestamp once for both collections',async()=>{
  const f=await fixture();await seed(f.c.id,127);
  for(const kind of ['sessions','observations'] as const){
    const expected=(await db.query<{id:string}>(`SELECT id FROM ${kind} WHERE child_id=$1 ORDER BY created_at DESC,id DESC`,[f.c.id])).rows.map(r=>r.id);
    const ids:string[]=[];let cursor:string|null=null;const counts=[];
    do{const page=await api.report(f.p,f.c.id,cursor?{[kind+'Cursor']:cursor}:{});ids.push(...page[kind].map(r=>r.id));counts.push(page[kind].length);cursor=page.history[kind].nextCursor;}while(cursor);
    assert.deepEqual(counts,[50,50,27]);assert.deepEqual(ids,expected);assert.equal(new Set(ids).size,127);
  }
});
test('inserts above the cursor do not shift older pages; boundary deletion and process restart preserve position',async()=>{
  const f=await fixture();await seed(f.c.id,60);const first=await api.report(f.p,f.c.id),cursor=first.history.observations.nextCursor!;
  await api.observe(f.p,f.c.id,{task:'search',context:'reading',prompts:1,childChoice:true},randomUUID());
  await db.query('DELETE FROM observations WHERE id=$1',[first.observations.at(-1)!.id]);
  const restarted=service(db),older=await restarted.report(f.p,f.c.id,{observationsCursor:cursor});
  assert.equal(older.observations.length,10);assert.equal(older.history.observations.nextCursor,null);
  assert.ok(older.observations.every(row=>!first.observations.some(old=>old.id===row.id)));
  assert.equal((await api.report(f.p,f.c.id)).observations[0].context,'reading');
});
test('cursors cannot cross child or collection scope; malformed and duplicate-shaped queries are rejected',async()=>{
  const f=await fixture();await seed(f.c.id,51);const first=await api.report(f.p,f.c.id),cursor=first.history.observations.nextCursor!;
  const sibling=await api.addChild(f.p,{alias:'Other child',ageBand:'6-8',locale:'en',localConfirmation:true});
  for(const [id,query] of [[sibling.id,{observationsCursor:cursor}],[f.c.id,{sessionsCursor:cursor}],[f.c.id,{observationsCursor:'%%%'}],[f.c.id,{observationsCursor:Buffer.from('{}').toString('base64url')}]] as const)await assert.rejects(api.report(f.p,id,query),{code:'INVALID_HISTORY_CURSOR'});
  for(const query of [{observationsCursor:'a'.repeat(513)},{observationsCursor:[cursor,cursor]},{limit:10000}])await assert.rejects(api.report(f.p,f.c.id,query));
  const other=await fixture();await assert.rejects(api.report(other.p,f.c.id,{observationsCursor:cursor}),{code:'NOT_FOUND'});
  const child=(await api.authenticate((await api.enterChild(f.p,f.c.id)).auth.value))!;
  await assert.rejects(api.report(child,f.c.id,{observationsCursor:cursor}),{code:'PARENT_REQUIRED'});
  await assert.rejects(api.report(f.p,f.c.id),{code:'UNAUTHENTICATED'});
});
test('empty/exact-size pages have no false next page; stopped collection remains readable without changing records',async()=>{
  const f=await fixture();let report=await api.report(f.p,f.c.id);assert.equal(report.history.sessions.nextCursor,null);assert.equal(report.history.observations.nextCursor,null);
  await seed(f.c.id,50);report=await api.report(f.p,f.c.id);assert.equal(report.observations.length,50);assert.equal(report.history.observations.nextCursor,null);
  await api.withdraw(f.p,f.c.id);const stopped=await api.report(f.p,f.c.id);assert.equal(stopped.child.consentActive,false);assert.deepEqual(stopped.observations,report.observations);
});

const mock=(id='child'):Report=>({child:{id} as Report['child'],sessions:[],observations:[],observationCount:0,history:{version:'family-history-1',pageSize:50,sessions:{nextCursor:'olderSession'},observations:{nextCursor:'olderObservation'}}});
test('client navigates collections independently, replaces pages, prevents overlapping requests, and retries without skipping',async()=>{
  const paths:string[]=[];let reject=false,resolvePending:((value:Report)=>void)|undefined;
  const c=new HistoryClient('child',async<T>(path:string)=>{paths.push(path);if(reject)throw new Error('network');if(resolvePending)return new Promise<T>(done=>{resolvePending=v=>done(v as T);});return mock() as T;},()=>{});
  await c.refresh();await c.move('sessions','older');assert.deepEqual(c.state.pages,{sessions:2,observations:1});
  reject=true;await c.move('observations','older');assert.equal(c.state.error,'LOAD_FAILED');assert.equal(c.state.target,'observations');assert.deepEqual(c.state.pages,{sessions:2,observations:1});assert.ok(c.state.data);
  reject=false;await c.move('observations','older');assert.equal(paths.at(-1),'/children/child/report?sessionsCursor=olderSession&observationsCursor=olderObservation');
  await c.move('sessions','newer');assert.deepEqual(c.state.pages,{sessions:1,observations:2});
  resolvePending=()=>{};const pending=c.refresh(),before=paths.length;await c.refresh();await c.move('observations','newer');assert.equal(paths.length,before);
  resolvePending!(mock());await pending;assert.deepEqual(c.state.pages,{sessions:1,observations:1});
});
test('client clears rejected or wrong-profile data and refuses old servers that could silently truncate history',async()=>{
  for(const error of ['UNAUTHENTICATED','NOT_FOUND','MEMBER_PENDING']){
    let fail=false;const c=new HistoryClient('child',async<T>()=>{if(fail)throw {code:error};return mock() as T;},()=>{});
    await c.refresh();fail=true;await c.move('sessions','older');assert.equal(c.state.data,null);assert.equal(c.state.needsParent,true);
  }
  for(const data of [mock('other'),{...mock(),history:undefined}]){const c=new HistoryClient('child',async<T>()=>data as T,()=>{});await c.refresh();assert.equal(c.state.data,null);assert.equal(c.state.error,'HISTORY_UNSUPPORTED');}
});
test('leaving a profile ignores late history success or denial',async()=>{
  for(const fail of [false,true]){let done!:(value:Report)=>void,denied!:(e:unknown)=>void,updates=0;
    const c=new HistoryClient('child',<T>()=>new Promise<T>((ok,no)=>{done=v=>ok(v as T);denied=no;}),()=>updates++);
    const pending=c.refresh();c.dispose();const before=updates;if(fail)denied({code:'UNAUTHENTICATED'});else done(mock());await pending;assert.equal(updates,before);assert.equal(c.state.data,null);
  }
});
