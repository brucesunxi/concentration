import type { Queryable } from './database.ts';
import { REQUIRED_SCHEMA_VERSION } from './family-isolation.ts';

/** A warm server is ready only while its database is reachable and current. */
export async function databaseReady(db: Queryable): Promise<boolean> {
  try {
    const result=await db.query<{version:number}>('SELECT max(version)::int AS version FROM schema_migrations');
    return result.rows[0]?.version===REQUIRED_SCHEMA_VERSION;
  } catch {
    return false;
  }
}
