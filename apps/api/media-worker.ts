// Dedicated short-lived process: no uploaded filename or command is executed.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {MEDIA_UPLOAD_LIMIT} from '../../packages/content/media-library.ts';
import type {MediaInspection} from '../../packages/content/media-library.ts';
import {measureNarrationQuality} from '../../packages/audio/engineering-quality.ts';
const kind=process.argv[2];
async function ffmpeg(input:Buffer,args:string[],maxBytes:number):Promise<Buffer>{
  return new Promise((resolve,reject)=>{
    const child=spawn(process.env.FOCUS_FFMPEG_PATH||'ffmpeg',[
      '-hide_banner','-loglevel','error','-nostdin','-max_alloc','16777216','-threads','1',
      '-protocol_whitelist','pipe','-probesize','524288','-analyzeduration','1000000',
      '-err_detect','explode','-xerror','-f','mp3','-i','pipe:0','-map','0:a:0','-vn','-sn','-dn',...args,'pipe:1',
    ],{stdio:['pipe','pipe','pipe']});
    let total=0,failed=false;const chunks:Buffer[]=[];let timer:ReturnType<typeof setTimeout>;
    const fail=(code:string)=>{if(failed)return;failed=true;clearTimeout(timer);child.kill('SIGKILL');reject(new Error(code));};
    timer=setTimeout(()=>fail('MEDIA_PROCESSOR_TIMEOUT'),10000);
    child.stdout.on('data',(b:Buffer)=>{total+=b.length;if(total>maxBytes)fail('MEDIA_AUDIO_DURATION');else chunks.push(b);});
    // Decoder diagnostics may contain untrusted metadata. Do not return or log it.
    child.stderr.resume();child.stdin.on('error',()=>{});
    child.once('error',()=>fail('MEDIA_PROCESSOR_UNAVAILABLE'));
    child.once('close',code=>{clearTimeout(timer);if(!failed){if(code!==0)reject(new Error('MEDIA_INVALID_AUDIO'));else resolve(Buffer.concat(chunks));}});
    child.stdin.end(input);
  });
}
async function inspect(input:Buffer){
  if(kind==='characters'||kind==='objects'){
    if(!input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('MEDIA_INVALID_IMAGE');
    let offset=8;let ended=false;
    while(offset<input.length){
      if(offset+12>input.length)throw new Error('MEDIA_INVALID_IMAGE');
      const length=input.readUInt32BE(offset),type=input.subarray(offset+4,offset+8).toString('ascii');
      if(length>input.length-offset-12||['acTL','fcTL','fdAT'].includes(type))throw new Error('MEDIA_INVALID_IMAGE');
      offset+=12+length;if(type==='IEND'){ended=true;break;}
    }
    if(!ended||offset!==input.length)throw new Error('MEDIA_INVALID_IMAGE');
    const source=sharp(input,{limitInputPixels:2048*2048,failOn:'warning',sequentialRead:true});
    const m=await source.metadata();
    if(m.format!=='png'||m.width!==m.height||!m.width||m.width<256||m.width>2048||m.width%2||(m.pages??1)!==1)throw new Error('MEDIA_ATLAS_DIMENSIONS');
    // Re-encoding strips input metadata and ancillary payload; maintain all four cells.
    const {data,info}=await source.timeout({seconds:8}).toColourspace('srgb').png({compressionLevel:9}).toBuffer({resolveWithObject:true});
    if(data.length>MEDIA_UPLOAD_LIMIT)throw new Error('MEDIA_OUTPUT_TOO_LARGE');
    const inspection:MediaInspection={version:'media-check-1',processor:`sharp ${sharp.versions.sharp}; libvips ${sharp.versions.vips}`,mime:'image/png',width:info.width,height:info.height,metadataRemoved:true};
    return {body:data.toString('base64'),inspection};
  }
  if(kind!=='guide')throw new Error('MEDIA_KIND_INVALID');
  const header=input.subarray(0,3).toString('ascii');
  if(header!=='ID3'&&!(input[0]===255&&(input[1]&224)===224))throw new Error('MEDIA_INVALID_AUDIO');
  // Decode to bounded PCM for measured duration/level; never use declared metadata as proof.
  const pcm=await ffmpeg(input,['-t','120.01','-ac','1','-ar','24000','-f','f32le','-c:a','pcm_f32le'],24000*4*121);
  const samples=pcm.length/4,durationMs=samples/24;
  if(!Number.isInteger(samples)||durationMs<200||durationMs>120000)throw new Error('MEDIA_AUDIO_DURATION');
  let peak=0,sum=0,clipped=0;
  for(let i=0;i<pcm.length;i+=4){const v=pcm.readFloatLE(i);if(!Number.isFinite(v))throw new Error('MEDIA_INVALID_AUDIO');peak=Math.max(peak,Math.abs(v));sum+=v*v;if(Math.abs(v)>=.999)clipped++;}
  const rms=Math.sqrt(sum/samples);
  if(rms<.00001)throw new Error('MEDIA_AUDIO_SILENT');
  // Retain compressed audio frames, strip tags/cover art. No generative model or lossy re-encoding.
  const body=await ffmpeg(input,['-map_metadata','-1','-c:a','copy','-id3v2_version','0','-write_id3v1','0','-write_xing','0','-f','mp3'],MEDIA_UPLOAD_LIMIT);
  if(body.length<20)throw new Error('MEDIA_INVALID_AUDIO');
  let narrationQuality;
  try{narrationQuality=await measureNarrationQuality(body,durationMs);}
  catch(error){
    const message=error instanceof Error?error.message:'';
    if(message.includes('timed out'))throw new Error('MEDIA_PROCESSOR_TIMEOUT');
    if(message.includes('unavailable'))throw new Error('MEDIA_PROCESSOR_UNAVAILABLE');
    throw new Error('MEDIA_AUDIO_ENGINEERING');
  }
  const tool=await promisify(execFile)(process.env.FOCUS_FFMPEG_PATH||'ffmpeg',['-version'],{timeout:3000,maxBuffer:16384,killSignal:'SIGKILL'}).catch(()=>{throw new Error('MEDIA_PROCESSOR_UNAVAILABLE');});
  const processor=tool.stdout.split('\n')[0].slice(0,180)+'; metadata-free stream copy profile 1';
  const inspection:MediaInspection={version:'media-check-1',processor,mime:'audio/mpeg',durationMs:Math.round(durationMs),analysisSampleRate:24000,analysisChannels:1,peakDbfs:Number((20*Math.log10(peak)).toFixed(2)),rmsDbfs:Number((20*Math.log10(rms)).toFixed(2)),clippedFraction:clipped/samples,narrationQuality,metadataRemoved:true};
  return {body:body.toString('base64'),inspection};
}
try{
  let size=0;const chunks:Buffer[]=[];for await(const b of process.stdin){size+=b.length;if(size>MEDIA_UPLOAD_LIMIT)throw new Error('MEDIA_UPLOAD_TOO_LARGE');chunks.push(b);}
  process.stdout.write(JSON.stringify(await inspect(Buffer.concat(chunks))));
}catch(e){const message=e instanceof Error?e.message:'';process.stdout.write(JSON.stringify({error:/^MEDIA_[A-Z_]+$/.test(message)?message:kind==='guide'?'MEDIA_INVALID_AUDIO':'MEDIA_INVALID_IMAGE'}));process.exitCode=1;}
