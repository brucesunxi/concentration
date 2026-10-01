import test from 'node:test';
import assert from 'node:assert/strict';
import { LifeClient } from '../../packages/family-support/client.ts';
import type { LifeRequest, LifeClientState } from '../../packages/family-support/client.ts';
import type { LifeGoal } from '../../packages/family-support/model.ts';
import type { LifeHistorySpace as LifeSpace } from '../../packages/family-support/history.ts';
import { lifeTemplates } from '../../packages/family-support/catalogue.ts';

const childId = 'synthetic-child', input = { templateId: 'find' as const, support: 'ask-first' as const };
const goal = (patch: Partial<LifeGoal> = {}): LifeGoal => ({ contentHash:null,id: 'synthetic-goal', childId, version: 1, state: 'active', support: 'ask-first', createdBy: 'child', reflection: null, reflectionSharing:'not-recorded', template: lifeTemplates('9-11')[0], createdAt: '2026-09-30T12:00:00.000Z', updatedAt: '2026-09-30T12:00:00.000Z', closedReason: null, ...patch });
const space = (patch: Partial<LifeSpace> = {}): LifeSpace => ({ history:{version:'life-history-1',pageSize:20,nextCursor:null},contentPolicy:'family-content-1',content:{hash:'a'.repeat(64),version:'1.0.0-preview',review:'unreviewed',state:'available'},releases:{},childId, role: 'child', sharingPolicy:'reflection-sharing-1', collectionActive: true, templates: lifeTemplates('9-11'), goals: [], total: 0, ...patch });
const transport = (call: (path: string, method?: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>): LifeRequest => <T>(...args: Parameters<LifeRequest>) => call(...args) as Promise<T>;
const failure = (code: string) => Object.assign(new Error(code), { code });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test('double taps produce one mutation and success reads authoritative history from other devices', async () => {
  const gate = deferred<unknown>(); let posts = 0, reads = 0, keys = 0;
  const request = transport(async (_path, method, data, headers) => {
    if (method === 'POST') {
      posts++; assert.deepEqual(data, { ...input, contentHash:'a'.repeat(64), intent: 'choose' }); assert.equal(headers?.['Idempotency-Key'], 'key-1'); return gate.promise;
    }
    reads++; return reads === 1 ? space() : space({ goals: [goal()], total: 12 });
  });
  const client = new LifeClient(childId, 'child', request, () => `key-${++keys}`, () => {});
  await client.load(); const pending = client.create(input); await client.create(input);
  assert.equal(client.state.busy, true); assert.equal(posts, 1); assert.equal(keys, 1);
  gate.resolve({ goal: goal(), replayed: false }); await pending;
  assert.equal(client.state.data?.total, 12); assert.equal(client.state.saved, true); assert.equal(client.state.busy, false);
});

test('an uncertain receipt retries the exact key; changed choices use a new key without claiming prior success', async () => {
  const headers: string[] = []; let posts = 0;
  const request = transport(async (_path, method, _data, supplied) => {
    if (method !== 'POST') return space();
    posts++; headers.push(supplied!['Idempotency-Key']);
    if (posts < 3) throw new Error('connection interrupted');
    return { goal: goal(), replayed: false };
  });
  let keys = 0;
  const client = new LifeClient(childId, 'child', request, () => `key-${++keys}`, () => {});
  await client.load(); await client.create(input);
  assert.equal(client.state.saved, false); assert.equal(client.state.error, 'REQUEST_FAILED');
  await client.create(input); await client.create({ ...input, templateId: 'steps' });
  assert.deepEqual(headers, ['key-1', 'key-1', 'key-2']);
  assert.equal(client.state.saved, true);
});

test('conflicts refresh the winning version and never replay a stale action automatically', async () => {
  let writes = 0, reads = 0;
  const current = goal({ state: 'proposed' }), updated = goal({ state: 'active', version: 2, support: 'space' });
  const request = transport(async (_path, method, data, headers) => {
    if (method === 'PATCH') {
      writes++; assert.deepEqual(data, { action: 'decline' }); assert.equal(headers?.['If-Match'], '"1"'); throw failure('GOAL_CONFLICT');
    }
    return space({ goals: [++reads === 1 ? current : updated], total: 1 });
  });
  const client = new LifeClient(childId, 'child', request, () => 'synthetic-command-key', () => {});
  await client.load(); await client.act(current, { action: 'decline' });
  assert.equal(writes, 1); assert.equal(client.state.error, 'GOAL_CONFLICT'); assert.equal(client.state.saved, false);
  assert.deepEqual(client.state.data?.goals, [updated]);
});

test('a confirmed write with a failed history refresh remains confirmed and requires a read before more choices', async () => {
  let reads = 0, writes = 0, offline = true;
  const request = transport(async (_path, method) => {
    if (method === 'POST') { writes++; return { goal: goal(), replayed: false }; }
    if (++reads > 1 && offline) throw new Error('offline');
    return space({ goals: writes ? [goal()] : [], total: writes });
  });
  const client = new LifeClient(childId, 'child', request, () => 'confirmed-key', () => {});
  await client.load(); await client.create(input);
  assert.equal(client.state.saved, true); assert.equal(client.state.error, 'REFRESH_REQUIRED'); assert.equal(client.state.data, null);
  await client.create(input); assert.equal(writes, 1);
  offline = false; await client.load(); assert.equal((client.state as LifeClientState).data?.total, 1); assert.equal(client.state.error, '');
});

test('disposed views ignore late responses and cannot initiate a follow-up mutation or history read', async () => {
  const gate = deferred<unknown>(), changes: LifeClientState[] = []; let calls = 0;
  const request = transport(async (_path, method) => { calls++; return method === 'POST' ? gate.promise : space(); });
  const client = new LifeClient(childId, 'child', request, () => 'disposed-key', s => changes.push(s));
  await client.load(); const pending = client.create(input), count = changes.length; client.dispose();
  gate.resolve({ goal: goal(), replayed: false }); await pending; await client.create(input); await client.load();
  assert.equal(changes.length, count); assert.equal(calls, 2);
});

test('scope or profile changes clear data instead of displaying another identity’s records', async () => {
  for (const data of [space({ role: 'parent' }), space({ childId: 'another-child' }), space({ goals: [goal({ childId: 'another-child' })] })]) {
    const client = new LifeClient(childId, 'child', transport(async () => data), () => 'unused', () => {});
    await client.load(); assert.equal(client.state.data, null); assert.equal(client.state.error, 'ACCESS_CHANGED');
  }
  let reads = 0;
  const client = new LifeClient(childId, 'parent', transport(async (_path, method, data) => {
    if (method === 'POST') { assert.equal((data as { intent: string }).intent, 'suggest'); throw failure('PARENT_REQUIRED'); }
    reads++; return space({ role: 'parent' });
  }), () => 'parent-key', () => {});
  await client.load(); await client.create(input);
  assert.equal(client.state.data, null); assert.equal(client.state.error, 'PARENT_REQUIRED'); assert.equal(reads, 1);
});

test('withdrawal during a save refreshes to read-only and blocks subsequent commands', async () => {
  let writes = 0, reads = 0;
  const client = new LifeClient(childId, 'child', transport(async (_path, method) => {
    if (method === 'POST') { writes++; throw failure('CONSENT_REVOKED'); }
    return space({ collectionActive: ++reads === 1 });
  }), () => 'withdraw-key', () => {});
  await client.load(); await client.create(input); await client.create(input);
  assert.equal(writes, 1); assert.equal(client.state.data?.collectionActive, false); assert.equal(client.state.error, 'CONSENT_REVOKED');
});

test('an old service without the sharing contract cannot show or save reflection data',async()=>{
  const data=space() as Partial<LifeSpace>;delete data.sharingPolicy;let writes=0;
  const client=new LifeClient(childId,'child',transport(async(_p,m)=>{if(m)writes++;return data;}),()=> 'unused',()=>{});
  await client.load();await client.create(input);assert.equal(client.state.data,null);assert.equal(client.state.error,'SHARING_UPDATE_REQUIRED');assert.equal(writes,0);
});

test('no-share requests and their retries contain no local answers, and changed sharing uses a separate request',async()=>{
  const {reflectionAction}=await import('../../packages/family-support/model.ts');
  const choices={outcome:'tried' as const,helpful:'yes' as const,next:'rest' as const};
  const calls:{body:unknown;key:string}[]=[];let keys=0;
  const client=new LifeClient(childId,'child',transport(async(_p,m,data,headers)=>{
    if(m==='PATCH'){calls.push({body:data,key:headers!['Idempotency-Key']});throw new Error('network failed');}return space({goals:[goal()]});
  }),()=>`private-test-${++keys}`,()=>{});
  await client.load();await client.act(goal(),reflectionAction(false,choices));await client.act(goal(),reflectionAction(false,choices));
  assert.deepEqual(calls.map(c=>c.body),[{action:'reflect',sharing:'none'},{action:'reflect',sharing:'none'}]);assert.equal(calls[0].key,calls[1].key);
  assert.equal(JSON.stringify(calls).includes('helpful'),false);
  await client.act(goal(),reflectionAction(true,choices));assert.notEqual(calls[2].key,calls[1].key);
  assert.deepEqual(calls[2].body,{action:'reflect',sharing:'family',reflection:choices});
});

test('removing previously shared answers stays available after collection stops and failed refresh hides stale answers',async()=>{
  const reflected=goal({state:'reflected',version:2,reflectionSharing:'family',reflection:{outcome:'partly',helpful:'unsure',next:'rest'}});let writes=0,reads=0;
  const client=new LifeClient(childId,'parent',transport(async(_p,m)=>{
    if(m==='PATCH'){writes++;return {goal:{...reflected,version:3,reflection:null,reflectionSharing:'withdrawn'}};}
    if(++reads>1)throw new Error('offline');return space({role:'parent',collectionActive:false,goals:[reflected]});
  }),()=> 'remove-after-stop',()=>{});
  await client.load();await client.act(reflected,{action:'unshare'});assert.equal(writes,1);assert.equal(client.state.data,null);assert.equal(client.state.saved,true);assert.equal(client.state.error,'REFRESH_REQUIRED');
});

test('life page failures retain records and position; polling, previous and latest reads use the intended position',async()=>{
  const paths:string[]=[],gate=deferred<unknown>();let pageCalls=0,offline=true;
  const first=space({goals:[goal({id:'recent',state:'stopped'})],total:2,history:{version:'life-history-1',pageSize:20,nextCursor:'older-page'}}),older=space({goals:[goal({id:'old',state:'stopped'})],total:2});
  const client=new LifeClient(childId,'child',transport(async(path,method)=>{
    assert.equal(method,undefined);paths.push(path);
    if(path.endsWith('cursor=older-page')){if(++pageCalls===1)await gate.promise;if(offline)throw new Error('offline');return older;}return first;
  }),()=> 'unused',()=>{});
  await client.load();const pending=client.move('older');assert.equal(client.state.paging,true);
  await client.move('older');await client.load();await client.act(first.goals[0],{action:'stop'});assert.equal(paths.length,2);
  gate.resolve(null);assert.equal(await pending,false);assert.equal(client.state.data,first);assert.equal(client.state.historyPage,1);assert.equal(client.state.historyError,'LIFE_HISTORY_PAGE_FAILED');
  offline=false;assert.equal(await client.move('older'),true);assert.equal(client.state.historyPage,2);assert.equal(client.state.historyError,'');
  await client.load();assert.equal(paths.at(-1),`/children/${childId}/life-goals/history?cursor=older-page`);assert.equal(client.state.historyPage,2);
  await client.move('newer');assert.equal(client.state.historyPage,1);await client.move('older');await client.load(true);assert.equal(client.state.historyPage,1);assert.equal(paths.at(-1),`/children/${childId}/life-goals/history`);
});

test('removing older answers keeps the history page while a newly saved goal returns to the latest history',async()=>{
  const reflected=goal({id:'older-reflection',state:'reflected',version:2,reflectionSharing:'family',reflection:{outcome:'tried',helpful:'yes',next:'rest'}});
  let removed=false,created=false;const paths:string[]=[];
  const client=new LifeClient(childId,'child',transport(async(path,method)=>{
    if(method==='PATCH'){removed=true;return {goal:{...reflected,version:3,reflectionSharing:'withdrawn',reflection:null}};}
    if(method==='POST'){created=true;return {goal:goal()};}
    paths.push(path);
    if(path.includes('cursor='))return space({goals:[removed?{...reflected,version:3,reflectionSharing:'withdrawn',reflection:null}:reflected],total:2});
    return space({goals:created?[goal()]:[],history:{version:'life-history-1',pageSize:20,nextCursor:'older-page'},total:2});
  }),()=> 'write-key',()=>{});
  await client.load();await client.move('older');await client.act(reflected,{action:'unshare'});
  assert.equal(client.state.historyPage,2);assert.equal(client.state.saved,true);assert.equal(client.state.data?.goals[0].reflection,null);assert(paths.at(-1)!.endsWith('cursor=older-page'));
  await client.create(input);assert.equal(client.state.historyPage,1);assert.equal(client.state.data?.goals[0].state,'active');assert.equal(paths.at(-1),`/children/${childId}/life-goals/history`);
});

test('history protocol and permission failures clear an already visible page',async()=>{
  const first=space({goals:[goal()],history:{version:'life-history-1',pageSize:20,nextCursor:'older-page'}});
  const broken=[{...first,history:undefined},{...first,history:{...first.history,pageSize:200}},space({goals:[goal(),goal({id:'second-open'})]}),space({goals:Array.from({length:21},(_,i)=>goal({id:String(i),state:'stopped'}))})];
  for(const response of broken){let reads=0;const client=new LifeClient(childId,'child',transport(async()=>++reads===1?first:response),()=> 'unused',()=>{});await client.load();await client.move('older');assert.equal(client.state.data,null);assert.equal(client.state.error,'LIFE_HISTORY_UPDATE_REQUIRED');}
  for(const code of ['UNAUTHENTICATED','OWNER_REQUIRED','MEMBER_PENDING','NOT_FOUND']){let reads=0;const client=new LifeClient(childId,'child',transport(async()=>{if(++reads>1)throw failure(code);return first;}),()=> 'unused',()=>{});await client.load();await client.move('older');assert.equal(client.state.data,null);assert.equal(client.state.error,code);}
});

test('leaving a paginated life view suppresses late data and page changes',async()=>{
  const gate=deferred<unknown>();let reads=0,updates=0;
  const client=new LifeClient(childId,'child',transport(async()=>++reads===1?space({history:{version:'life-history-1',pageSize:20,nextCursor:'older-page'}}):gate.promise),()=> 'unused',()=>updates++);
  await client.load();const pending=client.move('older'),before=updates;client.dispose();gate.resolve(space({goals:[goal({state:'stopped'})]}));assert.equal(await pending,false);assert.equal(updates,before);assert.equal(client.state.historyPage,1);
});

test('background life refresh does not lock paging and cannot overwrite a newer page or mutation',async()=>{
  for(const next of ['page','mutation'] as const){
    const gate=deferred<unknown>();let reads=0;
    const first=space({history:{version:'life-history-1',pageSize:20,nextCursor:'older-page'}}),older=space({goals:[goal({id:'older',state:'stopped'})]});
    const client=new LifeClient(childId,'child',transport(async(path,method)=>{
      if(method==='POST')return {goal:goal()};
      if(++reads===2)return gate.promise;
      return path.includes('cursor=')?older:reads>2?space({goals:[goal()]}):first;
    }),()=> 'background-write',()=>{});
    await client.load();const pending=client.refreshBackground();assert.equal(client.state.busy,false);
    await client.refreshBackground();assert.equal(reads,2);
    if(next==='page')await client.move('older');else await client.create(input);
    const current=client.state.data,saved=client.state.saved;
    gate.resolve(first);await pending;assert.equal(client.state.data,current);assert.equal(client.state.saved,saved);assert.equal(client.state.historyPage,next==='page'?2:1);
  }
});

test('quiet background refresh retains the history position, updates withdrawn answers and clears lost access',async()=>{
  const reflected=goal({state:'reflected',version:2,reflectionSharing:'family',reflection:{outcome:'tried',helpful:'yes',next:'rest'}});let background=false,denied=false;const paths:string[]=[];
  const client=new LifeClient(childId,'child',transport(async(path)=>{paths.push(path);if(denied)throw failure('UNAUTHENTICATED');return path.includes('cursor=')?space({goals:[background?{...reflected,version:3,reflection:null,reflectionSharing:'withdrawn'}:reflected]}):space({history:{version:'life-history-1',pageSize:20,nextCursor:'older-page'}});}),()=> 'unused',()=>{});
  await client.load();await client.move('older');background=true;await client.refreshBackground();assert.equal(client.state.historyPage,2);assert.equal(client.state.data?.goals[0].reflection,null);assert(paths.at(-1)!.endsWith('cursor=older-page'));assert.equal(client.state.busy,false);
  denied=true;await client.refreshBackground();assert.equal(client.state.data,null);assert.equal(client.state.error,'UNAUTHENTICATED');
});
