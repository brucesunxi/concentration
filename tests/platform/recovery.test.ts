import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase,migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { service,ApiError } from '../../apps/api/service.ts';
import type { FocusService } from '../../apps/api/service.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import type { LocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';
import type { LocalSessionAuthority } from '../../apps/api/session-authority.ts';
import { TEST_ENVIRONMENT,DAILY_LIMIT } from '../../packages/task-engine/index.ts';
import type { Result } from '../../packages/contracts/models.ts';
import { completeEvents } from './fixtures.ts';
import { nextFamilyDay } from '../../packages/session-runtime/day-boundary.ts';
import { prepareAuthorization } from '../../packages/session-runtime/prepare-authorization.ts';
let db:Database,api:FocusService,content:LocalContent,authority:LocalSessionAuthority;
let clock=Date.now();
before(async()=>{db=await openDatabase('memory://');await migrate(db);content=await createLocalContent(db,{now:()=>clock});authority=await createSessionAuthority(db);api=service(db,()=>clock,content,authority)});
after(()=>db.close());
const code=(expected:string)=>(e:unknown)=>e instanceof ApiError && e.code===expected;
async function fixture(){
 const credentials={name:'Recovery-'+randomUUID().slice(0,8),password:'synthetic-recovery-password'};
 const p=(await api.authenticate((await api.setup({...credentials,locale:'en',timezone:'UTC',acknowledgedLocalUse:true})).value))!;
 const child=await api.addChild(p,{alias:'Synthetic profile',ageBand:'6-8',locale:'en',localConfirmation:true});
 const input={task:'search',environment:TEST_ENVIRONMENT,deviceId:randomUUID()},key=randomUUID();
 const {session,auth}=await api.start(p,child.id,input,key),cp=(await api.authenticate(auth.value))!;
 const parent=async()=> (await api.authenticate((await api.login(credentials)).value))!;
 return {credentials,child,input,key,session,cp,parent,events:completeEvents(session.plan),target:randomUUID()};
}
async function preview(f:Awaited<ReturnType<typeof fixture>>){const p=await f.parent();return {p,space:await api.recoverySpace(p,f.child.id,{deviceId:f.target})}}
async function handover(f:Awaited<ReturnType<typeof fixture>>){const {p,space}=await preview(f);const key=randomUUID(),body={deviceId:f.target,acknowledged:true};const receipt=await api.handover(p,f.child.id,f.session.id,body,space.active!.etag,key);return{p,space,key,body,receipt}}
async function appendAll(f:Awaited<ReturnType<typeof fixture>>){for(let i=0;i<f.events.length;i+=100)await api.append(f.cp,f.session.id,{events:f.events.slice(i,i+100)})}

test('recovery overview is parent scoped, owner bound and exposes a public snapshot rather than device or request secrets',async()=>{
 const f=await fixture(),{p,space}=await preview(f);assert.equal(space.active!.sameDevice,false);assert.equal(space.availableMs,0);assert.equal(space.active!.receivedEvents,0);
 const same=await api.recoverySpace(p,f.child.id,{deviceId:f.input.deviceId});assert.equal(same.active!.sameDevice,true);
 for(const secret of [f.input.deviceId,f.target,f.key,f.cp.token_hash])assert.equal(JSON.stringify(space).includes(secret),false);
 await assert.rejects(api.recoverySpace(f.cp,f.child.id,{deviceId:f.target}),code('PARENT_REQUIRED'));
 const other=await fixture();await assert.rejects(api.recoverySpace(await other.parent(),f.child.id,{deviceId:f.target}),code('NOT_FOUND'));
 await assert.rejects(api.recoverySpace(p,f.child.id,{deviceId:f.target,alias:'extra'}));
});

test('handover requires a current snapshot and explicit acknowledgement; stale progress is refreshed instead of overwritten',async()=>{
 const f=await fixture(),{p,space}=await preview(f),body={deviceId:f.target,acknowledged:true},key=randomUUID();
 await assert.rejects(api.handover(p,f.child.id,f.session.id,body,undefined,key),code('PRECONDITION_REQUIRED'));
 await assert.rejects(api.handover(p,f.child.id,f.session.id,{deviceId:f.target},space.active!.etag,key));
 await api.append(f.cp,f.session.id,{events:f.events.slice(0,2)});
 await assert.rejects(api.handover(p,f.child.id,f.session.id,body,space.active!.etag,key),code('HANDOVER_CONFLICT'));
 assert.equal((await api.sessionStatus(f.cp,f.session.id)).canContinue,true);
 const updated=await api.recoverySpace(p,f.child.id,{deviceId:f.target});assert.notEqual(updated.active!.etag,space.active!.etag);
});

