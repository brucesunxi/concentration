import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Database } from '../../apps/api/database.ts';
import { createLocalContent } from '../../apps/api/content.ts';
import { createSessionAuthority } from '../../apps/api/session-authority.ts';
import { service } from '../../apps/api/service.ts';
import { WebJournal } from '../../packages/session-runtime/web-journal.ts';
import { makeOfflineCapsule, verifyOfflineSession, OfflinePreparationChanged } from '../../packages/session-runtime/offline-session.ts';
import type { OfflineCapsule } from '../../packages/session-runtime/offline-session.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import type { EngineEvent } from '../../packages/task-engine/index.ts';
import { completeEvents } from './fixtures.ts';
const now=Date.parse('2026-09-30T10:00:00Z'),checkpoint={highest:now,fault:null};
let db:Database,capsule:OfflineCapsule,events:EngineEvent[];
before(async()=>{
  db=await openDatabase('memory://');await migrate(db);
  const content=await createLocalContent(db,{now:()=>now}),api=service(db,()=>now,content,await createSessionAuthority(db));
  const auth=await api.setup({name:'Synthetic web offline',password:'synthetic-offline-password',locale:'en',timezone:'UTC',acknowledgedLocalUse:true});
  const parent=(await api.authenticate(auth.value))!,child=await api.addChild(parent,{alias:'Synthetic alias',ageBand:'12-14',locale:'en',localConfirmation:true}),deviceId=randomUUID();
  const started=await api.start(parent,child.id,{task:'memory',environment:TEST_ENVIRONMENT,deviceId},randomUUID()),principal=(await api.authenticate(started.auth.value))!;
  const session=JSON.parse(JSON.stringify(started.session)) as typeof started.session;
  capsule=makeOfflineCapsule(parent.family_id,deviceId,session,{authorities:await api.sessionAuthorities(),status:await api.sessionStatus(principal,session.id)},{release:await content.release(session.plan.content!),keys:await content.trust()});
  events=completeEvents(session.plan).slice(0,2);
});
after(async()=>db.close());
async function prepared(){
  const factory=new IDBFactory(),store=new WebJournal(factory),generation=await store.generation();
  await store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events,generation,checkpoint);
  await store.prepare(capsule,generation,checkpoint,events);return {store,factory,generation};
}

test('browser preparation survives a new connection and verifies the web-bound grant without copying private API responses',async()=>{
  const {factory}=await prepared(),restored=await new WebJournal(factory).resume();assert.ok(restored);
  const verified=await verifyOfflineSession(restored,capsule.deviceId,'web',restored.events,undefined,()=>now,()=>0);
  assert.equal(verified.pack.task,'memory');assert.deepEqual(restored.events,events);
  await assert.rejects(verifyOfflineSession(restored,capsule.deviceId,'ios',restored.events,undefined,()=>now,()=>0));
  assert.equal(JSON.stringify(restored.capsule).includes('Synthetic alias'),false);
});

test('v1 IndexedDB migration preserves unsynchronized events and only a checked owner may attach recovery metadata',async()=>{
  const factory=new IDBFactory();
  await new Promise<void>((resolve,reject)=>{const r=factory.open('focus-family-journal',1);r.onupgradeneeded=()=>r.result.createObjectStore('sessions',{keyPath:'id'}).put({id:capsule.session.id,childId:capsule.session.child_id,events});r.onerror=()=>reject(r.error);r.onsuccess=()=>{r.result.close();resolve();};});
  const store=new WebJournal(factory);assert.deepEqual(await store.read(capsule.session.id,capsule.session.child_id,capsule.familyId),events);assert.equal(await store.resume(),null);
  await assert.rejects(store.write(capsule.session.id,randomUUID(),capsule.familyId,events,0),/LOCAL_OWNER_MISMATCH/);
  await store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events,0,checkpoint);await store.prepare(capsule,0,checkpoint,events);assert.ok(await store.resume());
});

test('v2 journal upgrade preserves the identity generation and starts a conservative retention window for old rows',async()=>{
  const factory=new IDBFactory();
  await new Promise<void>((resolve,reject)=>{const request=factory.open('focus-family-journal',2);
    request.onupgradeneeded=()=>{const db=request.result;for(const name of ['sessions','offline','meta','blocked','closed'])db.createObjectStore(name,{keyPath:'id'});
      request.transaction!.objectStore('meta').put({id:'current',generation:4});
      request.transaction!.objectStore('sessions').put({id:capsule.session.id,childId:capsule.session.child_id,familyId:capsule.familyId,events});};
    request.onerror=()=>reject(request.error);request.onsuccess=()=>{request.result.close();resolve();};});
  let wall=now;const store=new WebJournal(factory,'focus-family-journal',()=>wall);
  assert.equal(await store.generation(),4);
  assert.deepEqual(await store.read(capsule.session.id,capsule.session.child_id,capsule.familyId),events);
  wall+=6*86400000;
  assert.equal(await store.expiringSoon(capsule.familyId,capsule.session.child_id),1);
});

