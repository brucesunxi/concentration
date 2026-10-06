import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverChildExportFile } from '../apps/api/export-file.ts';

async function serve(produce, maxBytes) {
  let completed;
  const completion = new Promise(resolve => { completed = resolve; });
  const server = http.createServer(async (_request, response) => {
    try { await deliverChildExportFile(response, produce, maxBytes); }
    catch (error) { if (!response.headersSent) response.writeHead(error.status ?? 500).end(error.code ?? 'Export rejected'); else response.destroy(); }
    finally { completed(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}`, completion };
}

test('a private staged export over 4.5 MB reaches the client completely, then removes its temporary file', { timeout: 30000 }, async () => {
  const before = (await readdir(tmpdir())).filter(name => name.startsWith('focus-child-export-'));
  const rows = Array.from({ length: 90 }, (_, index) => ({ id: index, note: 'x'.repeat(60000) }));
  const marker = 'PRIVATE_SYNTHETIC_CHILD_RECORD_4821';
  const value = { schemaVersion: 2, child: { id: 'child-a', alias: marker }, observations: rows };
  const { server, url, completion } = await serve(async write => {
    await write(`{"schemaVersion":2,"child":{"id":"child-a","alias":"${marker}"},"observations":[`);
    const newDirectories = (await readdir(tmpdir())).filter(name => name.startsWith('focus-child-export-') && !before.includes(name));
    assert.ok(newDirectories.length >= 1);
    for (const directory of newDirectories) {
      const encrypted = await readFile(join(tmpdir(), directory, 'records.enc')).catch(() => null);
      if (encrypted) assert.equal(encrypted.includes(Buffer.from(marker)), false);
    }
    for (const [index, row] of rows.entries()) await write((index ? ',' : '') + JSON.stringify(row));
    await write(']}');
  });
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('transfer-encoding') ?? '', /chunked/);
    assert.equal(response.headers.get('content-length'), null);
    const text = await response.text();
    assert.ok(Buffer.byteLength(text) > 4_500_000);
    assert.deepEqual(JSON.parse(text), value);
    await completion;
    assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('focus-child-export-')), before);
  } finally { server.close(); }
});

test('a failed producer or size cap rejects before any successful file response', async () => {
  const before = (await readdir(tmpdir())).filter(name => name.startsWith('focus-child-export-'));
  for (const [produce, expectedStatus, expectedBody] of [
    [async write => { await write('private partial data'); throw new Error('query failed'); }, 500, 'Export rejected'],
    [async write => { await write('x'.repeat(101)); }, 413, 'EXPORT_SERVER_LIMIT'],
  ]) {
    const { server, url, completion } = await serve(produce, 100);
    try {
      const response = await fetch(url);
      assert.equal(response.status, expectedStatus);
      assert.equal(response.headers.get('content-disposition'), null);
      assert.equal(await response.text(), expectedBody);
      await completion;
      assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('focus-child-export-')), before);
    } finally { server.close(); }
  }
});
