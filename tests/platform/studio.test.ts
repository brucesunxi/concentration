import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase,migrate} from '../../apps/api/database.ts';
import {createLocalContent} from '../../apps/api/content.ts';
import {studioAuth,provisionStudioUser,StudioError,totp} from '../../apps/api/studio-auth.ts';
import type {StudioVault,StudioSecret,StudioRole,StudioPrincipal} from '../../apps/api/studio-auth.ts';
import {studioPreview} from '../../apps/api/studio-preview.ts';
import {verifyCandidatePreview} from '../../packages/content/preview-client.ts';
import {hashObject} from '../../packages/content/index.ts';
import {contentStudio} from '../../apps/api/content-studio.ts';
import {verifyRelease,ContentError} from '../../packages/content/index.ts';
import {service} from '../../apps/api/service.ts';
import {TEST_ENVIRONMENT} from '../../packages/task-engine/index.ts';
import {completeEvents} from './fixtures.ts';
const rejected=(code:string)=>(e:unknown)=>e instanceof StudioError&&e.code===code;
const password='Synthetic-studio-2026!';
const checks={instructions:true,ageAndLanguage:true,assets:true,claims:true};
const review={decision:'approve',note:'Synthetic automated workflow fixture only. This is not a real professional review.',checks};
const reviewFor=(d:{draft:{pack:{assets:{mime:string;sha256:string}[]}}})=>({...review,audioReviewedHashes:d.draft.pack.assets.filter(a=>a.mime==='audio/mpeg').map(a=>a.sha256)});
const roles:StudioRole[]=['editor','method-reviewer','language-reviewer','publisher'];
async function fixture(){
  const db=await openDatabase('memory://');await migrate(db);let clock=Date.parse('2026-09-30T12:00:00Z');const now=()=>clock;
  const secrets=new Map<string,StudioSecret>(),vault:StudioVault={async read(id){return secrets.get(id)!;},async write(id,value){assert.equal(secrets.has(id),false);secrets.set(id,value);}};
  const content=await createLocalContent(db,{now}),auth=studioAuth(db,vault,now),studio=contentStudio(db,content,auth,now);
  const identities={} as Record<StudioRole,Awaited<ReturnType<typeof provisionStudioUser>>>,users={} as Record<StudioRole,StudioPrincipal>;
  for(const role of roles){identities[role]=await provisionStudioUser(db,vault,{login:role,name:'Synthetic '+role,role,password},now());const result=await auth.login({login:role,password,code:totp(secrets.get(identities[role].id)!.totp,now())});users[role]=(await auth.authenticate(result.value))!;}
  const source=(await content.pick('search','6-8','zh-CN')).sha256;
  return {db,content,auth,studio,previews:studioPreview(db,content,auth,now),users,identities,secrets,now,advance:(ms:number)=>{clock+=ms;},source,close:()=>db.close()};
}
const etag=(d:{draft:{version:number}})=>`"${d.draft.version}"`;
async function submitted(f:Awaited<ReturnType<typeof fixture>>,version='99.0.0-qa'){
  const d=await f.studio.create(f.users.editor,{sourceHash:f.source,version},randomUUID());return f.studio.submit(f.users.editor,d.draft.id,etag(d),randomUUID());
}
async function approve(f:Awaited<ReturnType<typeof fixture>>,d:Awaited<ReturnType<typeof submitted>>,role:'method-reviewer'|'language-reviewer'){
  const run=await f.previews.start(f.users[role],d.draft.id,{confirmHash:d.draft.candidate_hash,level:1,seed:'automated-review',environment:TEST_ENVIRONMENT},etag(d),randomUUID());
  await f.previews.finish(f.users[role],run.id,{events:completeEvents(run.plan)});
  return f.studio.review(f.users[role],d.draft.id,{...reviewFor(d),previewId:run.id},etag(d),randomUUID());
}
async function ready(f:Awaited<ReturnType<typeof fixture>>){let d=await submitted(f);d=await approve(f,d,'method-reviewer');return approve(f,d,'language-reviewer');}