test('identity changes from another connection prevent both a late journal write and a late preparation',async()=>{
  const {factory,store,generation}=await prepared();const other=new WebJournal(factory);
  await other.invalidate();assert.equal(await store.resume(),null);
  await assert.rejects(store.prepare(capsule,generation,checkpoint,events),OfflinePreparationChanged);
  await assert.rejects(store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,[],generation),OfflinePreparationChanged);
  assert.deepEqual(await store.read(capsule.session.id,capsule.session.child_id),events);
});

test('revoked profiles cannot reappear after clearing, even with a fresh generation or connection',async()=>{
  const {factory,store}=await prepared();await store.clear(capsule.session.child_id);
  const reopened=new WebJournal(factory),generation=await reopened.generation();
  assert.equal(await reopened.resume(),null);assert.deepEqual(await reopened.read(capsule.session.id,capsule.session.child_id),[]);
  await assert.rejects(reopened.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events,generation),OfflinePreparationChanged);
});

test('deleting a family clears its browser recovery data without erasing another family',async()=>{
  const {factory,store,generation}=await prepared();
  const other={familyId:randomUUID(),childId:randomUUID(),sessionId:randomUUID()};
  await store.write(other.sessionId,other.childId,other.familyId,events,generation,checkpoint);
  await new WebJournal(factory).clearFamily(capsule.familyId,[capsule.session.child_id]);
  const reopened=new WebJournal(factory),nextGeneration=await reopened.generation();
  assert.equal(await reopened.resume(),null);
  assert.deepEqual(await reopened.read(capsule.session.id,capsule.session.child_id,capsule.familyId),[]);
  assert.deepEqual(await reopened.read(other.sessionId,other.childId,other.familyId),events);
  await assert.rejects(reopened.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events,nextGeneration),OfflinePreparationChanged);
  await reopened.write(other.sessionId,other.childId,other.familyId,events,nextGeneration);
});

test('deleting a family preserves a different family’s active browser recovery',async()=>{
  const factory=new IDBFactory(),store=new WebJournal(factory),generation=await store.generation();
  const other={familyId:randomUUID(),childId:randomUUID(),sessionId:randomUUID()};
  const otherCapsule=structuredClone(capsule);
  otherCapsule.familyId=other.familyId;otherCapsule.session.id=other.sessionId;otherCapsule.session.child_id=other.childId;
  await store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events,generation);
  await store.write(other.sessionId,other.childId,other.familyId,events,generation);
  await store.prepare(otherCapsule,generation,checkpoint,events);
  await store.invalidateFamily(capsule.familyId,[capsule.session.child_id]);
  assert.equal((await new WebJournal(factory).resume())?.capsule.familyId,other.familyId);
  await store.clearFamily(capsule.familyId,[capsule.session.child_id]);
  const restored=await new WebJournal(factory).resume();
  assert.equal(restored?.capsule.familyId,other.familyId);
  assert.deepEqual(restored?.events,events);
});

test('expired or handed-over preparation remains closed while honest closure can save; final confirmation seals all late writes',async()=>{
  const {store,generation}=await prepared();await store.close(capsule.session.id);
  assert.equal(await store.resume(),null);await assert.rejects(store.prepare(capsule,generation,checkpoint,events),OfflinePreparationChanged);
  const ended:EngineEvent[]=[...events,{id:randomUUID(),seq:3,at:events[1].at,type:'interrupt',reason:'pause'},{id:randomUUID(),seq:4,at:events[1].at,type:'end',reason:'child_stopped'}];
  await store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,ended,generation,checkpoint);
  await store.close(capsule.session.id,true);await store.close(capsule.session.id,false);
  await assert.rejects(store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events,generation),OfflinePreparationChanged);
  assert.deepEqual(await store.read(capsule.session.id,capsule.session.child_id),[]);
});

test('a stale event snapshot cannot be advertised for reopening, and checkpoints never clear an earlier fault',async()=>{
  const {store,generation}=await prepared();
  await store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events.slice(0,1),generation,{highest:now+1000,fault:'SESSION_CLOCK_CHANGED'});
  await assert.rejects(store.prepare(capsule,generation,checkpoint,events),OfflinePreparationChanged);
  await store.checkpoint(capsule.session.id,checkpoint);
  const saved=await store.resume();assert.ok(saved);assert.equal(saved.checkpoint.highest,now+1000);assert.equal(saved.checkpoint.fault,'SESSION_CLOCK_CHANGED');
  await assert.rejects(verifyOfflineSession(saved,capsule.deviceId,'web',saved.events,undefined,()=>now+1000,()=>0));
});

