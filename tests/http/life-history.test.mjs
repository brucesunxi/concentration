import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

test('life history supports owner and child HTTP pages, old clients, restart and older-answer removal',{timeout:45000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'focus-life-history-http-')),base='http://127.0.0.1:4268';let handle;
  async function boot(){
    handle=spawn(process.execPath,['apps/api/main.ts'],{cwd:resolve(import.meta.dirname,'../..'),env:{...process.env,APP_MODE:'local',DATABASE_URL:'',API_PORT:'4268',STUDIO_PORT:'0',FOCUS_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
    let diagnostics='';handle.stderr.on('data',b=>diagnostics+=String(b));
    await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Life history boot timeout')),15000);handle.once('error',e=>{clearTimeout(timer);reject(e);});handle.once('exit',()=>{clearTimeout(timer);reject(new Error('Life history exited: '+diagnostics));});handle.stdout.on('data',b=>{if(String(b).includes('本地开发模式')){clearTimeout(timer);done();}});});
  }
  async function stop(){if(!handle||handle.exitCode!==null)return;const stopped=new Promise(done=>handle.once('exit',done));handle.kill('SIGTERM');await stopped;}
  async function call(path,auth={},method='GET',data,extra={}){
    const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID(),...(auth.native?{'X-Focus-Client':'native-local-v1',...(auth.token?{Authorization:`Bearer ${auth.token}`}:{})}:{Origin:base,...(auth.cookie?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{})}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(10000)});
    return {response,body:await response.json()};
  }
  const credentials={name:'Synthetic life history HTTP',password:'Synthetic-life-history-http-2026!'};
  try{
    await boot();const setup=await call('/auth/setup',{},'POST',{...credentials,timezone:'UTC',locale:'en',acknowledgedLocalUse:true});
    const parent={cookie:setup.response.headers.get('set-cookie').split(';')[0],csrf:setup.body.csrf};
    const child=(await call('/children',parent,'POST',{alias:'Synthetic child',ageBand:'9-11',locale:'en',localConfirmation:true})).body;
    const nativeLogin=await call('/auth/login',{native:true},'POST',credentials),nativeParent={native:true,token:nativeLogin.body.accessToken};
    const entered=await call(`/children/${child.id}/enter`,nativeParent,'POST',{}),cp={native:true,token:entered.body.accessToken};
    const basePath=`/children/${child.id}/life-goals`,path=basePath+'/history';
    const contentHash=(await call(path,cp)).body.content.hash;
    for(let i=0;i<23;i++){
      const created=await call(basePath,cp,'POST',{intent:'choose',templateId:'steps',support:'space',contentHash});assert.equal(created.response.status,201);
      const saved=await call(basePath+'/'+created.body.goal.id,cp,'PATCH',{action:'reflect',sharing:'family',reflection:{outcome:'partly',helpful:'unsure',next:'rest'}},{'If-Match':'"1"'});assert.equal(saved.response.status,200);
    }
    const current=(await call(basePath,cp,'POST',{intent:'choose',templateId:'find',support:'space',contentHash})).body.goal;
    const first=await call(path,parent);assert.equal(first.response.headers.get('cache-control'),'no-store');assert.equal(first.body.goals.length,21);assert.equal(first.body.goals[0].id,current.id);
    const cursor=first.body.history.nextCursor,olderPath=path+'?cursor='+cursor,older=await call(olderPath,cp);assert.equal(older.body.goals.length,4);assert.equal(older.body.goals[0].id,current.id);assert.equal(older.body.history.nextCursor,null);
    assert.equal(new Set([...first.body.goals.slice(1),...older.body.goals.slice(1)].map(g=>g.id)).size,23);
    const legacy=await call(basePath,parent);assert.equal(legacy.body.goals.length,20);assert.equal('history' in legacy.body,false);
    for(const suffix of ['?cursor='+cursor+'&cursor='+cursor,'?limit=200','?cursor=','?cursor=%25%25%25'])assert.equal((await call(path+suffix,parent)).response.status,400);
    await stop();await boot();assert.deepEqual((await call(olderPath,cp)).body,older.body);
    const goal=older.body.goals[1];assert.equal((await call(basePath+'/'+goal.id,cp,'PATCH',{action:'unshare'},{'If-Match':`"${goal.version}"`})).response.status,200);
    const removed=await call(olderPath,parent);assert.equal(removed.body.goals[1].id,goal.id);assert.equal(removed.body.goals[1].reflection,null);assert.equal(removed.body.goals[1].reflectionSharing,'withdrawn');
    assert.equal((await call(olderPath,nativeParent)).response.status,401);
    assert.equal((await call(`/children/${child.id}/withdraw`,parent,'POST',{})).response.status,200);
    const stopped=await call(olderPath,parent);assert.equal(stopped.body.collectionActive,false);assert.equal(stopped.body.goals.length,3);assert.equal((await call(olderPath,cp)).response.status,401);
  }finally{await stop();await rm(directory,{recursive:true,force:true});}
});