test('studio TOTP agrees with the RFC 6238 vectors including times after 2038',()=>{
  const cases=[[59,'94287082','46119246','90693936'],[1111111109,'07081804','68084774','25091201'],[1111111111,'14050471','67062674','99943326'],[1234567890,'89005924','91819424','93441116'],[2000000000,'69279037','90698825','38618901'],[20000000000,'65353130','77737706','47863826']];
  for(const [at,...expected] of cases)for(const [i,length] of [20,32,64].entries()){const secret='1234567890'.repeat(7).slice(0,length);assert.equal(totp(Buffer.from(secret).toString('hex'),Number(at)*1000,8,['sha1','sha256','sha512'][i]),expected[i]);}
});
test('studio authentication rejects reused OTPs, expired sessions and disabled identities',async()=>{
  const f=await fixture();try{
    const id=f.identities.editor.id,code=totp(f.secrets.get(id)!.totp,f.now());
    await assert.rejects(f.auth.login({login:'editor',password,code}),rejected('STUDIO_LOGIN_REJECTED'));
    f.advance(30000);await f.auth.reauth(f.users.editor,{login:'editor',password,code:totp(f.secrets.get(id)!.totp,f.now())});
    await f.db.query('UPDATE studio_users SET enabled=false WHERE id=$1',[id]);
    await assert.rejects(f.studio.list(f.users.editor),rejected('STUDIO_UNAUTHENTICATED'));
    f.advance(2*3600000);await assert.rejects(f.studio.list(f.users.publisher),rejected('STUDIO_UNAUTHENTICATED'));
  }finally{await f.close();}
});
test('studio credentials enforce persistent failed-attempt lockout and a consumed time-step cannot be replayed concurrently',async()=>{
  const f=await fixture();try{
    f.advance(30000);const input={login:'editor',password,code:totp(f.secrets.get(f.identities.editor.id)!.totp,f.now())};
    const results=await Promise.allSettled([f.auth.login(input),f.auth.login(input)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    for(let i=0;i<8;i++)await assert.rejects(f.auth.login({...input,password:'incorrect-password'}),rejected('STUDIO_LOGIN_REJECTED'));
    f.advance(30000);await assert.rejects(f.auth.login({...input,code:totp(f.secrets.get(f.identities.editor.id)!.totp,f.now())}),rejected('STUDIO_LOGIN_REJECTED'));
    assert.equal((await f.db.query<{n:number}>('SELECT failed_count AS n FROM studio_users WHERE id=$1',[f.identities.editor.id])).rows[0].n,8);
  }finally{await f.close();}
});
test('draft creation retries are idempotent; conflicts, wrong roles and stale edits are refused',async()=>{
  const f=await fixture();try{
    const key=randomUUID(),input={sourceHash:f.source,version:'99.0.0-qa'};
    const [a,b]=await Promise.all([f.studio.create(f.users.editor,input,key),f.studio.create(f.users.editor,input,key)]);assert.equal(a.draft.id,b.draft.id);
    await assert.rejects(f.studio.create(f.users.publisher,input,randomUUID()),rejected('STUDIO_ROLE_REQUIRED'));
    await assert.rejects(f.studio.create(f.users.editor,{...input,version:'99.0.1-qa'},key),rejected('STUDIO_REQUEST_CONFLICT'));
    const change={version:input.version,copy:{...a.draft.pack.copy,title:'Synthetic edited title'},removeAudio:false};
    const edited=await f.studio.edit(f.users.editor,a.draft.id,change,etag(a),randomUUID());assert.equal(edited.draft.round,2);
    await assert.rejects(f.studio.edit(f.users.editor,a.draft.id,change,etag(a),randomUUID()),rejected('STUDIO_CONFLICT'));
    const original=await f.content.get(f.source);assert.notEqual(original.body.pack.copy.title,edited.draft.pack.copy.title);assert.equal(original.body.pack.review,'unreviewed');
  }finally{await f.close();}
});
test('editing audio-linked wording requires removing the old guide and submission freezes the reviewed version',async()=>{
  const f=await fixture();try{
    const d=await f.studio.create(f.users.editor,{sourceHash:f.source,version:'99.0.0-qa'},randomUUID());
    const change={version:d.draft.pack.version,copy:{...d.draft.pack.copy,rule:'Synthetic replacement instruction for workflow testing.'},removeAudio:false};
    await assert.rejects(f.studio.edit(f.users.editor,d.draft.id,change,etag(d),randomUUID()));
    const edited=await f.studio.edit(f.users.editor,d.draft.id,{...change,removeAudio:true},etag(d),randomUUID());assert.equal(edited.draft.pack.audio,undefined);assert.equal(edited.draft.pack.assets.some(a=>a.mime==='audio/mpeg'),false);
    const pending=await f.studio.submit(f.users.editor,d.draft.id,etag(edited),randomUUID());
    await assert.rejects(f.studio.edit(f.users.editor,d.draft.id,{...change,removeAudio:true},etag(pending),randomUUID()),rejected('STUDIO_EDIT_LOCKED'));
  }finally{await f.close();}
});
test('a changes decision requires a new round and prior approval cannot carry into revised content',async()=>{
  const f=await fixture();try{
    let d=await submitted(f);d=await approve(f,d,'method-reviewer');
    d=await f.studio.review(f.users['language-reviewer'],d.draft.id,{...review,decision:'changes',checks:{...checks,assets:false}},etag(d),randomUUID());assert.equal(d.draft.state,'changes-requested');
    const oldHash=d.draft.candidate_hash;d=await f.studio.edit(f.users.editor,d.draft.id,{version:d.draft.pack.version,copy:{...d.draft.pack.copy,title:'Synthetic revised title'},removeAudio:false},etag(d),randomUUID());
    d=await f.studio.submit(f.users.editor,d.draft.id,etag(d),randomUUID());assert.notEqual(d.draft.candidate_hash,oldHash);assert.equal(d.reviews.length,2);
    d=await approve(f,d,'language-reviewer');assert.equal(d.draft.state,'in-review');
    await assert.rejects(f.studio.publish(f.users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:7},etag(d),randomUUID()),rejected('STUDIO_PUBLISH_LOCKED'));
  }finally{await f.close();}
});
test('approval requires all checks and recent MFA; revoked reviewers prevent new publication',async()=>{
  const f=await fixture();try{
    let d=await submitted(f);
    await assert.rejects(f.studio.review(f.users['method-reviewer'],d.draft.id,{...review,checks:{...checks,claims:false}},etag(d),randomUUID()),rejected('STUDIO_CHECKS_REQUIRED'));
    f.advance(11*60000);await assert.rejects(f.studio.review(f.users['method-reviewer'],d.draft.id,review,etag(d),randomUUID()),rejected('STUDIO_REAUTH_REQUIRED'));
    for(const role of ['method-reviewer','language-reviewer','publisher'] as StudioRole[]){await f.auth.reauth(f.users[role],{login:role,password,code:totp(f.secrets.get(f.identities[role].id)!.totp,f.now())});}
    d=await approve(f,d,'method-reviewer');d=await approve(f,d,'language-reviewer');
    await f.db.query('UPDATE studio_users SET enabled=false WHERE id=$1',[f.identities['method-reviewer'].id]);
    await assert.rejects(f.studio.publish(f.users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:7},etag(d),randomUUID()),rejected('STUDIO_REVIEWER_UNAVAILABLE'));
  }finally{await f.close();}
});
test('audio approval names the exact recording bytes and legacy unchecked approvals cannot publish',async()=>{
  const f=await fixture();try{
    let d=await submitted(f);
    await assert.rejects(f.studio.review(f.users['method-reviewer'],d.draft.id,review,etag(d),randomUUID()),rejected('STUDIO_AUDIO_REVIEW_REQUIRED'));
    await assert.rejects(f.studio.review(f.users['method-reviewer'],d.draft.id,{...review,audioReviewedHashes:['0'.repeat(64)]},etag(d),randomUUID()),rejected('STUDIO_AUDIO_REVIEW_REQUIRED'));
    d=await approve(f,d,'method-reviewer');
    assert.deepEqual((d.reviews[0].checks as {audioReviewedHashes:string[]}).audioReviewedHashes,reviewFor(d).audioReviewedHashes);
    d=await approve(f,d,'language-reviewer');
    await f.db.query('UPDATE studio_reviews SET checks=$2 WHERE draft_id=$1 AND role=$3',[d.draft.id,checks,'language-reviewer']);
    await assert.rejects(f.studio.publish(f.users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:7},etag(d),randomUUID()),rejected('STUDIO_AUDIO_REVIEW_REQUIRED'));
  }finally{await f.close();}
});
test('signed reviewed previews change only new plans, remain local-only, and recall blocks even duplicate uploads',async()=>{
  const f=await fixture();try{
    const api=service(f.db,f.now,f.content),login=await api.setup({name:'Synthetic studio integration',password,timezone:'UTC',locale:'zh-CN',acknowledgedLocalUse:true}),parent=(await api.authenticate(login.value))!;
    const child=await api.addChild(parent,{alias:'Synthetic only',ageBand:'6-8',locale:'zh-CN',localConfirmation:true});
    const old=await api.start(parent,child.id,{task:'search',deviceId:randomUUID(),environment:TEST_ENVIRONMENT},randomUUID());
    let d=await ready(f);const key=randomUUID(),input={confirmHash:d.draft.candidate_hash,days:7},match=etag(d);
    d=await f.studio.publish(f.users.publisher,d.draft.id,input,match,key);assert.equal(d.draft.state,'published');
    assert.equal((await f.studio.publish(f.users.publisher,d.draft.id,input,match,key)).draft.published_hash,d.draft.published_hash);
    const envelope=await f.content.get(d.draft.published_hash!);assert.equal(envelope.body.approvals.length,2);assert.equal(envelope.body.channel,'reviewed-preview');await verifyRelease(envelope,await f.content.trust(),{mode:'local',market:'LOCAL',now:f.now()});
    await assert.rejects(verifyRelease(envelope,await f.content.trust(),{mode:'production',market:'LOCAL',now:f.now()}),e=>e instanceof ContentError&&e.code==='LOCAL_ONLY_CONTENT');
    assert.equal((await f.content.pick('search','6-8','zh-CN')).sha256,d.draft.published_hash);assert.equal(old.session.plan.content!.sha256,f.source);
    const login2=await api.login({name:'Synthetic studio integration',password}),parent2=(await api.authenticate(login2.value))!;const child2=await api.addChild(parent2,{alias:'Synthetic second',ageBand:'6-8',locale:'zh-CN',localConfirmation:true});
    const current=await api.start(parent2,child2.id,{task:'search',deviceId:randomUUID(),environment:TEST_ENVIRONMENT},randomUUID()),scope=(await api.authenticate(current.auth.value))!,batch=completeEvents(current.session.plan).slice(0,1);await api.append(scope,current.session.id,{events:batch});
    const previewId=String(d.previews.find(r=>r.actor===f.users['method-reviewer'].id)!.id);
    const reviewedRun=await f.previews.get(f.users['method-reviewer'],previewId);
    const recallKey=randomUUID(),recallMatch=etag(d),recallInput={confirmHash:d.draft.published_hash,reason:'Synthetic recall drill only; no real content assessment.'};
    d=await f.studio.recall(f.users.publisher,d.draft.id,recallInput,recallMatch,recallKey);await f.studio.recall(f.users.publisher,d.draft.id,recallInput,recallMatch,recallKey);
    await assert.rejects(f.previews.get(f.users['method-reviewer'],previewId),rejected('STUDIO_PREVIEW_STALE'));
    await assert.rejects(f.previews.finish(f.users['method-reviewer'],previewId,{events:completeEvents(reviewedRun.plan)}),rejected('STUDIO_PREVIEW_STALE'));
    await assert.rejects(api.append(scope,current.session.id,{events:batch}),e=>e instanceof ContentError&&e.code==='CONTENT_RECALLED');
    assert.equal((await f.db.query<{state:string}>('SELECT state FROM sessions WHERE id=$1',[current.session.id])).rows[0].state,'revoked');
    await assert.rejects(f.content.pick('search','6-8','zh-CN'),e=>e instanceof ContentError&&e.code==='CONTENT_RECALLED');
    assert.equal((await f.content.get(f.source)).body.packHash,f.source);
    assert.equal((await f.db.query<{n:number}>("SELECT count(*)::int n FROM content_audit WHERE hash=$1 AND action='recalled'",[d.draft.published_hash])).rows[0].n,1);
  }finally{await f.close();}
});


