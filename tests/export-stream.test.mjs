import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { streamChildExport } from '../apps/api/export-stream.ts';

async function serve(value) {
  const server = http.createServer(async (_request, response) => {
    try { await streamChildExport(response, value); }
    catch { if (!response.headersSent) response.writeHead(422).end('Export rejected'); else response.destroy(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test('exports over the Vercel ordinary-response limit as valid streamed JSON', { timeout: 30000 }, async () => {
  const value = { schemaVersion: 2, child: { id: 'child-a' }, observations: Array.from({ length: 90 }, (_, index) => ({ id: index, note: 'x'.repeat(60000) })) };
  const { server, url } = await serve(value);
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('transfer-encoding') ?? '', /chunked/);
    assert.equal(response.headers.get('content-length'), null);
    assert.equal(response.headers.get('cache-control'), null);
    const text = await response.text();
    assert.ok(Buffer.byteLength(text) > 4_500_000);
    assert.deepEqual(JSON.parse(text), value);
  } finally { server.close(); }
});

test('credential fields reject an export before any response bytes are sent', async () => {
  const { server, url } = await serve({ child: { id: 'child-a' }, events: [{ body: { token_hash: 'private-value' } }] });
  try {
    const response = await fetch(url);
    assert.equal(response.status, 422);
    assert.equal(await response.text(), 'Export rejected');
    assert.equal(response.headers.get('content-disposition'), null);
  } finally { server.close(); }
});
