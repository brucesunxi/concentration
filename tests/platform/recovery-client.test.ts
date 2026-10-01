import test from 'node:test';
import assert from 'node:assert/strict';
import {RecoveryClient} from '../../packages/session-runtime/recovery-client.ts';
import type {RecoveryRequest,RecoveryState} from '../../packages/session-runtime/recovery-client.ts';
import type {RecoverySpace} from '../../packages/session-runtime/recovery-model.ts';
const space=():RecoverySpace=>({childId:'child',collectionActive:true,active:{id:'session',task:'search',createdAt:new Date().toISOString(),environment:null,sameDevice:true,historyOnly:false,finalized:false,receivedEvents:0,etag:'"first"',recordUntil:null,uploadUntil:null,handoverAvailable:true},history:[],budgetDay:'2026-09-30',availableMs:0,timezone:'UTC'});
const receipt={childId:'child',sessionId:'session',closedAt:new Date().toISOString(),replayed:false};
const deferred=()=>{let resolve!:(value:any)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function client(handler:(...args:any[])=>Promise<any>){let counter=0;const updates:RecoveryState[]=[];const client=new RecoveryClient('child',handler as RecoveryRequest,async()=>'installation',()=>`key-${++counter}`,s=>updates.push(s));return {client,updates}}

test('recovery client prevents double confirmation and preserves the same request key after an uncertain response',async()=>{
 const calls:any[][]=[];let fail=true;const gate=deferred();
 const {client:c}=client(async(...args)=>{calls.push(args);if(!args[0].endsWith('/handover'))return space();if(fail){await gate.promise;throw Error('network')}return receipt});
 await c.load();const item=c.state.data!.active!,first=c.handover(item);await c.handover(item);gate.resolve(null);await first;
 assert.equal(calls.filter(x=>x[0].endsWith('/handover')).length,1);assert.equal(c.state.saved,false);fail=false;await c.handover(item);
 const writes=calls.filter(x=>x[0].endsWith('/handover'));assert.equal(writes[0][3]['Idempotency-Key'],writes[1][3]['Idempotency-Key']);assert.equal(writes[1][3]['If-Match'],item.etag);assert.equal(c.state.saved,true);
});
test('a changed server snapshot is refreshed without automatically replaying a stale handover',async()=>{
 let reads=0,writes=0;const {client:c}=client(async(path)=>{if(path.endsWith('/handover')){writes++;throw{code:'HANDOVER_CONFLICT'}}const data=space();if(reads++)data.active!.etag='"second"';return data});
 await c.load();const original=c.state.data!.active!;await c.handover(original);assert.equal(c.state.error,'HANDOVER_CONFLICT');assert.equal(c.state.data!.active!.etag,'"second"');await c.handover(original);assert.equal(writes,1);
});
test('write confirmation remains distinct from a failed history refresh',async()=>{
 let reads=0;const {client:c}=client(async(path)=>{if(path.endsWith('/handover'))return receipt;if(reads++)throw Error('network');return space()});await c.load();await c.handover(c.state.data!.active!);assert.equal(c.state.saved,true);assert.equal(c.state.data,null);assert.equal(c.state.error,'REFRESH_REQUIRED');
});
test('disposal prevents late identity data or another follow-up request from returning to a closed page',async()=>{
 const gate=deferred();let requests=0;const {client:c,updates}=client(async(path)=>{requests++;return path.endsWith('/handover')?gate.promise:space()});await c.load();const pending=c.handover(c.state.data!.active!);c.dispose();const length=updates.length;gate.resolve(receipt);await pending;assert.equal(updates.length,length);assert.equal(requests,2);assert.equal(c.state.data,null);
});
test('owner mismatch and revoked collection clear the view; resume is guarded while switching identity',async()=>{
 const wrong=client(async()=>({...space(),childId:'other'})).client;await wrong.load();assert.equal(wrong.state.data,null);assert.equal(wrong.state.error,'ACCESS_CHANGED');
 const {client:c}=client(async(path)=>{if(path.endsWith('/handover'))throw{code:'CONSENT_REVOKED'};return space()});await c.load();await c.handover(c.state.data!.active!);assert.equal(c.state.data,null);
 const d=client(async()=>space()).client;await d.load();let count=0;const gate=deferred(),run=async()=>{count++;await gate.promise};const first=d.resume(d.state.data!.active!,run);await d.resume(d.state.data!.active!,run);assert.equal(count,1);gate.resolve(null);await first;
});