test('candidate preview gates approval by actor, exact round, completion and immutable observations',async()=>{
  const f=await fixture();try{
    let d=await submitted(f);const p=f.users['method-reviewer'],input={confirmHash:d.draft.candidate_hash,level:2,seed:'repeatable-review',environment:TEST_ENVIRONMENT},key=randomUUID();
    await assert.rejects(f.studio.review(p,d.draft.id,reviewFor(d),etag(d),randomUUID()),rejected('STUDIO_PREVIEW_REQUIRED'));
    const run=await f.previews.start(p,d.draft.id,input,etag(d),key);assert.equal((await f.previews.start(p,d.draft.id,input,etag(d),key)).id,run.id);
    await verifyCandidatePreview(run);
    await assert.rejects(f.previews.start(p,d.draft.id,{...input,level:3},etag(d),key),rejected('STUDIO_REQUEST_CONFLICT'));
    await assert.rejects(f.previews.get(f.users['language-reviewer'],run.id),rejected('STUDIO_PREVIEW_NOT_FOUND'));
    await assert.rejects(f.previews.finish(f.users['language-reviewer'],run.id,{events:completeEvents(run.plan)}),rejected('STUDIO_PREVIEW_NOT_FOUND'));
    await assert.rejects(f.previews.finish(p,run.id,{events:completeEvents(run.plan).slice(0,1)}),rejected('STUDIO_PREVIEW_UNFINISHED'));
    const early=[{id:randomUUID(),seq:1,at:10,type:'end',reason:'child_stopped'}];
    const partial=await f.previews.finish(p,run.id,{events:early});assert.equal(partial.complete,false);
    await assert.rejects(f.studio.review(p,d.draft.id,{...reviewFor(d),previewId:run.id},etag(d),randomUUID()),rejected('STUDIO_PREVIEW_REQUIRED'));
    await assert.rejects(f.previews.finish(p,run.id,{events:completeEvents(run.plan)}),rejected('STUDIO_PREVIEW_CONFLICT'));
    const complete=await f.previews.start(p,d.draft.id,input,etag(d),randomUUID()),events=completeEvents(complete.plan);
    const receipt=await f.previews.finish(p,complete.id,{events});assert.equal(receipt.complete,true);assert.deepEqual(await f.previews.finish(p,complete.id,{events}),receipt);
    await assert.rejects(f.studio.review(f.users['language-reviewer'],d.draft.id,{...reviewFor(d),previewId:complete.id},etag(d),randomUUID()),rejected('STUDIO_PREVIEW_REQUIRED'));
    d=await f.studio.review(p,d.draft.id,{...reviewFor(d),previewId:complete.id},etag(d),randomUUID());assert.equal(d.draft.state,'in-review');
    assert.equal((await f.db.query('SELECT id FROM sessions')).rows.length,0);
    assert.equal((await f.db.query('SELECT id FROM families')).rows.length,0);
  }finally{await f.close();}
});