test('confirmed handover is idempotent, stops new authorization and preserves late records without double course or difficulty updates',async()=>{
 const f=await fixture(),h=await handover(f);
 assert.equal((await api.sessionStatus(f.cp,f.session.id)).historyOnly,true);assert.equal((await api.sessionStatus(f.cp,f.session.id)).canContinue,false);
 const grant=f.session.continuation_grant!,timer=await prepareAuthorization(f.session,f.input.deviceId,async<T>(path:string):Promise<T> => (path==='/session-authorities'?{mode:'local-development',keys:await api.sessionAuthorities()}:await api.sessionStatus(f.cp,f.session.id)) as T);
 assert.throws(()=>timer!.assert([{type:'present',trialId:f.session.plan.trials[0].id}]),/SESSION_REPLACED/);
 assert.doesNotThrow(()=>timer!.assert([{type:'end',reason:'child_stopped'}]));
 const duplicate=await api.handover(h.p,f.child.id,f.session.id,h.body,h.space.active!.etag,h.key);assert.equal(duplicate.replayed,true);assert.equal(duplicate.closedAt,h.receipt.closedAt);
 await assert.rejects(api.handover(h.p,f.child.id,f.session.id,{...h.body,deviceId:randomUUID()},h.space.active!.etag,h.key),code('IDEMPOTENCY_CONFLICT'));
 await assert.rejects(api.start(h.p,f.child.id,{...f.input,deviceId:f.target},randomUUID()),code('DAILY_LIMIT'));
 await appendAll(f);const result=await api.finalize(f.cp,f.session.id,{lastSeq:f.events.length}) as Result;
 assert.equal(result.historyOnly,true);assert.equal(result.completed,true);assert.equal(result.decision.reason,'HOLD_DEVICE_HANDOVER');
 assert.deepEqual(await api.finalize(f.cp,f.session.id,{lastSeq:f.events.length}),result);
 const p=await f.parent(),me=await api.me(p);assert.equal(me.children[0].completedSessions,0);assert.equal(me.children[0].course.unit,0);assert.deepEqual(me.children[0].levels,{search:1,stop:1,memory:1,sustain:1});
 const weekly=await api.weekly(p,f.child.id);assert.equal(weekly.coverage.historyOnly,1);assert.equal(weekly.coverage.finalized,0);assert.equal(weekly.groups.length,0);
 const report=await api.report(p,f.child.id);assert.equal(report.sessions.length,1);assert.equal((report.sessions[0].result as Result).historyOnly,true);
 const released=await api.recoverySpace(p,f.child.id,{deviceId:f.target});assert.equal(released.availableMs,DAILY_LIMIT['6-8']-Math.ceil(result.activeMs));assert.ok(released.availableMs>5000);
 await assert.rejects(api.start(p,f.child.id,f.input,f.key),code('SESSION_REPLACED'));
 const exported=JSON.stringify(await api.exportChild(p,f.child.id));assert.ok(exported.includes('device_handover'));assert.ok(exported.includes('actorScope'));for(const v of [f.target,f.input.deviceId,h.key])assert.equal(exported.includes(v),false);
 clock=Date.parse(grant.body.recordUntil)+1000;
 const stillSameDay=clock<nextFamilyDay(Date.parse(grant.body.issuedAt),'UTC');
 assert.equal((await api.recoverySpace(await f.parent(),f.child.id,{deviceId:f.target})).availableMs,stillSameDay?released.availableMs:DAILY_LIMIT['6-8']);
 clock=nextFamilyDay(Date.parse(grant.body.issuedAt),'UTC');
 const next=await api.start(await f.parent(),f.child.id,{...f.input,deviceId:f.target},randomUUID());assert.notEqual(next.session.id,f.session.id);assert.equal(next.session.budget_ms,DAILY_LIMIT['6-8']);
 const again=await api.handover(await f.parent(),f.child.id,f.session.id,h.body,h.space.active!.etag,h.key);assert.equal(again.replayed,true);assert.equal((await api.active((await api.authenticate(next.auth.value))!))!.id,next.session.id);
});

test('simultaneous parent confirmations have one winner',async()=>{
 const f=await fixture(),{p,space}=await preview(f),body={deviceId:f.target,acknowledged:true};
 const outcomes=await Promise.allSettled([api.handover(p,f.child.id,f.session.id,body,space.active!.etag,randomUUID()),api.handover(await f.parent(),f.child.id,f.session.id,body,space.active!.etag,randomUUID())]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);const rejected=outcomes.find(x=>x.status==='rejected') as PromiseRejectedResult;assert.equal(rejected.reason.code,'HANDOVER_CONFLICT');
 assert.equal((await db.query('SELECT * FROM session_handovers WHERE session_id=$1',[f.session.id])).rows.length,1);
});

