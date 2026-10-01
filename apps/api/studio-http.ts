import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { Database } from './database.ts';
import type { LocalContent } from './content.ts';
import { ContentError } from '../../packages/content/index.ts';
import { fileStudioVault,studioAuth,StudioError,safeEqual,studioFail } from './studio-auth.ts';
import {studioMedia} from './studio-media.ts';
import {MEDIA_UPLOAD_LIMIT,mediaMime} from '../../packages/content/media-library.ts';
import {studioPreview} from './studio-preview.ts';
import {ProtocolError} from '../../packages/task-engine/index.ts';
import { supportStudio } from './support-studio.ts';
import { contentStudio } from './content-studio.ts';
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
export async function startStudioServer(db:Database,content:LocalContent,dataDir:string,port:number){
  const auth=studioAuth(db,fileStudioVault(dataDir)),studio=contentStudio(db,content,auth),support=supportStudio(db,content,auth),previews=studioPreview(db,content,auth),library=studioMedia(db,auth);
  const root=resolve(import.meta.dirname,'../../dist/studio');
  const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
  const attempts=new Map<string,{count:number;until:number}>();
  const server=http.createServer(async(req,res)=>{
    const requestId=randomUUID();
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(),microphone=(),geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self'; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const json=(data:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    const body=async()=>{if(!req.headers['content-type']?.startsWith('application/json'))studioFail(415,'JSON_REQUIRED','需要 JSON 请求。');let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>65536)studioFail(413,'PAYLOAD_TOO_LARGE','请求超过工作台大小限制。');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{studioFail(400,'INVALID_JSON','请求格式不正确。');}};
    try{
      if(!['127.0.0.1','localhost'].includes((req.headers.host??'').split(':')[0]))studioFail(403,'HOST_REJECTED','主机不受允许。');
      const path=new URL(req.url??'/',`http://127.0.0.1:${port}`).pathname,method=req.method??'GET';
      if(!path.startsWith('/api/')){
        if(method!=='GET'&&method!=='HEAD')studioFail(405,'METHOD_NOT_ALLOWED','不支持的操作。');
        const previewPage=/^\/preview\/[a-f0-9-]{36}$/.test(path);
        if(path!=='/'&&!previewPage&&!/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|svg|png|webp)$/.test(path))studioFail(404,'NOT_FOUND','未找到工作台页面。');
        if(previewPage)res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
        const file=resolve(root,previewPage?'preview.html':path==='/'?'index.html':'.'+path);if(!file.startsWith(root+sep))studioFail(404,'NOT_FOUND','未找到页面。');
        const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});res.end(method==='HEAD'?undefined:bytes);return;
      }
      if(req.headers.authorization||req.headers['x-focus-client'])studioFail(403,'STUDIO_TRANSPORT_REJECTED','工作台只接受独立浏览器管理会话。');
      if(method!=='GET'&&!origins.has(req.headers.origin??''))studioFail(403,'ORIGIN_REJECTED','请求来源不受允许。');
      if(path==='/api/studio/auth/login'&&method==='POST'){
        const addr=req.socket.remoteAddress??'local',old=attempts.get(addr),slot=old&&old.until>Date.now()?old:{count:0,until:Date.now()+600000};
        if(++slot.count>40)studioFail(429,'STUDIO_RATE_LIMITED','登录尝试过于频繁，请稍后重试。');attempts.set(addr,slot);
        const session=await auth.login(await body());res.setHeader('Set-Cookie',`focus_studio=${session.value}; HttpOnly; SameSite=Strict; Path=/api/studio; Max-Age=7200`);json({csrf:session.csrf});return;
      }
      const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('focus_studio='))?.slice(13),p=await auth.authenticate(cookie);
      if(!p)studioFail(401,'STUDIO_UNAUTHENTICATED','请登录内容工作台。');
      if(method!=='GET'&&!safeEqual(String(req.headers['x-csrf-token']??''),p!.csrf))studioFail(403,'CSRF_REJECTED','验证已过期，请重新读取页面。');
      if(path==='/api/studio/me'&&method==='GET'){json({user:{id:p!.id,name:p!.name,role:p!.role},csrf:p!.csrf,mode:'local-development'});return;}
      if(path==='/api/studio/auth/logout'&&method==='POST'){await auth.logout(p!);res.setHeader('Set-Cookie','focus_studio=; HttpOnly; SameSite=Strict; Path=/api/studio; Max-Age=0');json({ok:true});return;}
      if(path==='/api/studio/auth/reauth'&&method==='POST'){json(await auth.reauth(p!,await body()));return;}
      if(path==='/api/studio/catalogue'&&method==='GET'){json(await studio.catalogue(p!));return;}
      const media=path.match(/^\/api\/studio\/media\/([a-f0-9]{64}\.(png|mp3))$/);
      if(media&&method==='GET'){const asset=await content.readMedia('/content-assets/'+media[1]);if(!asset)studioFail(404,'STUDIO_ASSET_MISSING','未找到素材。');res.writeHead(200,{'Content-Type':asset!.mime});res.end(asset!.body);return;}
      const key=String(req.headers['idempotency-key']??''),match=req.headers['if-match'];
      if(path==='/api/studio/support'&&method==='GET'){json(await support.list(p!));return;}
      if(path==='/api/studio/support'&&method==='POST'){json(await support.create(p!,await body(),key),201);return;}
      const supportRoute=path.match(/^\/api\/studio\/support\/([a-f0-9-]{36})(?:\/(submit|review|publish|recall|reopen))?$/);
      if(supportRoute){const [,id,action]=supportRoute;
        if(!action&&method==='GET'){json(await support.get(p!,id));return;}
        if(!action&&method==='PATCH'){json(await support.edit(p!,id,await body(),match,key));return;}
        if(action==='submit'&&method==='POST'){json(await support.submit(p!,id,match,key));return;}
        if(action&&method==='POST'){json(await support[action as 'review'|'publish'|'recall'|'reopen'](p!,id,await body(),match,key));return;}
      }
      if(path==='/api/studio/library'&&method==='GET'){json(await library.list(p!));return;}
      if(path==='/api/studio/media-imports'&&method==='POST'){json(await library.begin(p!,await body(),key),201);return;}
      const upload=path.match(/^\/api\/studio\/media-imports\/([a-f0-9-]{36})\/file$/);
      if(upload&&method==='PUT'){
        const target=await library.authorizeUpload(p!,upload[1]),type=req.headers['content-type']??'';
        if(type!==mediaMime(target.metadata.kind))studioFail(415,'MEDIA_TYPE_MISMATCH','请选择与素材用途一致的 PNG 或 MP3 文件。');
        const length=Number(req.headers['content-length']);
        if(Number.isFinite(length)&&(length>MEDIA_UPLOAD_LIMIT||length!==target.source_bytes))studioFail(413,'MEDIA_UPLOAD_SIZE','文件字节数与导入登记不一致。');
        const bytes=await new Promise<Buffer>((resolve,reject)=>{
          let size=0;const chunks:Buffer[]=[];
          const fail=()=>{req.removeListener('data',onData);req.resume();try{studioFail(413,'MEDIA_UPLOAD_TOO_LARGE','上传文件超过 5 MB 或登记的字节数。');}catch(e){reject(e);}};
          const onData=(b:Buffer)=>{size+=b.length;if(size>Math.min(MEDIA_UPLOAD_LIMIT,target.source_bytes))fail();else chunks.push(b);};
          req.on('data',onData);req.once('end',()=>resolve(Buffer.concat(chunks)));req.once('error',reject);req.once('aborted',()=>reject(new Error('Upload aborted')));
        });json(await library.finish(p!,upload[1],bytes,type));return;
      }
      if(path==='/api/studio/drafts'&&method==='GET'){json(await studio.list(p!));return;}
      if(path==='/api/studio/drafts'&&method==='POST'){json(await studio.create(p!,await body(),key),201);return;}
      const route=path.match(/^\/api\/studio\/drafts\/([a-f0-9-]{36})(?:\/(submit|review|publish|recall|preview|reopen|assets))?$/);
      if(route){const [,id,action]=route;
        if(!action&&method==='GET'){json(await studio.get(p!,id));return;}
        if(!action&&method==='PATCH'){json(await studio.edit(p!,id,await body(),match,key));return;}
        if(method==='POST'){
          if(action==='assets'){json(await studio.attach(p!,id,await body(),match,key));return;}
          if(action==='preview'){json(await previews.start(p!,id,await body(),match,key),201);return;}
          if(action==='reopen'){json(await studio.reopen(p!,id,await body(),match,key));return;}
          if(action==='submit'){json(await studio.submit(p!,id,match,key));return;}
          if(action==='review'){json(await studio.review(p!,id,await body(),match,key));return;}
          if(action==='publish'){json(await studio.publish(p!,id,await body(),match,key));return;}
          if(action==='recall'){json(await studio.recall(p!,id,await body(),match,key));return;}
        }
      }
      const preview=path.match(/^\/api\/studio\/previews\/([a-f0-9-]{36})(?:\/(finish))?$/);
      if(preview){if(method==='GET'&&!preview[2]){json(await previews.get(p!,preview[1]));return;}if(method==='POST'&&preview[2]==='finish'){json(await previews.finish(p!,preview[1],await body()));return;}}
      studioFail(404,'NOT_FOUND','未找到工作台接口。');
    }catch(error){
      if(error instanceof StudioError)json({code:error.code,message:error.message,requestId},error.status);
      else if(error instanceof ProtocolError)json({code:'STUDIO_PREVIEW_EVENTS_INVALID',message:'试玩事件不符合当前协议，不能记为完成。',requestId},422);
      else if(error instanceof ZodError)json({code:'INVALID_REQUEST',message:'字段格式不正确；如果改了语音对应的文字，请先移除旧语音。',requestId},400);
      else if(error instanceof ContentError)json({code:error.code,message:'内容签名、审核或素材核验未通过。',requestId},409);
      else if((error as {code?:string}).code==='ENOENT')json({code:'STUDIO_NOT_READY',message:'请先构建工作台或检查本机管理身份配置。',requestId},503);
      else {console.error(JSON.stringify({requestId,error:error instanceof Error?error.name:'UnknownError',surface:'studio'}));json({code:'INTERNAL_ERROR',message:'工作台暂时无法完成操作，请保留填写内容后重试。',requestId},500);}
    }
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  console.log(`专注岛内容工作台 http://127.0.0.1:${port} · 独立管理身份`);return server;
}
