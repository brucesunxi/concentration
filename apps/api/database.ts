import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { migrateStudio } from './studio-schema.ts';
import { migrateFamilyContent } from './family-content-schema.ts';
import { migrateReflectionSharing } from './reflection-schema.ts';
import { CONTEXT_SQL, databaseContext } from './database-context.ts';
import type { DatabaseContext } from './database-context.ts';
import { migrateFamilyIsolation } from './family-isolation.ts';
import { migrateAccountSecurity } from './account-schema.ts';
import { migratePracticeLimits } from './practice-limits.ts';
import { migrateMembers, migrateMemberAudit, migrateMemberAuthGuard, migrateMemberWriteGuard, migrateMemberLifeGuard, migrateLocalConfirmationRead } from './member-schema.ts';
import { migrateAuthRateLimit } from './auth-rate-limit.ts';

export interface Queryable { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
export interface Database extends Queryable { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>; close(): Promise<void>; context?<T>(context: DatabaseContext, action: () => Promise<T>): Promise<T> }

export async function openDatabase(location: string, postgresUrl?: string): Promise<Database> {
  if (postgresUrl) {
    const pool = new pg.Pool({ connectionString: postgresUrl, max: 8, connectionTimeoutMillis: 20000 });
    const context = databaseContext();
    pool.on('error', () => console.error(JSON.stringify({ event: 'DATABASE_IDLE_CONNECTION_LOST' })));
    const database: Database = {
      query: <T>(sql: string, params?: unknown[]) => database.transaction(tx => tx.query<T>(sql, params)),
      context: context.run,
      async transaction(fn) {
        const values = context.values();
        const client = await pool.connect();
        let broken: Error | undefined;
        // A checked-out client can fail between queries (e.g. the backend is
        // terminated while application work awaits). Pool's idle listener does
        // not cover that interval; retain the failure and destroy this client.
        const connectionError = (error: Error) => { broken = error; };
        client.on('error', connectionError);
        try {
          await client.query('BEGIN');
          await client.query("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
          await client.query(CONTEXT_SQL, values);
          const result = await fn({ query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as T[] }) });
          if (broken) throw broken;
          await client.query('COMMIT'); return result;
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch (rollbackError) { broken = rollbackError instanceof Error ? rollbackError : new Error('ROLLBACK_FAILED'); }
          throw error;
        } finally { client.release(broken); client.removeListener('error', connectionError); }
      }, close: () => pool.end(),
    };
    return database;
  }
  if (location !== 'memory://') await mkdir(location, { recursive: true, mode: 0o700 });
  const db = new PGlite(location); await db.waitReady;
  return { query: (sql, params) => db.query(sql, params), transaction: fn => db.transaction(tx => fn(tx)), close: () => db.close() };
}