test('original installation recovers archive-only logs with an atomic child credential handoff; other devices and child scope cannot',async()=>{
 const f=await fixture();await handover(f);const p=await f.parent();
 await assert.rejects(api.recover(p,f.child.id,f.session.id,{deviceId:f.target}),code('SESSION_DEVICE_MISMATCH'));
 await assert.rejects(api.recover(f.cp,f.child.id,f.session.id,{deviceId:f.input.deviceId}),code('PARENT_REQUIRED'));
 const r=await api.recover(p,f.child.id,f.session.id,{deviceId:f.input.deviceId});assert.equal((await db.query('SELECT 1 FROM auth_sessions WHERE token_hash=$1',[p.token_hash])).rows.length,0);
 const child=(await api.authenticate(r.auth.value))!;assert.equal(child.device_id,f.input.deviceId);assert.equal((await api.active(child))!.id,f.session.id);assert.equal((await api.sessionStatus(child,f.session.id)).canContinue,false);
 await assert.rejects(api.recover(p,f.child.id,f.session.id,{deviceId:f.input.deviceId}),code('UNAUTHENTICATED'));
});

test('expired reauthentication cannot hand over or recover; a finalized session invalidates its preview',async()=>{
 const f=await fixture(),{p,space}=await preview(f);clock+=11*60000;
 await assert.rejects(api.handover(p,f.child.id,f.session.id,{deviceId:f.target,acknowledged:true},space.active!.etag,randomUUID()),code('REAUTH_REQUIRED'));
 await assert.rejects(api.recover(p,f.child.id,f.session.id,{deviceId:f.input.deviceId}),code('REAUTH_REQUIRED'));
 await appendAll(f);await api.finalize(f.cp,f.session.id,{lastSeq:f.events.length});
 await assert.rejects(api.handover(await f.parent(),f.child.id,f.session.id,{deviceId:f.target,acknowledged:true},space.active!.etag,randomUUID()),code('HANDOVER_CONFLICT'));
 assert.equal((await api.me(await f.parent())).children[0].completedSessions,1);
});

test('handover audit or recovered credential write failures roll back their entire transaction',async()=>{
 const f=await fixture(),{p,space}=await preview(f);
 const broken=(match:string):Database=>({...db,transaction:fn=>db.transaction(tx=>fn({query:(sql,params)=>{if(sql.startsWith(match))throw new Error('injected persistence failure');return tx.query(sql,params)}}))});
 await assert.rejects(service(broken('INSERT INTO session_handovers'),()=>clock,content,authority).handover(p,f.child.id,f.session.id,{deviceId:f.target,acknowledged:true},space.active!.etag,randomUUID()),/injected/);
 assert.equal((await api.sessionStatus(f.cp,f.session.id)).canContinue,true);
 await assert.rejects(service(broken('INSERT INTO auth_sessions'),()=>clock,content,authority).recover(p,f.child.id,f.session.id,{deviceId:f.input.deviceId}),/injected/);
 assert.ok((await db.query('SELECT 1 FROM auth_sessions WHERE token_hash=$1',[p.token_hash])).rows.length);
});

test('withdrawal precedes handover replay and archival upload, and deleting the child cascades handover provenance',async()=>{
 const f=await fixture(),h=await handover(f);await api.withdraw(h.p,f.child.id);
 await assert.rejects(api.handover(h.p,f.child.id,f.session.id,h.body,h.space.active!.etag,h.key),code('CONSENT_REVOKED'));
 await assert.rejects(api.append(f.cp,f.session.id,{events:f.events.slice(0,1)}),code('UNAUTHENTICATED'));
 await api.deleteChild(h.p,f.child.id);assert.equal((await db.query('SELECT * FROM session_handovers WHERE session_id=$1',[f.session.id])).rows.length,0);
});

test('late recovery never extends the seven day upload window',async()=>{
 const f=await fixture();await handover(f);
 clock=Date.parse(f.session.continuation_grant!.body.uploadUntil)-12*3600000;
 const renewed=await api.recover(await f.parent(),f.child.id,f.session.id,{deviceId:f.input.deviceId});f.cp=(await api.authenticate(renewed.auth.value))!;
 clock=Date.parse(f.session.continuation_grant!.body.uploadUntil)+1;
 await assert.rejects(api.append(f.cp,f.session.id,{events:f.events.slice(0,1)}),code('SESSION_UPLOAD_EXPIRED'));
 await assert.rejects(api.recover(await f.parent(),f.child.id,f.session.id,{deviceId:f.input.deviceId}),code('SESSION_UPLOAD_EXPIRED'));
});

test('content recall still forbids archived uploads and recovery without deleting the saved provenance',async()=>{
 const f=await fixture(),h=await handover(f);await content.recall(f.session.plan.content!.sha256,'synthetic-reviewer','Synthetic recovery recall');
 await assert.rejects(api.append(f.cp,f.session.id,{events:f.events.slice(0,1)}),/^Error: CONTENT_RECALLED$/);
 await assert.rejects(api.recover(h.p,f.child.id,f.session.id,{deviceId:f.input.deviceId}),/^Error: CONTENT_RECALLED$/);
 assert.equal((await api.recoverySpace(h.p,f.child.id,{deviceId:f.target})).history.length,1);
 const exported=await api.exportChild(h.p,f.child.id);assert.ok(JSON.stringify(exported).includes('device_handover'));
});