test('a failed recovery-checkpoint write aborts event and hash changes in the same browser transaction',async()=>{
  const {store,generation}=await prepared();const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args:Parameters<typeof original>){if(this.name==='offline')throw new DOMException('Synthetic storage full','QuotaExceededError');return original.apply(this,args);};
  try{await assert.rejects(store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events.slice(0,1),generation,{highest:now+3000,fault:null}),/Synthetic storage full/);}finally{IDBObjectStore.prototype.put=original;}
  const saved=await store.resume();assert.ok(saved);assert.deepEqual(saved.events,events);assert.deepEqual(saved.checkpoint,checkpoint);
  await verifyOfflineSession(saved,capsule.deviceId,'web',saved.events,undefined,()=>now,()=>0);
});

test('seven-day local retention warns first, expires atomically and cannot be extended by a clock rollback or stale page',async()=>{
  let wall=now;const factory=new IDBFactory(),store=new WebJournal(factory,'focus-family-journal',()=>wall);
  const generation=await store.generation();
  await store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events,generation,checkpoint);
  await store.prepare(capsule,generation,checkpoint,events);
  wall+=6*86400000;
  assert.equal(await store.expiringSoon(capsule.familyId,capsule.session.child_id),1);
  wall-=3*86400000;
  assert.equal(await new WebJournal(factory,'focus-family-journal',()=>wall).expiringSoon(capsule.familyId,capsule.session.child_id),1);
  wall=now+7*86400000;
  assert.equal(await store.resume(),null);
  assert.deepEqual(await store.read(capsule.session.id,capsule.session.child_id,capsule.familyId),[]);
  assert.equal(await store.expiringSoon(capsule.familyId,capsule.session.child_id),0);
  await assert.rejects(store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events,generation),OfflinePreparationChanged);
});

test('the Web deletion request preserves another family’s recovery on rejection and success',async()=>{
  const factory=new IDBFactory(),store=new WebJournal(factory),generation=await store.generation();
  const other={familyId:randomUUID(),childId:randomUUID(),sessionId:randomUUID()};
  const otherCapsule=structuredClone(capsule);
  otherCapsule.familyId=other.familyId;otherCapsule.session.id=other.sessionId;otherCapsule.session.child_id=other.childId;
  await store.write(capsule.session.id,capsule.session.child_id,capsule.familyId,events,generation);
  await store.write(other.sessionId,other.childId,other.familyId,events,generation);
  await store.prepare(otherCapsule,generation,checkpoint,events);
  const prior={indexedDB:globalThis.indexedDB,window:globalThis.window,fetch:globalThis.fetch};
  const target=globalThis as typeof globalThis & {indexedDB:IDBFactory;window:Window};
  const notices:unknown[]=[];
  try {
    target.indexedDB=factory;target.window=new EventTarget() as Window & typeof globalThis;
    target.window.addEventListener('focus-account-access',event=>notices.push((event as CustomEvent).detail));
    const api=await import('../../apps/family-web/src/api.ts');
    const deletion={id:capsule.familyId,childIds:[capsule.session.child_id]};
    api.setCsrf('synthetic-csrf');
    globalThis.fetch=async()=>new Response(JSON.stringify({code:'PASSWORD_REJECTED',message:'Rejected'}),{status:403});
    await assert.rejects(api.request('/family','DELETE',{currentPassword:'wrong'}, {}, {deletingFamily:deletion}),{code:'PASSWORD_REJECTED'});
    assert.equal((await store.resume())?.capsule.familyId,other.familyId);
    assert.deepEqual(await store.read(capsule.session.id,capsule.session.child_id,capsule.familyId),events);
    globalThis.fetch=async()=>new Response(JSON.stringify({ok:true,signInRequired:true}),{status:200});
    assert.deepEqual(await api.request('/family','DELETE',{currentPassword:'correct'}, {}, {deletingFamily:deletion}),{ok:true,signInRequired:true});
    assert.equal((await store.resume())?.capsule.familyId,other.familyId);
    assert.deepEqual(await store.read(capsule.session.id,capsule.session.child_id,capsule.familyId),[]);
    assert.deepEqual(await store.read(other.sessionId,other.childId,other.familyId),events);
    assert.deepEqual(notices,[{outcome:'deleted',deletingFamily:deletion}]);
  } finally {
    target.indexedDB=prior.indexedDB;target.window=prior.window;globalThis.fetch=prior.fetch;
  }
});
