import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type http from 'node:http';
import { ApiError } from './service.ts';

export const MAX_CHILD_EXPORT_BYTES = 100_000_000;

// Build the complete file in a private, short-lived directory before replying.
// A database or privacy-check failure can then produce a normal JSON error,
// never a successful download with only some of the child's records.
export async function deliverChildExportFile(response: http.ServerResponse, produce: (write: (chunk: string) => Promise<void>) => Promise<void>, maxBytes = MAX_CHILD_EXPORT_BYTES) {
  const directory = await mkdtemp(join(tmpdir(), 'focus-child-export-'));
  const path = join(directory, 'records.enc');
  const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let bytes = 0;
  try {
    handle = await open(path, 'wx', 0o600);
    const writeEncrypted = async (buffer: Buffer) => {
      for (let offset = 0; offset < buffer.length;) {
        const result = await handle!.write(buffer, offset, buffer.length - offset);
        if (!result.bytesWritten) throw new Error('EXPORT_FILE_WRITE_FAILED');
        offset += result.bytesWritten;
      }
    };
    await produce(async chunk => {
      if (response.destroyed) throw new Error('EXPORT_CLIENT_DISCONNECTED');
      const buffer = Buffer.from(chunk, 'utf8');
      if (bytes + buffer.length > maxBytes) throw new ApiError(413, 'EXPORT_SERVER_LIMIT', '记录超过当前单次导出上限，文件尚未生成。请保留原设备资料，待支持分批导出。');
      await writeEncrypted(cipher.update(buffer));
      bytes += buffer.length;
    });
    await writeEncrypted(cipher.final());
    const tag = cipher.getAuthTag();
    await handle.close(); handle = undefined;
    const decrypt = () => { const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag); return decipher; };
    // Check the whole ciphertext before the first response byte. A truncated
    // temporary file must fail as an ordinary error, not as a partial download.
    await pipeline(createReadStream(path), decrypt(), new Writable({ write(_chunk, _encoding, done) { done(); } }));
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="focus-family-records.json"',
    });
    await pipeline(createReadStream(path), decrypt(), response);
  } finally {
    key.fill(0);
    if (handle) await handle.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}
