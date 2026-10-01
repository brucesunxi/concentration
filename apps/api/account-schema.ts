import type { Queryable } from './database.ts';
export async function migrateAccountSecurity(tx: Queryable) {
  if ((await tx.query('SELECT version FROM schema_migrations WHERE version=18')).rows.length) return;
  await tx.query(`ALTER TABLE families ADD COLUMN password_changed_at timestamptz,
    ADD COLUMN auth_failures int NOT NULL DEFAULT 0 CHECK(auth_failures>=0),
    ADD COLUMN auth_locked_until timestamptz`);
  await tx.query('CREATE INDEX active_family_auth ON auth_sessions(family_id,expires_at)');
  await tx.query('INSERT INTO schema_migrations(version) VALUES(18)');
}
