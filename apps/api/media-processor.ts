import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MEDIA_UPLOAD_LIMIT} from '../../packages/content/media-library.ts';
import type {MediaInspection,MediaMetadata} from '../../packages/content/media-library.ts';
import {studioFail} from './studio-auth.ts';
let active=0;
export async function processMedia(kind:MediaMetadata['kind'],input:Buffer):Promise<{body:Buffer;inspection:MediaInspection}>{
  if(active>=2)studioFail(429,'MEDIA_PROCESSOR_BUSY','素材检查正在进行，请保留文件稍后重试。');
  if(input.length>MEDIA_UPLOAD_LIMIT)studioFail(413,'MEDIA_UPLOAD_TOO_LARGE','单份文件不能超过 5 MB。');
  active++;
  try{return await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL('./media-worker.ts',import.meta.url)),kind],{stdio:['pipe','pipe','pipe']});
    let size=0,done=false;const chunks:Buffer[]=[];
    const fail=(code:string,status=422)=>{if(done)return;done=true;clearTimeout(timer);child.kill('SIGKILL');try{studioFail(status,code,mediaError(code));}catch(e){reject(e);}};
    const timer=setTimeout(()=>fail('MEDIA_PROCESSOR_TIMEOUT',503),25000);
    child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>8*1024*1024)fail('MEDIA_OUTPUT_TOO_LARGE');else chunks.push(b);});
    child.stderr.resume();child.stdin.on('error',()=>{});
    child.once('error',()=>fail('MEDIA_PROCESSOR_UNAVAILABLE',503));
    child.once('close',code=>{
      if(done)return;clearTimeout(timer);
      try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(code!==0||result.error){const error=String(result.error||'MEDIA_PROCESSOR_FAILED');fail(error,/TIMEOUT|UNAVAILABLE/.test(error)?503:422);return;}
        const body=Buffer.from(result.body,'base64');if(!body.length||body.length>MEDIA_UPLOAD_LIMIT||result.inspection?.version!=='media-check-1'){fail('MEDIA_PROCESSOR_FAILED');return;}
        done=true;resolve({body,inspection:result.inspection});
      }catch{fail('MEDIA_PROCESSOR_FAILED');}
    });child.stdin.end(input);
  });}finally{active--;}
}
export function mediaError(code:string){
  const messages:Record<string,string>={MEDIA_PROCESSOR_UNAVAILABLE:'本机媒体检查工具不可用，请配置 FFmpeg 后重试。',MEDIA_PROCESSOR_TIMEOUT:'媒体检查超时，请保留文件稍后重试。',MEDIA_ATLAS_DIMENSIONS:'图片须为 256–2048 像素的正方形静态 PNG，边长为偶数，四格各占一半。',MEDIA_INVALID_IMAGE:'图片无法完整解码，请重新导出静态 PNG。',MEDIA_INVALID_AUDIO:'声音无法完整解码，请重新导出有效 MP3。',MEDIA_AUDIO_DURATION:'规则声音须为 0.2–120 秒。',MEDIA_AUDIO_SILENT:'声音接近全静音，请检查原始录音。',MEDIA_OUTPUT_TOO_LARGE:'处理后的文件超过 5 MB，请减小素材后重新导入。'};
  return messages[code]??'素材检查未通过，请检查文件格式后重新导入。';
}
