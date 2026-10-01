import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { workerSource } from '../packages/offline-shell/worker.mjs';
const origin='http://localhost:4181';
const body=new Map([['/','<html>public shell</html>'],['/index.html','<html>public shell</html>'],['/assets/app-abc.js','public runtime code']]);
const digest=data=>createHash('sha256').update(data).digest('hex');
const manifest={version:'a'.repeat(64),assets:[...body].map(([url,data])=>({url,bytes:Buffer.byteLength(data),sha256:digest(data)}))};
function environment(){
  const listeners={},spaces=new Map(),downloads=[];let network=true,corrupt='';
  const caches={async keys(){return [...spaces.keys()];},async delete(key){return spaces.delete(key);},async open(key){if(!spaces.has(key))spaces.set(key,new Map());const space=spaces.get(key);return {async match(url){return space.get(url)?.clone();},async put(url,response){space.set(url,response.clone());}};}};
  const scope={crypto:webcrypto,location:{origin},caches,addEventListener:(name,fn)=>{listeners[name]=fn;},fetch:async(url,options)=>{downloads.push({url:String(url),options});if(!network)throw new TypeError('offline');return new Response(new URL(url).pathname===corrupt?'wrong content':body.get(new URL(url).pathname),{status:200,headers:{'Content-Type':'text/plain'}});},skipWaiting(){throw new Error('Must not force updates');},clients:{claim(){throw new Error('Must not replace an active page controller');}}};
  runInNewContext(workerSource(manifest),{self:scope,URL,Response,Uint8Array,Map,Error});
  const event=async(name,extra={})=>{let pending;listeners[name]({...extra,waitUntil:value=>{pending=value;}});await pending;};
  const request=async(path,method='GET')=>{let response;listeners.fetch({request:{url:new URL(path,origin).href,method},respondWith:value=>{response=value;}});return response?await response:null;};
  return {event,request,spaces,downloads,setNetwork:value=>{network=value;},corrupt:path=>{corrupt=path;}};
}

test('the actual generated worker caches a verified public shell and serves it after the network disappears',async()=>{
  const env=environment();await env.event('install');env.setNetwork(false);
  assert.equal(await (await env.request('/')).text(),body.get('/'));
  assert.equal(await (await env.request('/assets/app-abc.js')).text(),body.get('/assets/app-abc.js'));
  assert.equal(env.downloads.length,3);
  assert.ok(env.downloads.every(d=>d.options.credentials==='omit'&&d.options.redirect==='error'));
});

test('private APIs, arbitrary paths, writes, query strings and cross-origin traffic never enter the worker cache route',async()=>{
  const env=environment();await env.event('install');env.setNetwork(false);
  for(const path of ['/api/me','/api/children/id/report','/api/auth/login','/content-assets/file.png','/family','/?secret=one','https://other.test/assets/app-abc.js'])assert.equal(await env.request(path),null,path);
  assert.equal(await env.request('/','POST'),null);assert.equal(env.downloads.length,3);
});

test('an incomplete or corrupt new install cannot replace the previously installed shell',async()=>{
  const env=environment();env.spaces.set('focus-public-shell-old',new Map([['proof','old']]));env.corrupt('/assets/app-abc.js');
  await assert.rejects(env.event('install'),/SHELL_(SIZE|HASH)_MISMATCH/);
  assert.ok(env.spaces.has('focus-public-shell-old'));assert.equal(env.spaces.has('focus-public-shell-'+manifest.version),false);
});

test('activation removes only previous shell versions and never force-claims an open practice',async()=>{
  const env=environment();env.spaces.set('focus-public-shell-old',new Map());env.spaces.set('focus-public-content-v1',new Map());env.spaces.set('unrelated-app',new Map());
  await env.event('install');await env.event('activate');
  assert.equal(env.spaces.has('focus-public-shell-old'),false);assert.ok(env.spaces.has('focus-public-content-v1'));assert.ok(env.spaces.has('unrelated-app'));
});

test('readiness requires the current page entry and every cached shell file',async()=>{
  const env=environment();await env.event('install');
  let result;const query=entryPath=>env.event('message',{data:{type:'FOCUS_SHELL_STATUS',entryPath},ports:[{postMessage:value=>{result=value;}}]});
  await query('/assets/app-abc.js');assert.equal(result.ready,true);
  await query('/assets/another-build.js');assert.equal(result.ready,false);
  env.spaces.get('focus-public-shell-'+manifest.version).delete(origin+'/index.html');
  await query('/assets/app-abc.js');assert.equal(result.ready,false);
});

test('evicted shell files fail clearly offline and can only be repaired with matching bytes online',async()=>{
  const env=environment();await env.event('install');env.spaces.get('focus-public-shell-'+manifest.version).delete(origin+'/assets/app-abc.js');env.setNetwork(false);
  assert.equal((await env.request('/assets/app-abc.js')).status,503);
  env.setNetwork(true);assert.equal((await env.request('/assets/app-abc.js')).status,200);
});

test('build-time worker generation rejects private or external cache manifest entries',()=>{
  for(const url of ['/api/me','https://example.com/image.png','/index.html?token=x','/assets/..','/assets/.','/assets/../api/me','/assets/%2e%2e','/assets/secret.json','/assets/.hidden.js'])assert.throws(()=>workerSource({...manifest,assets:[{...manifest.assets[0],url}]}),/INVALID_SHELL_MANIFEST/);
});