export async function migrate(db: Database) {
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(164781, 1)');
    await migrateSchema({ query: tx.query.bind(tx), transaction: action => action(tx), close: async () => {} });
    await migrateFamilyIsolation(tx);
    await migrateAccountSecurity(tx);
    await migratePracticeLimits(tx);
    await migrateMembers(tx);
    await migrateMemberAudit(tx);
    await migrateMemberAuthGuard(tx);
    await migrateMemberWriteGuard(tx);
    await migrateMemberLifeGuard(tx);
    await migrateFamilyContent(tx);
    await migrateLocalConfirmationRead(tx);
    if (!(await tx.query('SELECT version FROM schema_migrations WHERE version=27')).rows.length) {
      await tx.query("ALTER TABLE families ADD COLUMN residence_country text NOT NULL DEFAULT 'ZZ' CHECK(residence_country ~ '^[A-Z]{2}$')");
      await tx.query('INSERT INTO schema_migrations(version) VALUES(27)');
    }
    if (!(await tx.query('SELECT version FROM schema_migrations WHERE version=28')).rows.length) {
      await tx.query("ALTER TABLE sessions ADD COLUMN release_scope_identity text NOT NULL DEFAULT 'local-development' CHECK(length(release_scope_identity) BETWEEN 1 AND 160)");
      await tx.query('INSERT INTO schema_migrations(version) VALUES(28)');
    }
    if (!(await tx.query('SELECT version FROM schema_migrations WHERE version=29')).rows.length) {
      await tx.query('ALTER TABLE children ADD CONSTRAINT children_family_id_id UNIQUE(family_id,id)');
      await tx.query(`CREATE TABLE guardian_consents (
        id uuid PRIMARY KEY, family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        child_id uuid NOT NULL, owner_member_id uuid NOT NULL,
        provider text NOT NULL CHECK(provider ~ '^[a-z][a-z0-9_-]{2,39}$'),
        verification_ref_hash text NOT NULL CHECK(verification_ref_hash ~ '^[a-f0-9]{64}$'),
        country text NOT NULL CHECK(country ~ '^[A-Z]{2}$'),
        age_band text NOT NULL CHECK(age_band IN ('6-8','9-11','12-14','15-17')),
        locale text NOT NULL CHECK(locale IN ('zh-CN','en')),
        purpose text NOT NULL CHECK(purpose='family-practice'),
        notice_version text NOT NULL, notice_sha256 text NOT NULL CHECK(notice_sha256 ~ '^[a-f0-9]{64}$'),
        release_scope_identity text NOT NULL CHECK(length(release_scope_identity) BETWEEN 1 AND 160),
        verified_at timestamptz NOT NULL, granted_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL, withdrawn_at timestamptz,
        UNIQUE(provider,verification_ref_hash),
        FOREIGN KEY(family_id,child_id) REFERENCES children(family_id,id) ON DELETE CASCADE,
        FOREIGN KEY(family_id,owner_member_id) REFERENCES family_members(family_id,id),
        CHECK(verified_at<=granted_at AND granted_at<expires_at)
      )`);
      await tx.query('CREATE INDEX guardian_consent_active_lookup ON guardian_consents(family_id,child_id,release_scope_identity,expires_at) WHERE withdrawn_at IS NULL');
      await tx.query('ALTER TABLE public.guardian_consents ENABLE ROW LEVEL SECURITY');
      await tx.query(`CREATE POLICY family_isolation_v1 ON public.guardian_consents USING (
        nullif(current_setting('focus.mode',true),'')='family'
        AND family_id=nullif(current_setting('focus.family_id',true),'')::uuid
        AND current_setting('focus.member_state',true)='active'
        AND (current_setting('focus.scope',true)='parent' OR child_id=nullif(current_setting('focus.child_id',true),'')::uuid)
        AND EXISTS(SELECT 1 FROM public.children c WHERE c.id=guardian_consents.child_id)
      ) WITH CHECK (
        nullif(current_setting('focus.mode',true),'')='family'
        AND family_id=nullif(current_setting('focus.family_id',true),'')::uuid
        AND current_setting('focus.scope',true)='parent'
        AND current_setting('focus.member_role',true)='owner'
        AND current_setting('focus.member_state',true)='active'
        AND owner_member_id=nullif(current_setting('focus.member_id',true),'')::uuid
        AND EXISTS(SELECT 1 FROM public.children c WHERE c.id=guardian_consents.child_id)
      )`);
      await tx.query('INSERT INTO schema_migrations(version) VALUES(29)');
    }
    if (!(await tx.query('SELECT version FROM schema_migrations WHERE version=30')).rows.length) {
      await tx.query(`ALTER TABLE children
        ADD COLUMN age_review_version int NOT NULL DEFAULT 1 CHECK(age_review_version > 0),
        ADD COLUMN age_reviewed_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN age_review_due_at timestamptz NOT NULL DEFAULT (now() + interval '365 days'),
        ADD COLUMN age_transition_target text CHECK(age_transition_target IN ('6-8','9-11','12-14','15-17','18+')),
        ADD COLUMN age_transition_requested_at timestamptz,
        ADD COLUMN age_transition_request_key text,
        ADD CONSTRAINT age_transition_consistent CHECK (
          (age_transition_target IS NULL AND age_transition_requested_at IS NULL AND age_transition_request_key IS NULL)
          OR (age_transition_target IS NOT NULL AND age_transition_requested_at IS NOT NULL AND age_transition_request_key IS NOT NULL)
        )`);
      await tx.query("UPDATE children SET age_reviewed_at=created_at,age_review_due_at=created_at+interval '365 days'");
      await tx.query('INSERT INTO schema_migrations(version) VALUES(30)');
    }
    await migrateAuthRateLimit(tx);
  });
}

