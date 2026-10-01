import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

test('Web and native age review routes enforce parent scope, version, CSRF and durable age changes', {timeout:45000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'focus-age-http-'));
  const socket=createServer();await new Promise((done,fail)=>{socket.once('error',fail);socket.listen(0,'127.0.0.1',done);});
  const port=socket.address().port;await new Promise(done=>socket.close(done));
  const base=`http://127.0.0.1:${port}`;let handle;
  async function boot(){
    handle=spawn(process.execPath,['apps/api/main.ts'],{env:{...process.env,APP_MODE:'local',DATABASE_URL:'',FOCUS_DATA_DIR:directory,API_PORT:String(port),STUDIO_PORT:'0'},stdio:['ignore','pipe','pipe']});
    await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Service timeout')),15000);handle.once('error',e=>{clearTimeout(timer);reject(e);});handle.once('exit',()=>{clearTimeout(timer);reject(new Error('Service exited'));});handle.stdout.on('data',data=>{if(String(data).includes('本地开发模式')){clearTimeout(timer);done();}});});
  }
  async function stop(){if(handle&&handle.exitCode===null){const ended=new Promise(done=>handle.once('exit',done));handle.kill('SIGTERM');await ended;}}
  async function call(path,auth={},method='GET',body,extra={}){
    const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(auth.native?{'X-Focus-Client':'native-local-v1',...(auth.token?{Authorization:`Bearer ${auth.token}`}:{})}:{Origin:base,...(auth.cookie?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf}:{})}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(8000)});
    return {response,body:await response.json()};
  }
  const web=result=>({cookie:result.response.headers.get('set-cookie').split(';')[0],csrf:result.body.csrf});
  const credentials={name:`Synthetic age ${randomUUID().slice(0,8)}`,password:'Synthetic age password!'};
  try{
    await boot();let p=web(await call('/auth/setup',{},'POST',{...credentials,timezone:'UTC',locale:'en',acknowledgedLocalUse:true}));
    const c=(await call('/children',p,'POST',{alias:'Synthetic Child',ageBand:'6-8',locale:'en',localConfirmation:true})).body;
    const path=`/children/${c.id}/age-review`;
    const first=await call(path,p);assert.equal(first.body.version,1);assert.equal(first.body.state,'current');
    const child=web(await call(`/children/${c.id}/enter`,p,'POST',{}));
    assert.equal((await call(path,child)).body.code,'PARENT_REQUIRED');
    p=web(await call('/auth/login',{},'POST',credentials));
    const input={targetAgeBand:'9-11',acknowledged:true};
    assert.equal((await call(path,p,'POST',input,{'Idempotency-Key':randomUUID()})).response.status,428);
    assert.equal((await call(path,p,'POST',input,{'If-Match':'"1"','Idempotency-Key':randomUUID(),'X-CSRF-Token':'wrong'})).body.code,'CSRF_REJECTED');
    const native={native:true,token:(await call('/auth/login',{native:true},'POST',credentials)).body.accessToken};
    const key=randomUUID();const pending=await call(path,native,'POST',input,{'If-Match':'"1"','Idempotency-Key':key});
    assert.equal(pending.body.state,'pending');assert.equal(pending.body.version,2);
    assert.equal((await call(path,native,'POST',input,{'If-Match':'"1"','Idempotency-Key':key})).body.version,2);
    assert.equal((await call(path,p,'POST',input,{'If-Match':'"1"','Idempotency-Key':randomUUID()})).body.code,'AGE_REVIEW_VERSION_CONFLICT');
    assert.equal((await call(path+'/apply',native,'POST',{acknowledged:true},{'If-Match':'"2"'})).body.code,'LOCAL_CONFIRMATION_REQUIRED');
    const applied=await call(path+'/apply',p,'POST',{acknowledged:true,localConfirmation:true},{'If-Match':'"2"'});
    assert.equal(applied.body.currentAgeBand,'9-11');assert.equal(applied.body.version,3);
    await stop();await boot();
    assert.equal((await call(path,native)).body.currentAgeBand,'9-11');
    assert.equal((await call('/me',p)).body.children[0].ageReview.state,'current');
  }finally{await stop();await rm(directory,{recursive:true,force:true});}
});
