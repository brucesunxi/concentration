import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { workerSource, workerVersion } from '../packages/offline-shell/worker.mjs';
const args=process.argv.slice(2);
if(args.length&&(args.length!==2||args[0]!=='--directory'))throw new Error('Usage: build-offline-shell.mjs [--directory path]');
const root=args[1]?resolve(args[1]):resolve(import.meta.dirname,'../dist/web-candidate');
const built=JSON.parse(await readFile(resolve(root,'.vite/manifest.json'),'utf8'));
const files=new Set(['index.html']),seen=new Set();
function visit(key){if(seen.has(key))return;seen.add(key);const asset=built[key];files.add(asset.file);for(const f of [...asset.css??[],...asset.assets??[]])files.add(f);for(const dep of asset.imports??[])visit(dep);}
const entries=Object.entries(built).filter(([,v])=>v.isEntry);if(entries.length!==1)throw new Error('ONE_ENTRY_REQUIRED');visit(entries[0][0]);
const assets=[];
for(const file of [...files].sort()){const bytes=await readFile(resolve(root,file));assets.push({url:'/'+file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
assets.push({...assets.find(a=>a.url==='/index.html'),url:'/'});
const version=workerVersion(assets);
const manifest={schemaVersion:1,version,assets,totalBytes:assets.filter(a=>a.url!=='/').reduce((sum,a)=>sum+a.bytes,0)};
await writeFile(resolve(root,'focus-sw.js'),workerSource(manifest));
await writeFile(resolve(root,'offline-shell.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({offlineShellBytes:manifest.totalBytes,publicAssets:assets.length,version}));
