import { resolve } from 'node:path';
import { openDatabase, migrate } from '../apps/api/database.ts';
import { grantRuntimeRoles, REQUIRED_SCHEMA_VERSION } from '../apps/api/family-isolation.ts';
import { createLocalContent } from '../apps/api/content.ts';
import { createSessionAuthority } from '../apps/api/session-authority.ts';

// Run explicitly with a migration identity for a dedicated application database.
// This process never listens on a port and never prints a URL or credential.
if (process.env.APP_MODE === 'production') throw new Error('PRODUCTION_RELEASE_GATED');
const url = process.env.DATABASE_MIGRATION_URL, role = process.env.FOCUS_DATABASE_ROLE;
if (!url || !role || !process.env.FOCUS_DATA_DIR) throw new Error('DATABASE_PREPARATION_CONFIG_REQUIRED');
const dataDir = resolve(process.env.FOCUS_DATA_DIR);
const db = await openDatabase('memory://', url);
try {
  await migrate(db);
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(164781, 2)');
    const prepared = { query: tx.query.bind(tx), transaction: <T>(fn: (query: typeof tx) => Promise<T>) => fn(tx), close: async () => {} };
    await createLocalContent(prepared, { dataDir });
    await createSessionAuthority(prepared, { dataDir });
    await grantRuntimeRoles(prepared, role, process.env.FOCUS_STUDIO_DATABASE_ROLE);
  });
  console.log(JSON.stringify({ event: 'DATABASE_PREPARED', schema: REQUIRED_SCHEMA_VERSION, mode: 'local-development' }));
} finally { await db.close(); }