test('withdrawn, replaced and expired candidate previews cannot be reused',async()=>{
  const f=await fixture();try{
    let d=await submitted(f);const p=f.users['method-reviewer'],make=()=>f.previews.start(p,d.draft.id,{confirmHash:d.draft.candidate_hash,level:1,seed:'frozen',environment:TEST_ENVIRONMENT},etag(d),randomUUID());
    const old=await make();await f.previews.finish(p,old.id,{events:completeEvents(old.plan)});
    d=await f.studio.reopen(f.users.editor,d.draft.id,{reason:'Synthetic author withdrawal for additional method review.'},etag(d),randomUUID());
    await assert.rejects(f.previews.get(p,old.id),rejected('STUDIO_PREVIEW_STALE'));
    d=await f.studio.submit(f.users.editor,d.draft.id,etag(d),randomUUID());assert.equal(d.draft.candidate_hash,old.packHash);assert.notEqual(d.draft.round,old.round);
    await assert.rejects(f.studio.review(p,d.draft.id,{...reviewFor(d),previewId:old.id},etag(d),randomUUID()),rejected('STUDIO_PREVIEW_REQUIRED'));
    const fresh=await make();f.advance(31*60000);
    await assert.rejects(f.previews.get(p,fresh.id),rejected('STUDIO_PREVIEW_EXPIRED'));
    await assert.rejects(f.previews.finish(p,fresh.id,{events:completeEvents(fresh.plan)}),rejected('STUDIO_PREVIEW_EXPIRED'));
  }finally{await f.close();}
});

