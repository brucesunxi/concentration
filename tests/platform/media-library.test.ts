import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {openDatabase,migrate} from '../../apps/api/database.ts';
import {createLocalContent} from '../../apps/api/content.ts';
import {studioAuth,provisionStudioUser,StudioError,totp} from '../../apps/api/studio-auth.ts';
import type {StudioVault,StudioSecret,StudioRole,StudioPrincipal} from '../../apps/api/studio-auth.ts';
import {studioMedia} from '../../apps/api/studio-media.ts';
import {processMedia} from '../../apps/api/media-processor.ts';
import {contentStudio} from '../../apps/api/content-studio.ts';
import {studioPreview} from '../../apps/api/studio-preview.ts';
import {MEDIA_IMPORT_TTL_MS,mediaPath} from '../../packages/content/media-library.ts';
import {TEST_ENVIRONMENT} from '../../packages/task-engine/index.ts';
import {completeEvents} from './fixtures.ts';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const rejected=(code:string)=>(e:unknown)=>e instanceof StudioError&&e.code===code;
const base={name:'Synthetic atlas',source:'Synthetic test asset produced locally; no child data.',rights:'Synthetic test fixture only, retained for engineering checks.',rightsConfirmed:true,ageBands:['6-8']};
const imageMeta={...base,kind:'characters',layoutConfirmed:true};
const imageBytes=()=>sharp({create:{width:256,height:256,channels:4,background:'#6a9c80'}}).withMetadata({density:300}).png().toBuffer();
const input=(bytes:Buffer,metadata:unknown=imageMeta)=>({metadata,sourceHash:hash(bytes),sourceBytes:bytes.length});
const etag=(d:{draft:{version:number}})=>`"${d.draft.version}"`;
async function fixture(){
  const db=await openDatabase('memory://');await migrate(db);let clock=Date.parse('2026-09-30T14:00:00Z');const now=()=>clock;
  const secrets=new Map<string,StudioSecret>(),vault:StudioVault={async read(id){return secrets.get(id)!;},async write(id,s){secrets.set(id,s);}};
  const content=await createLocalContent(db,{now}),auth=studioAuth(db,vault,now),users={} as Record<StudioRole,StudioPrincipal>;
  for(const role of ['editor','method-reviewer','language-reviewer','publisher'] as StudioRole[]){const u=await provisionStudioUser(db,vault,{login:role,name:'Synthetic '+role,role,password:'Synthetic-media-2026!'},now());const s=await auth.login({login:role,password:'Synthetic-media-2026!',code:totp(secrets.get(u.id)!.totp,now())});users[role]=(await auth.authenticate(s.value))!;}
  return {db,content,auth,users,now,advance:(ms:number)=>clock+=ms,library:studioMedia(db,auth,now),studio:contentStudio(db,content,auth,now),preview:studioPreview(db,content,auth,now),close:()=>db.close()};
}
test('image import decodes bounded PNG, strips metadata and rejects false type, bad dimensions, animation chunks and trailing payload',async()=>{
  const original=await imageBytes(),result=await processMedia('characters',original),m=await sharp(result.body).metadata();
  assert.equal(m.width,256);assert.equal(m.height,256);assert.equal(m.exif,undefined);assert.equal(m.icc,undefined);assert.equal(result.inspection.metadataRemoved,true);assert.notEqual(hash(result.body),hash(original));
  const jpeg=await sharp(original).jpeg().toBuffer();await assert.rejects(processMedia('characters',jpeg),rejected('MEDIA_INVALID_IMAGE'));
  const odd=await sharp(original).resize(257,257).png().toBuffer();await assert.rejects(processMedia('characters',odd),rejected('MEDIA_ATLAS_DIMENSIONS'));
  const small=await sharp(original).resize(64,64).png().toBuffer();await assert.rejects(processMedia('objects',small),rejected('MEDIA_ATLAS_DIMENSIONS'));
  await assert.rejects(processMedia('characters',Buffer.concat([original,Buffer.from('untrusted tail')])),rejected('MEDIA_INVALID_IMAGE'));
  const animated=Buffer.from(original);animated.write('acTL',12,'ascii');await assert.rejects(processMedia('characters',animated),rejected('MEDIA_INVALID_IMAGE'));
});
test('audio import decodes actual samples, retains playable MP3 frames and rejects invalid data or unavailable tooling',async()=>{
  const bytes=await readFile('src/audio/search-rule.mp3'),result=await processMedia('guide',bytes);
  assert.equal(result.inspection.mime,'audio/mpeg');assert.ok(result.inspection.durationMs!>200);assert.ok(result.inspection.durationMs!<120000);assert.ok(Number.isFinite(result.inspection.rmsDbfs));assert.notEqual(result.body.subarray(0,3).toString(),'ID3');
  const again=await processMedia('guide',result.body);assert.ok(Math.abs(again.inspection.durationMs!-result.inspection.durationMs!)<100);
  await assert.rejects(processMedia('guide',Buffer.from('not an audio file at all')),rejected('MEDIA_INVALID_AUDIO'));
  const old=process.env.FOCUS_FFMPEG_PATH;process.env.FOCUS_FFMPEG_PATH='/nonexistent/focus-test-ffmpeg';
  try{await assert.rejects(processMedia('guide',bytes),rejected('MEDIA_PROCESSOR_UNAVAILABLE'));}finally{if(old===undefined)delete process.env.FOCUS_FFMPEG_PATH;else process.env.FOCUS_FFMPEG_PATH=old;}
});
test('library keeps import intent and original private, deduplicates immutable objects and refuses changed retries or wrong roles',async()=>{
  const f=await fixture();try{
    const bytes=await imageBytes(),body=input(bytes),key=randomUUID(),p=f.users.editor;
    await assert.rejects(f.library.begin(f.users.publisher,body,key),rejected('STUDIO_ROLE_REQUIRED'));
    const begin=await f.library.begin(p,body,key);assert.equal((await f.library.begin(p,body,key)).id,begin.id);
    await assert.rejects(f.library.begin(p,{...body,metadata:{...imageMeta,name:'Changed description'}},key),rejected('STUDIO_REQUEST_CONFLICT'));
    await assert.rejects(f.library.finish(f.users['method-reviewer'],begin.id,bytes,'image/png'),rejected('STUDIO_ROLE_REQUIRED'));
    await assert.rejects(f.library.finish(p,begin.id,Buffer.from('changed input'),'image/png'),rejected('MEDIA_SOURCE_CHANGED'));
    const saved=await f.library.finish(p,begin.id,bytes,'image/png');assert.equal(saved.state,'ready');assert.equal((await f.library.finish(p,begin.id,bytes,'image/png')).asset_hash,saved.asset_hash);
    const duplicate=await f.library.begin(p,{...body,metadata:{...imageMeta,name:'Different source declaration'}},randomUUID());await f.library.finish(p,duplicate.id,bytes,'image/png');
    assert.equal((await f.db.query('SELECT hash FROM content_media_objects')).rows.length,1);assert.equal((await f.db.query('SELECT hash FROM content_media_sources')).rows.length,1);
    const path=mediaPath(saved.asset_hash!,'image/png');assert.equal(await f.content.readMedia(path,true),undefined);assert.ok(await f.content.readMedia(path));
    const listed=(await f.library.list(f.users['language-reviewer'])).items;assert.equal(listed.length,2);assert.equal('request_key' in listed[0],false);
    assert.equal((await f.db.query('SELECT id FROM families')).rows.length,0);
  }finally{await f.close();}
});
test('invalid imports become rejected, expired intents cannot upload, and temporary decoder failures remain retryable',async()=>{
  const f=await fixture();try{
    const bad=Buffer.from('invalid PNG with enough bytes'),p=f.users.editor,entry=await f.library.begin(p,input(bad),randomUUID());
    await assert.rejects(f.library.finish(p,entry.id,bad,'image/png'),rejected('MEDIA_INVALID_IMAGE'));
    assert.equal((await f.library.list(p)).items[0].state,'rejected');await assert.rejects(f.library.finish(p,entry.id,bad,'image/png'),rejected('MEDIA_IMPORT_REJECTED'));
    const bytes=await readFile('src/audio/search-rule.mp3'),voice={...base,kind:'guide',locale:'zh-CN',voice:'Synthetic existing fixture',transcript:'Synthetic transcript'};
    const pending=await f.library.begin(p,input(bytes,voice),randomUUID()),old=process.env.FOCUS_FFMPEG_PATH;process.env.FOCUS_FFMPEG_PATH='/nonexistent/focus-test-ffmpeg';
    try{await assert.rejects(f.library.finish(p,pending.id,bytes,'audio/mpeg'),rejected('MEDIA_PROCESSOR_UNAVAILABLE'));}finally{if(old===undefined)delete process.env.FOCUS_FFMPEG_PATH;else process.env.FOCUS_FFMPEG_PATH=old;}
    assert.equal((await f.library.list(p)).items.find(x=>x.id===pending.id)!.state,'awaiting');
    const future=await f.library.begin(p,input(await imageBytes()),randomUUID());f.advance(MEDIA_IMPORT_TTL_MS+1);
    // Refresh only the synthetic session deadline to isolate import expiry from authentication expiry.
    await f.db.query("UPDATE studio_sessions SET expires_at=$1",[new Date(f.now()+3600000).toISOString()]);
    await assert.rejects(f.library.authorizeUpload(p,future.id),rejected('MEDIA_IMPORT_EXPIRED'));
  }finally{await f.close();}
});
test('new artwork binds a fresh round and becomes public only after preview-backed dual review; recall closes new reads',async()=>{
  const f=await fixture();try{
    const source=await f.content.pick('search','6-8','zh-CN'),bytes=await imageBytes();
    let d=await f.studio.create(f.users.editor,{sourceHash:source.sha256,version:'99.15.0-qa'},randomUUID());
    const started=await f.library.begin(f.users.editor,input(bytes),randomUUID()),asset=await f.library.finish(f.users.editor,started.id,bytes,'image/png');
    const originalHash=d.draft.pack.assets[0].sha256;
    d=await f.studio.attach(f.users.editor,d.draft.id,{mediaId:asset.id,slot:'characters'},etag(d),randomUUID());assert.equal(d.draft.round,2);assert.notEqual(d.draft.pack.assets[0].sha256,originalHash);assert.equal(d.mediaSources.length,1);
    d=await f.studio.submit(f.users.editor,d.draft.id,etag(d),randomUUID());
    await assert.rejects(f.studio.attach(f.users.editor,d.draft.id,{mediaId:asset.id,slot:'characters'},etag(d),randomUUID()),rejected('STUDIO_EDIT_LOCKED'));
    for(const role of ['method-reviewer','language-reviewer'] as const){
      const run=await f.preview.start(f.users[role],d.draft.id,{confirmHash:d.draft.candidate_hash,level:1,seed:'imported-art',environment:TEST_ENVIRONMENT},etag(d),randomUUID());
      await f.preview.finish(f.users[role],run.id,{events:completeEvents(run.plan)});
      d=await f.studio.review(f.users[role],d.draft.id,{previewId:run.id,decision:'approve',note:'Synthetic workflow verification only. This is not a professional content review.',checks:{instructions:true,ageAndLanguage:true,assets:true,claims:true},audioReviewedHashes:d.draft.pack.assets.filter(a=>a.mime==='audio/mpeg').map(a=>a.sha256)},etag(d),randomUUID());
    }
    const path=mediaPath(asset.asset_hash!,'image/png');assert.equal(await f.content.readMedia(path,true),undefined);
    d=await f.studio.publish(f.users.publisher,d.draft.id,{confirmHash:d.draft.candidate_hash,days:7},etag(d),randomUUID());assert.ok(await f.content.readMedia(path,true));
    const loaded=await createLocalContent(f.db,{now:f.now});assert.ok(await loaded.readMedia(path,true));assert.equal((await loaded.pick('search','6-8','zh-CN')).sha256,d.draft.published_hash);
    await f.studio.recall(f.users.publisher,d.draft.id,{confirmHash:d.draft.published_hash,reason:'Synthetic uploaded media recall exercise.'},etag(d),randomUUID());assert.equal(await loaded.readMedia(path,true),undefined);assert.ok(await loaded.readMedia(path));
    assert.equal((await f.content.get(source.sha256)).body.pack.assets[0].sha256,originalHash);
  }finally{await f.close();}
});
test('attachment enforces age, actual image slot, voice locale and exact rule transcript',async()=>{
  const f=await fixture();try{
    const source=await f.content.pick('search','6-8','zh-CN');let d=await f.studio.create(f.users.editor,{sourceHash:source.sha256,version:'99.15.0-bind'},randomUUID());
    const image=await imageBytes();let m=await f.library.begin(f.users.editor,input(image,{...imageMeta,ageBands:['15-17']}),randomUUID());m=await f.library.finish(f.users.editor,m.id,image,'image/png');
    await assert.rejects(f.studio.attach(f.users.editor,d.draft.id,{mediaId:m.id,slot:'characters'},etag(d),randomUUID()),rejected('MEDIA_AGE_MISMATCH'));
    const audio=await readFile('src/audio/search-rule.mp3'),voice={...base,kind:'guide',locale:'en',voice:'Synthetic QA',transcript:d.draft.pack.copy.rule};
    m=await f.library.begin(f.users.editor,input(audio,voice),randomUUID());m=await f.library.finish(f.users.editor,m.id,audio,'audio/mpeg');
    await assert.rejects(f.studio.attach(f.users.editor,d.draft.id,{mediaId:m.id,slot:'guide'},etag(d),randomUUID()),rejected('MEDIA_TRANSCRIPT_MISMATCH'));
    m=await f.library.begin(f.users.editor,input(audio,{...voice,locale:'zh-CN',transcript:'Changed words'}),randomUUID());m=await f.library.finish(f.users.editor,m.id,audio,'audio/mpeg');
    await assert.rejects(f.studio.attach(f.users.editor,d.draft.id,{mediaId:m.id,slot:'guide'},etag(d),randomUUID()),rejected('MEDIA_TRANSCRIPT_MISMATCH'));
    m=await f.library.begin(f.users.editor,input(audio,{...voice,locale:'zh-CN'}),randomUUID());m=await f.library.finish(f.users.editor,m.id,audio,'audio/mpeg');
    d=await f.studio.attach(f.users.editor,d.draft.id,{mediaId:m.id,slot:'guide'},etag(d),randomUUID());assert.equal(d.draft.pack.audio?.copyKey,'rule');assert.equal(d.draft.pack.assets.find(a=>a.id==='guide')!.transcript,d.draft.pack.copy.rule);
    await assert.rejects(f.studio.attach(f.users.editor,d.draft.id,{mediaId:m.id,slot:'objects'},etag(d),randomUUID()),rejected('MEDIA_NOT_READY'));
    const stopSource=await f.content.pick('stop','6-8','zh-CN');let stop=await f.studio.create(f.users.editor,{sourceHash:stopSource.sha256,version:'99.15.0-stop-rule'},randomUUID());
    m=await f.library.begin(f.users.editor,input(audio,{...voice,locale:'zh-CN',transcript:stop.draft.pack.copy.strategy}),randomUUID());
    m=await f.library.finish(f.users.editor,m.id,audio,'audio/mpeg');
    await assert.rejects(f.studio.attach(f.users.editor,stop.draft.id,{mediaId:m.id,slot:'guide'},etag(stop),randomUUID()),rejected('MEDIA_TRANSCRIPT_MISMATCH'));
    m=await f.library.begin(f.users.editor,input(audio,{...voice,locale:'zh-CN',transcript:stop.draft.pack.copy.rule}),randomUUID());
    m=await f.library.finish(f.users.editor,m.id,audio,'audio/mpeg');
    stop=await f.studio.attach(f.users.editor,stop.draft.id,{mediaId:m.id,slot:'guide'},etag(stop),randomUUID());
    assert.equal(stop.draft.pack.audio?.copyKey,'rule');
    assert.equal(stop.draft.pack.assets.find(a=>a.id==='guide')!.transcript,stop.draft.pack.copy.rule);
  }finally{await f.close();}
});


test('audio sample analysis rejects silence and durations outside the declared guide window',async()=>{
  for(const [source,duration,expected] of [['anullsrc=r=24000:cl=mono','1','MEDIA_AUDIO_SILENT'],['sine=frequency=440:sample_rate=24000','0.03','MEDIA_AUDIO_DURATION'],['sine=frequency=440:sample_rate=24000','121','MEDIA_AUDIO_DURATION']]){
    const {stdout}=await promisify(execFile)(process.env.FOCUS_FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',source,'-t',duration,'-c:a','libmp3lame','-b:a','64k','-f','mp3','pipe:1'],{encoding:'buffer',maxBuffer:2*1024*1024,timeout:10000});
    await assert.rejects(processMedia('guide',stdout),rejected(expected));
  }
});
