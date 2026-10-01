import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {completeEvents} from '../platform/fixtures.ts';
import {randomUUID,createHash} from 'node:crypto';
import {openDatabase,migrate} from '../../apps/api/database.ts';
import {fileStudioVault,provisionStudioUser,totp} from '../../apps/api/studio-auth.ts';
const root=resolve(import.meta.dirname,'../..'),base='http://127.0.0.1:4204',family='http://127.0.0.1:4201';
let processHandle;
async function boot(dataDir){processHandle=spawn(process.execPath,['apps/api/main.ts'],{cwd:root,env:{...process.env,APP_MODE:'local',DATABASE_URL:'',API_PORT:'4201',STUDIO_PORT:'4204',FOCUS_DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Studio API startup timeout')),15000);processHandle.once('error',e=>{clearTimeout(timer);reject(e);});processHandle.once('exit',()=>{clearTimeout(timer);reject(new Error('Studio process exited'));});processHandle.stdout.on('data',data=>{if(String(data).includes('本地开发模式')){clearTimeout(timer);resolve();}});});}
async function stop(){if(!processHandle||processHandle.exitCode!==null)return;await new Promise(resolve=>{processHandle.once('exit',resolve);processHandle.kill('SIGTERM');});}
async function call(path,{method='GET',data,cookie,csrf,key,match,origin=base,target=base,extra={}}={}){
  const response=await fetch(target+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(key?{'Idempotency-Key':key}:{}),...(match?{'If-Match':match}:{}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(10000)});return {response,body:await response.json()};
}
test('independent studio HTTP origin enforces MFA, role separation and immutable review publication/recall across restart',{timeout:90000},async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'focus-studio-http-')),db=await openDatabase(resolve(dataDir,'postgres')),vault=fileStudioVault(dataDir),identities={},sessions={};
  try{
    await migrate(db);for(const role of ['editor','method-reviewer','language-reviewer','publisher'])identities[role]=await provisionStudioUser(db,vault,{login:role,name:'Synthetic '+role,role,password:'Synthetic-studio-2026!'});identities.english=await provisionStudioUser(db,vault,{login:'english',name:'Synthetic English reviewer',role:'language-reviewer',password:'Synthetic-studio-2026!'});await db.close();
    await boot(dataDir);
    assert.equal((await call('/api/studio/me')).response.status,401);
    const parent=await call('/api/auth/setup',{target:family,origin:family,method:'POST',data:{name:'Synthetic studio family',password:'Synthetic-family-2026!',timezone:'UTC',locale:'zh-CN',acknowledgedLocalUse:true}});
    const parentSession={target:family,origin:family,cookie:parent.response.headers.get('set-cookie').split(';')[0],csrf:parent.body.csrf};
    assert.equal((await call('/api/studio/me',{cookie:parentSession.cookie})).response.status,401);
    for(const role of Object.keys(identities)){
      const credentials={login:role,password:'Synthetic-studio-2026!',code:totp((await vault.read(identities[role].id)).totp,Date.now())};
      assert.equal((await call('/api/studio/auth/login',{method:'POST',origin:family,data:credentials})).body.code,'ORIGIN_REJECTED');
      const login=await call('/api/studio/auth/login',{method:'POST',data:credentials});assert.equal(login.response.status,200);
      const cookie=login.response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Path=\/api\/studio/);assert.equal(login.body.accessToken,undefined);
      sessions[role]={cookie:cookie.split(';')[0],csrf:login.body.csrf};
      assert.equal((await call('/api/studio/auth/login',{method:'POST',data:credentials})).body.code,'STUDIO_LOGIN_REJECTED');
    }
    const supportChild=(await call('/api/children',{...parentSession,method:'POST',data:{alias:'Synthetic guide',ageBand:'9-11',locale:'en',localConfirmation:true}})).body;
    const supportSource=(await call('/api/studio/support',sessions.editor)).body.releases.find(r=>r.age_band==='9-11');
    let support=(await call('/api/studio/support',{...sessions.editor,method:'POST',key:randomUUID(),data:{sourceHash:supportSource.hash,version:'99.24.0-http'}})).body;
    const supportPath='/api/studio/support/'+support.draft.id;
    const edit=structuredClone(support.draft.pack);edit.lessons[0].title.en='Synthetic HTTP guide title';
    support=(await call(supportPath,{...sessions.editor,method:'PATCH',key:randomUUID(),match:`"${support.draft.version}"`,data:edit})).body;
    support=(await call(supportPath+'/submit',{...sessions.editor,method:'POST',key:randomUUID(),match:`"${support.draft.version}"`,data:{}})).body;
    for(const [role,scope] of [['method-reviewer','method'],['language-reviewer','language:zh-CN'],['english','language:en']]){
      const result=await call(supportPath+'/review',{...sessions[role],method:'POST',key:randomUUID(),match:`"${support.draft.version}"`,data:{scope,decision:'approve',note:'Synthetic HTTP review fixture only, not a professional review.',sections:[...Array.from({length:9},(_,i)=>`lesson:${i}`),...['find','turns','steps','return'].map(id=>`template:${id}`)],checks:{ageAppropriate:true,choiceAndRest:true,claims:true,language:true}}});assert.equal(result.response.status,200);support=result.body;
    }
    support=(await call(supportPath+'/publish',{...sessions.publisher,method:'POST',key:randomUUID(),match:`"${support.draft.version}"`,data:{confirmHash:support.draft.candidate_hash,days:7}})).body;
    const guidePath=`/api/children/${supportChild.id}/parent-guide`,goalsPath=`/api/children/${supportChild.id}/life-goals`;
    assert.equal((await call(guidePath,parentSession)).body.lessons[0].title.en,'Synthetic HTTP guide title');
    const supportGoal=(await call(goalsPath,{...parentSession,method:'POST',key:randomUUID(),data:{intent:'suggest',templateId:'find',support:'space',contentHash:support.draft.published_hash}})).body.goal;
    const supportRecall={confirmHash:support.draft.published_hash,reason:'Synthetic HTTP recall verification; no real family rollout.'};
    support=(await call(supportPath+'/recall',{...sessions.publisher,method:'POST',key:randomUUID(),match:`"${support.draft.version}"`,data:supportRecall})).body;assert.equal(support.draft.state,'recalled');
    assert.equal((await call(guidePath,parentSession)).body.code,'FAMILY_CONTENT_RECALLED');
    const stopped=await call(goalsPath+'/'+supportGoal.id,{...parentSession,method:'PATCH',key:randomUUID(),match:'"1"',data:{action:'stop'}});assert.equal(stopped.response.status,200);
    assert.equal((await call(goalsPath,parentSession)).body.goals[0].contentHash,supportRecall.confirmHash);
    assert.equal((await call('/api/me',{target:family,origin:family,...sessions.editor})).response.status,401);
    assert.equal((await call('/api/studio/me',{...sessions.editor,extra:{Authorization:'Bearer '+'a'.repeat(64)}})).body.code,'STUDIO_TRANSPORT_REJECTED');
    const catalogue=(await call('/api/studio/catalogue',sessions.editor)).body.releases;
    const source=catalogue.find(r=>r.pack_id==='focus.search.6-8.zh-CN');assert.ok(source);
    const creation={sourceHash:source.hash,version:'99.0.0-http-qa'},key=randomUUID();
    assert.equal((await call('/api/studio/drafts',{...sessions.editor,method:'POST',csrf:'incorrect',data:creation,key})).body.code,'CSRF_REJECTED');
    const created=await call('/api/studio/drafts',{...sessions.editor,method:'POST',data:creation,key});assert.equal(created.response.status,201);
    const id=created.body.draft.id,path='/api/studio/drafts/'+id;
    assert.equal((await call('/api/studio/drafts',{...sessions.editor,method:'POST',data:creation,key})).body.draft.id,id);
    assert.equal((await call(path+'/submit',{...sessions.editor,method:'POST',data:{},key:randomUUID()})).response.status,428);
    let d=created.body;
    const imported=[];
    for(const kind of ['characters','guide']){
      const bytes=kind==='characters'?await sharp({create:{width:256,height:256,channels:4,background:'#758b91'}}).png().toBuffer():(await promisify(execFile)(process.env.FOCUS_FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-i',resolve(root,'src/audio/search-rule.mp3'),'-af','volume=0.97','-c:a','libmp3lame','-b:a','96k','-f','mp3','pipe:1'],{encoding:'buffer',maxBuffer:5*1024*1024,timeout:10000})).stdout;
      const metadata={name:'Synthetic HTTP '+kind,kind,source:'Synthetic local HTTP asset import fixture.',rights:'Synthetic QA only; not actual professional approval.',rightsConfirmed:true,ageBands:['6-8'],...(kind==='guide'?{locale:'zh-CN',voice:'Existing synthetic audio fixture',transcript:d.draft.pack.copy.rule}:{layoutConfirmed:true})};
      const begin=await call('/api/studio/media-imports',{...sessions.editor,method:'POST',key:randomUUID(),data:{metadata,sourceHash:createHash('sha256').update(bytes).digest('hex'),sourceBytes:bytes.length}});assert.equal(begin.response.status,201);
      const uploadPath='/api/studio/media-imports/'+begin.body.id+'/file';
      const headers={Origin:base,Cookie:sessions.editor.cookie,'X-CSRF-Token':sessions.editor.csrf,'Content-Type':kind==='guide'?'audio/mpeg':'image/png'};
      assert.equal((await fetch(base+uploadPath,{method:'PUT',headers:{...headers,'X-CSRF-Token':'wrong'},body:bytes})).status,403);
      const uploaded=await fetch(base+uploadPath,{method:'PUT',headers,body:bytes});assert.equal(uploaded.status,200);const media=await uploaded.json();assert.equal(media.state,'ready');
      const mediaPath='/content-assets/'+media.asset_hash+(kind==='guide'?'.mp3':'.png');
      assert.equal((await fetch(family+mediaPath)).status,404);
      d=(await call(path+'/assets',{...sessions.editor,method:'POST',key:randomUUID(),match:`"${d.draft.version}"`,data:{mediaId:media.id,slot:kind}})).body;
      imported.push({path:mediaPath,hash:media.asset_hash});
    }
    assert.equal(d.mediaSources.length,2);
    d=(await call(path+'/submit',{...sessions.editor,method:'POST',data:{},key:randomUUID(),match:`"${d.draft.version}"`})).body;
    const review={decision:'approve',note:'Synthetic HTTP workflow verification, not an actual professional content approval.',checks:{instructions:true,ageAndLanguage:true,assets:true,claims:true},audioReviewedHashes:d.draft.pack.assets.filter(asset=>asset.mime==='audio/mpeg').map(asset=>asset.sha256)};
    assert.equal((await call(path+'/review',{...sessions.editor,method:'POST',data:review,key:randomUUID(),match:`"${d.draft.version}"`})).body.code,'STUDIO_ROLE_REQUIRED');
    for(const role of ['method-reviewer','language-reviewer']){
      assert.equal((await call(path+'/review',{...sessions[role],method:'POST',data:review,key:randomUUID(),match:`"${d.draft.version}"`})).body.code,'STUDIO_PREVIEW_REQUIRED');
      const run=await call(path+'/preview',{...sessions[role],method:'POST',data:{confirmHash:d.draft.candidate_hash,level:1,seed:'http-preview',environment:{platform:'web',deviceClass:'desktop',input:'pointer',modality:'visual'}},key:randomUUID(),match:`"${d.draft.version}"`});assert.equal(run.response.status,201);
      const receipt=await call('/api/studio/previews/'+run.body.id+'/finish',{...sessions[role],method:'POST',data:{events:completeEvents(run.body.plan)}});assert.equal(receipt.body.complete,true);
      const response=await call(path+'/review',{...sessions[role],method:'POST',data:{...review,previewId:run.body.id},key:randomUUID(),match:`"${d.draft.version}"`});assert.equal(response.response.status,200);d=response.body;
    }
    const publication={confirmHash:d.draft.candidate_hash,days:7};
    d=(await call(path+'/publish',{...sessions.publisher,method:'POST',data:publication,key:randomUUID(),match:`"${d.draft.version}"`})).body;assert.equal(d.draft.state,'published');
    const packHash=d.draft.published_hash;
    for(const asset of imported){const file=await fetch(family+asset.path);assert.equal(file.status,200);assert.equal(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'),asset.hash);}
    const child=(await call('/api/children',{...parentSession,method:'POST',data:{alias:'Synthetic preview',ageBand:'6-8',locale:'zh-CN',localConfirmation:true}})).body;
    const start=await call(`/api/children/${child.id}/sessions`,{...parentSession,method:'POST',key:randomUUID(),data:{task:'search',deviceId:randomUUID(),environment:{platform:'web',deviceClass:'desktop',input:'pointer',modality:'visual'}}});assert.equal(start.body.plan.content.sha256,packHash);
    const childSession={target:family,origin:family,cookie:start.response.headers.get('set-cookie').split(';')[0],csrf:start.body.csrf};
    const media=await fetch(base+'/api/studio/media/'+d.draft.pack.assets[0].path.split('/').at(-1),{headers:{Cookie:sessions.editor.cookie}});assert.equal(media.status,200);assert.equal(media.headers.get('cache-control'),'no-store');
    await stop();await boot(dataDir);
    assert.equal((await call('/api/studio/me',sessions.editor)).body.user.role,'editor');
    assert.equal((await call(supportPath,sessions.publisher)).body.draft.state,'recalled');
    assert.equal((await call('/api/studio/library',sessions.editor)).body.items.filter(x=>x.state==='ready').length,2);
    for(const asset of imported){const file=await fetch(family+asset.path);assert.equal(file.status,200);assert.equal(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'),asset.hash);}
    d=(await call(path,sessions.publisher)).body;assert.equal(d.draft.published_hash,packHash);assert.equal(d.reviews.length,2);assert.equal(d.previews.filter(r=>r.receipt?.complete).length,2);
    const recallKey=randomUUID(),recallMatch=`"${d.draft.version}"`,reason={confirmHash:packHash,reason:'Synthetic local recall drill; no real family content release.'};
    assert.equal((await call(path+'/recall',{...sessions.publisher,method:'POST',data:reason,key:recallKey,match:recallMatch})).body.draft.state,'recalled');
    assert.equal((await call(path+'/recall',{...sessions.publisher,method:'POST',data:reason,key:recallKey,match:recallMatch})).body.draft.state,'recalled');
    assert.equal((await call(`/api/sessions/${start.body.id}/status`,childSession)).body.code,'CONTENT_RECALLED');
    for(const asset of imported)assert.equal((await fetch(family+asset.path)).status,404);
    assert.equal((await call('/api/studio/auth/logout',{...sessions.editor,method:'POST',data:{}})).response.status,200);
    assert.equal((await call('/api/studio/me',sessions.editor)).response.status,401);
  }finally{await stop();await db.close().catch(()=>{});await rm(dataDir,{recursive:true,force:true});}
});
