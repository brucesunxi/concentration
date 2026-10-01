import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('history pagination works over Web and native HTTP, survives restart and rejects invalid query shapes', { timeout: 45000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'focus-history-http-')), base = 'http://127.0.0.1:4264'; let handle;
  async function boot() {
    handle = spawn(process.execPath, ['apps/api/main.ts'], { cwd: resolve(import.meta.dirname, '../..'), env: { ...process.env, APP_MODE: 'local', DATABASE_URL: '', API_PORT: '4264', STUDIO_PORT: '0', FOCUS_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostics = ''; handle.stderr.on('data', chunk => diagnostics += String(chunk));
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('History HTTP boot timeout')), 15000);
      handle.once('error', e => { clearTimeout(timer); reject(e); });
      handle.once('exit', () => { clearTimeout(timer); reject(new Error('History HTTP service exited: ' + diagnostics)); });
      handle.stdout.on('data', data => { if (String(data).includes('本地开发模式')) { clearTimeout(timer); done(); } });
    });
  }
  async function stop() { if (!handle || handle.exitCode !== null) return; const stopped = new Promise(done => handle.once('exit', done)); handle.kill('SIGTERM'); await stopped; }
  async function call(path, auth = {}, method = 'GET', data) {
    const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...(auth.native ? { 'X-Focus-Client': 'native-local-v1', ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}) } : { Origin: base, ...(auth.cookie ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}) }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(10000) });
    return { response, body: await response.json() };
  }
  const credentials={name:'Synthetic history HTTP',password:'Synthetic-history-http-2026!'};
  const webAuth=result=>({cookie:result.response.headers.get('set-cookie').split(';')[0],csrf:result.body.csrf});
  try {
    await boot();
    const parent=webAuth(await call('/auth/setup',{},'POST',{...credentials,timezone:'UTC',locale:'en',acknowledgedLocalUse:true}));
    const child=(await call('/children',parent,'POST',{alias:'Synthetic Teen',ageBand:'15-17',locale:'en',localConfirmation:true})).body;
    const path=`/children/${child.id}/report`;
    for(let i=0;i<55;i++)assert.equal((await call(`/children/${child.id}/observations`,parent,'POST',{task:'search',context:'project',prompts:i%5,childChoice:true})).response.status,201);
    const first=await call(path,parent);assert.equal(first.response.headers.get('cache-control'),'no-store');assert.equal(first.body.observations.length,50);assert.equal(first.body.observationCount,55);
    const cursor=first.body.history.observations.nextCursor;
    const olderPath=path+'?observationsCursor='+encodeURIComponent(cursor);
    const older=await call(olderPath,parent);assert.equal(older.body.observations.length,5);assert.equal(older.body.history.observations.nextCursor,null);
    assert.equal(new Set([...first.body.observations,...older.body.observations].map(r=>r.id)).size,55);
    for(const suffix of ['?observationsCursor='+cursor+'&observationsCursor='+cursor,'?limit=500','?observationsCursor=','?observationsCursor=%25%25%25'])assert.equal((await call(path+suffix,parent)).response.status,400);
    await stop();await boot();assert.deepEqual((await call(olderPath,parent)).body,older.body);
    const login=await call('/auth/login',{native:true},'POST',credentials),native={native:true,token:login.body.accessToken};
    assert.deepEqual((await call(olderPath,native)).body,older.body);
    const entered=await call(`/children/${child.id}/enter`,native,'POST',{});
    assert.equal((await call(olderPath,{native:true,token:entered.body.accessToken})).body.code,'PARENT_REQUIRED');
    assert.equal((await call(olderPath,native)).response.status,401);
    await call(`/children/${child.id}/withdraw`,parent,'POST',{});
    assert.equal((await call(olderPath,parent)).body.observations.length,5);
  }finally{await stop();await rm(directory,{recursive:true,force:true});}
});
