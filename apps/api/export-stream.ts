import type http from 'node:http';
import { assertExportSafe } from '../../packages/session-runtime/export-safety.ts';

// Keeping each row separate lets Node send the response progressively. In
// particular, Vercel must not receive one buffered JSON response over 4.5 MB.
export function* childExportJsonChunks(value: Record<string, unknown>): Generator<string> {
  yield '{';
  let first = true;
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue;
    if (!first) yield ',';
    first = false;
    yield JSON.stringify(key) + ':';
    if (Array.isArray(entry)) {
      yield '[';
      for (let index = 0; index < entry.length; index++) {
        if (index) yield ',';
        yield JSON.stringify(entry[index]) ?? 'null';
      }
      yield ']';
    } else yield JSON.stringify(entry);
  }
  yield '}';
}

async function writeChunk(response: http.ServerResponse, chunk: string) {
  if (response.destroyed) throw new Error('EXPORT_CLIENT_DISCONNECTED');
  if (response.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const drain = () => { cleanup(); resolve(); };
    const close = () => { cleanup(); reject(new Error('EXPORT_CLIENT_DISCONNECTED')); };
    const cleanup = () => { response.off('drain', drain); response.off('close', close); };
    response.once('drain', drain);
    response.once('close', close);
  });
}

export async function streamChildExport(response: http.ServerResponse, value: Record<string, unknown>) {
  // Validate before sending headers: a failed privacy check must never leave
  // the family with a partial file containing data from earlier rows.
  assertExportSafe(value);
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="focus-family-records.json"',
  });
  for (const chunk of childExportJsonChunks(value)) await writeChunk(response, chunk);
  response.end();
}
