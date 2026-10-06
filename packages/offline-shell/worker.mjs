import { createHash } from 'node:crypto';

/** Serialized into a classic worker. This function must remain self-contained. */
export function attachOfflineWorker(scope, manifest) {
  const prefix = 'focus-public-shell-', name = prefix + manifest.version;
  const assets = new Map(manifest.assets.map(asset => [asset.url, asset]));
  const eligible = url => url.origin === scope.location.origin && !url.search && assets.has(url.pathname);
  async function verifiedResponse(response, asset) {
    if (response.status !== 200 || !response.body || response.type === 'opaque') throw new Error('SHELL_DOWNLOAD_FAILED');
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > asset.bytes) { await reader.cancel(); throw new Error('SHELL_SIZE_MISMATCH'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
    const hash = [...new Uint8Array(await scope.crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
    if (length !== asset.bytes || hash !== asset.sha256) throw new Error('SHELL_HASH_MISMATCH');
    return new Response(bytes, { status: 200, headers: response.headers });
  }
  async function download(asset) {
    const response = await scope.fetch(new URL(asset.url, scope.location.origin), { credentials: 'omit', redirect: 'error', cache: 'no-store' });
    return verifiedResponse(response, asset);
  }
  scope.addEventListener('install', event => event.waitUntil((async () => {
    const cache = await scope.caches.open(name);
    try {
      for (const asset of manifest.assets) await cache.put(new URL(asset.url, scope.location.origin).href, await download(asset));
    } catch (error) { await scope.caches.delete(name); throw error; }
    // Deliberately no skipWaiting: an active practice keeps its current code.
  })()));
  scope.addEventListener('activate', event => event.waitUntil((async () => {
    for (const key of await scope.caches.keys()) if (key.startsWith(prefix) && key !== name) await scope.caches.delete(key);
    // No clients.claim: existing pages never change controller mid-practice.
  })()));
  scope.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (!eligible(url)) return; // Never intercept API, arbitrary paths, queries or third-party requests.
    event.respondWith((async () => {
      const cache = await scope.caches.open(name), asset = assets.get(url.pathname), cached = await cache.match(url.href);
      if (cached) {
        try { return await verifiedResponse(cached, asset); }
        catch { try { await cache.delete(url.href); } catch {} }
      }
      try { const response = await download(asset); await cache.put(url.href, response.clone()); return response; }
      catch { return new Response('This saved page is unavailable. Reconnect, close this site’s tabs and reopen. / 页面资料不完整，请联网后关闭本站标签页并重新打开。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }); }
    })());
  });
  scope.addEventListener('message', event => {
    if (event.data?.type !== 'FOCUS_SHELL_STATUS' || !event.ports?.[0]) return;
    event.waitUntil((async () => {
      let ready = assets.has(event.data.entryPath);
      try { const cache = await scope.caches.open(name); for (const asset of manifest.assets) {
        const cached = await cache.match(new URL(asset.url, scope.location.origin).href);
        if (!cached) { ready = false; continue; }
        try { await verifiedResponse(cached, asset); } catch { ready = false; }
      } }
      catch { ready = false; }
      event.ports[0].postMessage({ type: 'FOCUS_SHELL_STATUS', version: manifest.version, ready });
    })());
  });
}
export function workerVersion(assets) {
  return createHash('sha256').update(JSON.stringify([attachOfflineWorker.toString(), assets])).digest('hex');
}
export function workerSource(manifest) {
  const publicPath = /^(?:\/(?:index\.html)?|\/assets\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(?:js|css|png|webp|svg|jpg|jpeg|woff2?))$/;
  if (!/^[a-f0-9]{64}$/.test(manifest.version) || !manifest.assets.length || manifest.assets.some(a => !publicPath.test(a.url) || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isInteger(a.bytes) || a.bytes <= 0)) throw new Error('INVALID_SHELL_MANIFEST');
  return '(' + attachOfflineWorker.toString() + ')(self,' + JSON.stringify(manifest) + ');\n';
}
