import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TLSSocket } from 'node:tls';
import pg from 'pg';
import { verifyRuntimeRole, REQUIRED_SCHEMA_VERSION } from '../apps/api/family-isolation.ts';
import type { Database } from '../apps/api/database.ts';
import { verifiedPostgresUrl } from '../packages/database/neon-tls.ts';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--url-file') throw new Error('Usage: npm run db:audit:runtime -- --url-file /private/path/to/runtime-url');
const path = resolve(args[1]);
const file = await lstat(path);
if (!file.isFile() || (file.mode & 0o077) !== 0) throw new Error('RUNTIME_URL_FILE_MUST_BE_PRIVATE');
const connectionString = (await readFile(path, 'utf8')).trim();
let url: URL;
try { url = new URL(connectionString); } catch { throw new Error('INVALID_RUNTIME_URL'); }
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') || url.username !== 'focus_family_runtime') {
  throw new Error('RUNTIME_AUDIT_REQUIRES_NEON_LIMITED_ROLE');
}

const client = new pg.Client({ connectionString: verifiedPostgresUrl(connectionString), connectionTimeoutMillis: 12000, statement_timeout: 12000 });
let connected = false;
try {
  await client.connect(); connected = true;
  const stream = (client as unknown as { connection: { stream: TLSSocket } }).connection.stream;
  if (stream.encrypted !== true || stream.authorized !== true) throw new Error('NEON_TLS_PEER_NOT_VERIFIED');
  await client.query('BEGIN READ ONLY');
  const mode = await client.query<{ transaction_read_only: string }>('SHOW transaction_read_only');
  if (mode.rows[0]?.transaction_read_only !== 'on') throw new Error('READ_ONLY_TRANSACTION_REQUIRED');
  // The server's own role, policy and grant checks run inside a read-only transaction.
  await verifyRuntimeRole({ query: client.query.bind(client) } as unknown as Database, 'family');
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ event: 'NEON_RUNTIME_READONLY_AUDIT', schema: REQUIRED_SCHEMA_VERSION, role: 'family-runtime', tlsPeerVerified: true, readOnly: true, isolationVerified: true }));
} catch (error) {
  if (connected) await client.query('ROLLBACK').catch(() => {});
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'CONNECTION_OR_QUERY_FAILED';
  console.error(`NEON_RUNTIME_READONLY_AUDIT_FAILED: ${code}`);
  process.exitCode = 1;
} finally {
  if (connected) await client.end().catch(() => {});
}