test('all 32 candidate combinations execute the shared complete protocol at all three levels without family records',async()=>{
  const f=await fixture();try{
    const catalogue=await f.studio.catalogue(f.users.editor);
    for(const source of catalogue.releases){
      let d=await f.studio.create(f.users.editor,{sourceHash:source.hash,version:'99.4.0-matrix'},randomUUID());d=await f.studio.submit(f.users.editor,d.draft.id,etag(d),randomUUID());
      for(const level of [1,2,3]){
        const run=await f.previews.start(f.users['method-reviewer'],d.draft.id,{confirmHash:d.draft.candidate_hash,level,seed:'matrix-reproducible',environment:TEST_ENVIRONMENT},etag(d),randomUUID());
        await verifyCandidatePreview(run);const receipt=await f.previews.finish(f.users['method-reviewer'],run.id,{events:completeEvents(run.plan)});
        assert.equal(receipt.complete,true);assert.equal(receipt.formalTrials,run.plan.trials.filter(t=>!t.practice).length);assert.equal(receipt.invalidations,0);
      }
    }
    assert.equal((await f.db.query<{n:number}>('SELECT count(*)::int n FROM studio_previews')).rows[0].n,96);
    assert.equal((await f.db.query('SELECT id FROM sessions')).rows.length,0);
  }finally{await f.close();}
});

