import { verifyRelease, verifyAsset } from '../../../packages/content/index.ts';
import type { ContentPack, Release, TrustedKey } from '../../../packages/content/index.ts';
import type { Plan } from '../../../packages/task-engine/index.ts';
import type { ContentProof } from '../../../packages/session-runtime/offline-session.ts';
import { request } from './api.ts';
export interface PlayableContent { pack:ContentPack; urls:Record<string,string>; dispose():void }
export interface PreparedContent extends PlayableContent { proof:ContentProof; cacheReady:boolean }
const cacheName='focus-public-content-v1';
export async function boundedBytes(response:Response,limit:number) {
  if(!response.ok||!response.body)throw new Error('ASSET_UNAVAILABLE');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>limit){await reader.cancel();throw new Error('ASSET_TOO_LARGE');}parts.push(chunk.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export async function prepareContent(plan:Plan,signal:AbortSignal,offline?:ContentProof):Promise<PreparedContent> {
  if(!plan.content)throw new Error('Missing content reference');
  const [release,trust]=offline?[offline.release,{mode:'local-development',keys:offline.keys}]:await Promise.all([
    request<Release>(`/content/releases/${plan.content.sha256}`),request<{mode:string;keys:TrustedKey[]}>('/content/trust'),
  ]);
  if(trust.mode!=='local-development')throw new Error('A pinned production trust configuration is required');
  const pack=await verifyRelease(release,trust.keys,{mode:'local',market:'LOCAL'});
  if(release.body.packHash!==plan.content.sha256||pack.id!==plan.content.id||pack.version!==plan.content.version||pack.engineVersion!==plan.version||pack.policyVersion!==plan.policyVersion||pack.task!==plan.task||pack.locale!==plan.locale||pack.ageBand!==plan.ageBand)throw new Error('Content does not match the frozen practice plan');
  const cache=typeof caches==='undefined'?null:await caches.open(cacheName).catch(()=>null);if(offline&&!cache)throw new Error('OFFLINE_ASSET_UNAVAILABLE');
  let cacheReady=!!cache;const urls:Record<string,string>=Object.create(null);
  const dispose=()=>Object.values(urls).forEach(url=>URL.revokeObjectURL(url));
  try{
    for(const asset of pack.assets){
      signal.throwIfAborted();let bytes:Uint8Array<ArrayBuffer>|undefined;
      try{const hit=await cache?.match(asset.path);if(hit){bytes=await boundedBytes(hit,asset.bytes);await verifyAsset(asset,bytes);}}catch{bytes=undefined;}
      if(!bytes){
        if(offline)throw new Error('OFFLINE_ASSET_UNAVAILABLE');
        const download=new AbortController(),abort=()=>download.abort();signal.addEventListener('abort',abort,{once:true});const timeout=setTimeout(abort,20000);
        try{signal.throwIfAborted();bytes=await boundedBytes(await fetch(asset.path,{credentials:'omit',signal:download.signal}),asset.bytes);await verifyAsset(asset,bytes);}
        finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);}
        if(cache)try{await cache.put(asset.path,new Response(bytes,{headers:{'Content-Type':asset.mime}}));}catch{cacheReady=false;}
      }
      signal.throwIfAborted();const url=URL.createObjectURL(new Blob([bytes],{type:asset.mime}));urls[asset.id]=url;
      if(asset.mime==='image/png'){const image=new Image();image.src=url;await image.decode();}
    }
    signal.throwIfAborted();return {pack,urls,dispose,proof:{release,keys:trust.keys},cacheReady};
  }catch(error){dispose();throw error;}
}