async function migrateSchema(db: Database) {
  await db.transaction(async tx => {
    await tx.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = await tx.query('SELECT version FROM schema_migrations WHERE version = 1');
    if (applied.rows.length) return;
    const statements = [
      `CREATE TABLE families (id uuid PRIMARY KEY, name text NOT NULL, login_name text UNIQUE NOT NULL, password_hash text NOT NULL, timezone text NOT NULL, locale text NOT NULL CHECK (locale IN ('zh-CN','en')), created_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE children (id uuid PRIMARY KEY, family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE, alias text NOT NULL CHECK (length(alias) BETWEEN 1 AND 24), age_band text NOT NULL CHECK (age_band IN ('6-8','9-11','12-14','15-17')), locale text NOT NULL CHECK (locale IN ('zh-CN','en')), levels jsonb NOT NULL DEFAULT '{"search":1,"stop":1,"memory":1,"sustain":1}', completed_sessions int NOT NULL DEFAULT 0 CHECK (completed_sessions >= 0), consent_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE auth_sessions (token_hash text PRIMARY KEY, csrf text NOT NULL, family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE, child_id uuid REFERENCES children(id) ON DELETE CASCADE, scope text NOT NULL CHECK (scope IN ('parent','child')), expires_at timestamptz NOT NULL, CHECK ((scope='parent' AND child_id IS NULL) OR (scope='child' AND child_id IS NOT NULL)))`,
      `CREATE TABLE local_confirmations (id uuid PRIMARY KEY, family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE, child_id uuid REFERENCES children(id) ON DELETE CASCADE, purpose text NOT NULL, version text NOT NULL, acknowledged_at timestamptz NOT NULL, withdrawn_at timestamptz)`,
      `CREATE TABLE sessions (id uuid PRIMARY KEY, child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE, request_key text NOT NULL, request_hash text NOT NULL, device_id uuid NOT NULL, plan jsonb NOT NULL, state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','completed','aborted','revoked')), budget_day text NOT NULL, budget_ms int NOT NULL CHECK (budget_ms >= 0), used_ms int NOT NULL DEFAULT 0 CHECK (used_ms >= 0), result jsonb, created_at timestamptz NOT NULL, completed_at timestamptz, UNIQUE (child_id,request_key))`,
      `CREATE UNIQUE INDEX one_active_session_per_child ON sessions (child_id) WHERE state='active'`,
      `CREATE TABLE events (session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, seq int NOT NULL CHECK (seq > 0), event_id uuid NOT NULL, body jsonb NOT NULL, PRIMARY KEY (session_id,seq), UNIQUE(session_id,event_id))`,
      `CREATE TABLE observations (id uuid PRIMARY KEY, child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE, task text NOT NULL, context text NOT NULL, prompts int NOT NULL CHECK(prompts BETWEEN 0 AND 20), child_choice boolean NOT NULL, created_at timestamptz NOT NULL)`,
      `CREATE INDEX session_history ON sessions(child_id,created_at DESC)`,
      `INSERT INTO schema_migrations(version) VALUES(1)`,
    ];
    for (const sql of statements) await tx.query(sql);
  });
  await db.transaction(async tx => {
    const applied = await tx.query('SELECT version FROM schema_migrations WHERE version = 2');
    if (applied.rows.length) return;
    await tx.query('ALTER TABLE children ADD COLUMN course_units int NOT NULL DEFAULT 0 CHECK (course_units BETWEEN 0 AND 24)');
    // Replay completed records without treating free choice as a skipped course unit.
    const { rows } = await tx.query<{ child_id: string; task: string }>(`SELECT child_id, plan->>'task' AS task FROM sessions WHERE state='completed' ORDER BY completed_at,id`);
    const counts = new Map<string, number>();
    for (const row of rows) {
      const count = counts.get(row.child_id) ?? 0;
      if (count < 24 && row.task === ['search', 'stop', 'memory', 'sustain'][Math.floor(count / 3) % 4]) counts.set(row.child_id, count + 1);
    }
    for (const [childId, count] of counts) await tx.query('UPDATE children SET course_units=$2 WHERE id=$1', [childId, count]);
    await tx.query('INSERT INTO schema_migrations(version) VALUES(2)');
  });
  await db.transaction(async tx => {
    const applied = await tx.query('SELECT version FROM schema_migrations WHERE version=3');
    if (applied.rows.length) return;
    await tx.query(`CREATE TABLE content_signers (id text PRIMARY KEY, identity jsonb NOT NULL)`);
    await tx.query(`CREATE TABLE content_releases (hash text PRIMARY KEY, pack_id text NOT NULL, version text NOT NULL, envelope jsonb NOT NULL, state text NOT NULL CHECK(state IN ('active','recalled')), recalled_at timestamptz, reason text, UNIQUE(pack_id,version))`);
    await tx.query(`CREATE TABLE content_audit (id uuid PRIMARY KEY, hash text NOT NULL REFERENCES content_releases(hash), action text NOT NULL, actor text NOT NULL, at timestamptz NOT NULL, reason text NOT NULL)`);
    await tx.query('INSERT INTO schema_migrations(version) VALUES(3)');
  });
  await db.transaction(async tx => {
    if ((await tx.query('SELECT version FROM schema_migrations WHERE version=4')).rows.length) return;
    await tx.query("ALTER TABLE auth_sessions ADD COLUMN transport text NOT NULL DEFAULT 'web' CHECK (transport IN ('web','native'))");
    await tx.query('INSERT INTO schema_migrations(version) VALUES(4)');
  });
  await db.transaction(async tx => {
    if ((await tx.query('SELECT version FROM schema_migrations WHERE version=5')).rows.length) return;
    await tx.query('ALTER TABLE observations ADD COLUMN request_key text, ADD COLUMN request_hash text');
    await tx.query('CREATE UNIQUE INDEX observation_request_key ON observations(child_id,request_key) WHERE request_key IS NOT NULL');
    await tx.query('INSERT INTO schema_migrations(version) VALUES(5)');
  });
  await db.transaction(async tx => {
    if ((await tx.query('SELECT version FROM schema_migrations WHERE version=6')).rows.length) return;
    await tx.query('CREATE INDEX session_report_time ON sessions(child_id,(coalesce(completed_at,created_at)))');
    await tx.query('CREATE INDEX observation_history ON observations(child_id,created_at)');
    await tx.query('INSERT INTO schema_migrations(version) VALUES(6)');
  });
  await db.transaction(async tx => {
    if ((await tx.query('SELECT version FROM schema_migrations WHERE version=7')).rows.length) return;
    await tx.query(`CREATE TABLE life_goals (id uuid PRIMARY KEY, child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE, version int NOT NULL CHECK(version>0), state text NOT NULL CHECK(state IN ('proposed','active','reflected','declined','stopped')), template jsonb NOT NULL, support text NOT NULL CHECK(support IN ('together','ask-first','space')), created_by text NOT NULL CHECK(created_by IN ('parent','child')), reflection jsonb, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, closed_reason text CHECK(closed_reason='withdrawn'), request_key text NOT NULL, request_hash text NOT NULL, UNIQUE(child_id,request_key), CHECK((state='reflected')=(reflection IS NOT NULL)))`);
    await tx.query("CREATE UNIQUE INDEX one_open_life_goal ON life_goals(child_id) WHERE state IN ('proposed','active')");
    await tx.query('CREATE INDEX life_goal_history ON life_goals(child_id,created_at DESC,id DESC)');
    await tx.query(`CREATE TABLE life_goal_actions (id uuid PRIMARY KEY, goal_id uuid NOT NULL REFERENCES life_goals(id) ON DELETE CASCADE, version int NOT NULL, actor_scope text NOT NULL CHECK(actor_scope IN ('parent','child')), payload jsonb NOT NULL, request_key text, request_hash text, created_at timestamptz NOT NULL, UNIQUE(goal_id,version), UNIQUE(goal_id,request_key), CHECK((request_key IS NULL)=(request_hash IS NULL)))`);
    await tx.query('INSERT INTO schema_migrations(version) VALUES(7)');
  });
  await db.transaction(async tx => {
    if ((await tx.query('SELECT version FROM schema_migrations WHERE version=8')).rows.length) return;
    await tx.query('CREATE TABLE session_authorities(id text PRIMARY KEY, identity jsonb NOT NULL)');
    await tx.query('ALTER TABLE sessions ADD COLUMN continuation_grant jsonb');
    await tx.query('ALTER TABLE auth_sessions ADD COLUMN device_id uuid');
    await tx.query('INSERT INTO schema_migrations(version) VALUES(8)');
  });
  await db.transaction(async tx => {
    if ((await tx.query('SELECT version FROM schema_migrations WHERE version=9')).rows.length) return;
    await tx.query('ALTER TABLE sessions ADD COLUMN closed_reason text');
    await tx.query('INSERT INTO schema_migrations(version) VALUES(9)');
  });
  await db.transaction(async tx => {
    if ((await tx.query('SELECT version FROM schema_migrations WHERE version=10')).rows.length) return;
    await tx.query(`CREATE TABLE session_handovers (session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE, target_device_id uuid NOT NULL, request_key text NOT NULL, request_hash text NOT NULL, created_at timestamptz NOT NULL, UNIQUE(child_id,request_key))`);
    await tx.query('INSERT INTO schema_migrations(version) VALUES(10)');
  });
  await migrateStudio(db);
  await migrateReflectionSharing(db);
}