test('candidate client rejects a modified pack, forged plan hash and rehashed non-engine trial plan',async()=>{
  const f=await fixture();try{
    const d=await submitted(f),run=await f.previews.start(f.users.editor,d.draft.id,{confirmHash:d.draft.candidate_hash,level:1,seed:'tamper',environment:TEST_ENVIRONMENT},etag(d),randomUUID());
    let bad=structuredClone(run);bad.pack.copy.title='Tampered';await assert.rejects(verifyCandidatePreview(bad),/hash mismatch/);
    bad=structuredClone(run);bad.plan.trials[0].items.reverse();await assert.rejects(verifyCandidatePreview(bad),/hash mismatch/);
    bad.planHash=await hashObject(bad.plan);await assert.rejects(verifyCandidatePreview(bad),/shared engine/);
    bad=structuredClone(run);bad.budgetMs=1;await assert.rejects(verifyCandidatePreview(bad),/scope/);
  }finally{await f.close();}
});


test('legacy ready reviews without preview binding require a fresh review round before publication',async()=>{
  const f=await fixture();try{
    let d=await ready(f);
    // Migration 13 permits NULL for existing records; it must not silently grandfather publication.
    await f.db.query('UPDATE studio_reviews SET preview_id=NULL WHERE draft_id=$1',[d.draft.id]);
    await assert.rejects(f.studio.publish(f.users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:7},etag(d),randomUUID()),rejected('STUDIO_PREVIEW_REQUIRED'));
    const round=d.draft.round;
    await assert.rejects(f.studio.reopen(f.users.publisher,d.draft.id,{reason:'Synthetic attempted withdrawal by wrong role.'},etag(d),randomUUID()),rejected('STUDIO_ROLE_REQUIRED'));
    d=await f.studio.reopen(f.users.editor,d.draft.id,{reason:'Synthetic legacy review requires new linked preview evidence.'},etag(d),randomUUID());
    assert.equal(d.draft.round,round+1);assert.equal(d.draft.state,'draft');
    d=await f.studio.submit(f.users.editor,d.draft.id,etag(d),randomUUID());d=await approve(f,d,'method-reviewer');d=await approve(f,d,'language-reviewer');
    d=await f.studio.publish(f.users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:7},etag(d),randomUUID());
    assert.equal(d.draft.state,'published');
    assert.equal(d.reviews.filter(r=>r.round===d.draft.round&&r.preview_id).length,2);
  }finally{await f.close();}
});
