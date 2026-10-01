import type { Database, Queryable } from './database.ts';
export const REQUIRED_SCHEMA_VERSION = 30;

const LEGACY_FAMILY_TABLES = ['families', 'children', 'auth_sessions', 'local_confirmations', 'sessions', 'events', 'observations', 'life_goals', 'life_goal_actions', 'session_handovers'] as const;
export const FAMILY_TABLES = [...LEGACY_FAMILY_TABLES, 'family_members', 'family_invitations', 'family_member_audit', 'guardian_consents'] as const;
export const CONTENT_READ_TABLES = ['content_signers', 'content_releases', 'content_channels', 'session_authorities', 'content_media_objects', 'family_content_releases', 'family_content_channels'] as const;
export const STUDIO_TABLES = ['studio_users', 'studio_sessions', 'studio_drafts', 'studio_reviews', 'studio_audit', 'studio_commands', 'studio_write_guard', 'studio_previews', 'studio_media', 'content_media_sources', 'content_media_objects', 'content_signers', 'content_releases', 'content_channels', 'content_audit', 'family_content_releases', 'family_content_channels', 'support_drafts', 'support_reviews', 'support_commands', 'support_audit'] as const;
const setting = (name: string) => `nullif(current_setting('focus.${name}',true),'')`;
const mode = setting('mode'), family = `${setting('family_id')}::uuid`, child = `${setting('child_id')}::uuid`, scope = setting('scope');
const inFamily = `${mode}='family'`;
const visibleChild = (column: string) => `EXISTS (SELECT 1 FROM public.children c WHERE c.id=${column})`;
const ownedFamily = `family_id=${family}`;
const childScope = `(${scope}='parent' OR (${scope}='child' AND child_id=${child}))`;
const policies: Record<typeof LEGACY_FAMILY_TABLES[number], string> = {
  families: `((${inFamily} OR ${mode}='setup') AND id=${family}) OR (${mode}='login' AND login_name=${setting('login_name')})`,
  children: `${inFamily} AND ${ownedFamily} AND (${scope}='parent' OR (${scope}='child' AND id=${child}))`,
  auth_sessions: `(${mode}='authenticate' AND token_hash=${setting('token_hash')}) OR (${inFamily} AND ${ownedFamily} AND ${childScope}) OR (${mode}='setup' AND ${ownedFamily} AND scope='parent' AND child_id IS NULL) OR (${mode}='login' AND scope='parent' AND child_id IS NULL AND EXISTS (SELECT 1 FROM public.families f WHERE f.id=auth_sessions.family_id))`,
  local_confirmations: `${inFamily} AND ${ownedFamily} AND (${scope}='parent' OR child_id=${child}) AND (child_id IS NULL OR ${visibleChild('local_confirmations.child_id')})`,
  sessions: `${inFamily} AND ${visibleChild('sessions.child_id')}`,
  events: `${inFamily} AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.id=events.session_id)`,
  observations: `${inFamily} AND ${visibleChild('observations.child_id')}`,
  life_goals: `${inFamily} AND ${visibleChild('life_goals.child_id')}`,
  life_goal_actions: `${inFamily} AND EXISTS (SELECT 1 FROM public.life_goals g WHERE g.id=life_goal_actions.goal_id)`,
  session_handovers: `${inFamily} AND ${visibleChild('session_handovers.child_id')} AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.id=session_handovers.session_id AND s.child_id=session_handovers.child_id)`,
};

export async function migrateFamilyIsolation(tx: Queryable) {
  if (!(await tx.query('SELECT version FROM schema_migrations WHERE version=16')).rows.length) {
  for (const name of LEGACY_FAMILY_TABLES) {
    await tx.query(`ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY`);
    await tx.query(`CREATE POLICY family_isolation_v1 ON public.${name} USING (${policies[name]}) WITH CHECK (${policies[name]})`);
  }
  // Row locking requires UPDATE privilege in PostgreSQL. Grant this narrow,
  // fixed-query function rather than allowing the family role to edit releases.
  await tx.query(`CREATE FUNCTION public.focus_locked_release(release_hash text) RETURNS TABLE(envelope jsonb,state text)
    LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
      SELECT r.envelope,r.state FROM public.content_releases r WHERE r.hash=release_hash FOR SHARE
    $$`);
  await tx.query('REVOKE ALL ON FUNCTION public.focus_locked_release(text) FROM PUBLIC');
  await tx.query('INSERT INTO schema_migrations(version) VALUES(16)');
  }
  if ((await tx.query('SELECT version FROM schema_migrations WHERE version=17')).rows.length) return;
  // A parent may issue a child credential only for a visible child, even when a
  // caller accidentally combines IDs from different families.
  await tx.query(`ALTER POLICY family_isolation_v1 ON public.auth_sessions WITH CHECK (
    (${policies.auth_sessions}) AND (child_id IS NULL OR ${visibleChild('auth_sessions.child_id')})
  )`);
  // Studio can revoke sessions for an already-recalled release without reading
  // family records. No identifiers, counts, or rows leave this fixed function.
  await tx.query(`CREATE FUNCTION public.focus_revoke_recalled_sessions(release_hash text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
    DECLARE item record;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.content_releases WHERE hash=release_hash AND state='recalled') THEN
        RAISE EXCEPTION 'CONTENT_RECALL_REQUIRED' USING ERRCODE='42501';
      END IF;
      FOR item IN SELECT id,child_id FROM public.sessions WHERE state='active' AND plan->'content'->>'sha256'=release_hash ORDER BY child_id,id LOOP
        PERFORM id FROM public.children WHERE id=item.child_id FOR UPDATE;
        UPDATE public.sessions SET state='revoked',used_ms=budget_ms WHERE id=item.id AND state='active';
      END LOOP;
    END $$`);
  await tx.query('REVOKE ALL ON FUNCTION public.focus_revoke_recalled_sessions(text) FROM PUBLIC');
  await tx.query('INSERT INTO schema_migrations(version) VALUES(17)');
}

function roleName(name: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('DATABASE_ROLE_NAME_INVALID');
  return '"' + name + '"';
}
export async function grantRuntimeRoles(db: Database, familyRole: string, studioRole?: string) {
  const familyName = roleName(familyRole), studioName = studioRole ? roleName(studioRole) : null;
  if (familyRole === studioRole) throw new Error('DATABASE_ROLES_MUST_DIFFER');
  await db.transaction(async tx => {
    // The preparation command is for a dedicated application database.
    await tx.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await tx.query(`GRANT USAGE ON SCHEMA public TO ${familyName}`);
    await tx.query(`GRANT SELECT ON public.schema_migrations TO ${familyName}`);
    await tx.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${FAMILY_TABLES.map(x => 'public.' + x).join(',')} TO ${familyName}`);
    await tx.query(`GRANT SELECT ON ${CONTENT_READ_TABLES.map(x => 'public.' + x).join(',')} TO ${familyName}`);
    await tx.query(`GRANT EXECUTE ON FUNCTION public.focus_locked_release(text), public.focus_locked_family_content(text) TO ${familyName}`);
    if (studioName) {
      await tx.query(`GRANT USAGE ON SCHEMA public TO ${studioName}`);
      await tx.query(`GRANT SELECT ON public.schema_migrations TO ${studioName}`);
      await tx.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${STUDIO_TABLES.map(x => 'public.' + x).join(',')} TO ${studioName}`);
      await tx.query(`GRANT EXECUTE ON FUNCTION public.focus_locked_release(text), public.focus_locked_family_content(text) TO ${studioName}`);
      await tx.query(`GRANT EXECUTE ON FUNCTION public.focus_revoke_recalled_sessions(text) TO ${studioName}`);
    }
  });
}

export async function verifyRuntimeRole(db: Database, kind: 'family' | 'studio') {
  const role = (await db.query<{ unsafe: boolean }>(`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE
    (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb) AND pg_has_role(current_user,oid,'MEMBER')) AS unsafe`)).rows[0];
  if (!role || role.unsafe) throw new Error('DATABASE_RUNTIME_ROLE_UNSAFE');
  if (!(await db.query<{ yes: boolean }>("SELECT has_table_privilege(current_user,'public.schema_migrations','SELECT') AS yes")).rows[0].yes) throw new Error('DATABASE_SCHEMA_UPGRADE_REQUIRED');
  const version = (await db.query<{ version: number }>('SELECT max(version) AS version FROM schema_migrations')).rows[0].version;
  // Permit the next additive schema during a rolling Vercel deployment. The
  // application still verifies every table and privilege it currently uses.
  if (version < REQUIRED_SCHEMA_VERSION || version > REQUIRED_SCHEMA_VERSION + 1) throw new Error('DATABASE_SCHEMA_UPGRADE_REQUIRED');
  const tables = (await db.query<{ name: string; protected: boolean; owner_access: boolean; policies: number; expected: boolean; confirmation_read: boolean }>(`SELECT c.relname AS name,c.relrowsecurity AS protected,pg_has_role(current_user,c.relowner,'MEMBER') AS owner_access,
    (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
    EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='family_isolation_v1') AS expected,
    EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='family_local_confirmation_read' AND p.polcmd='r') AS confirmation_read
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [FAMILY_TABLES])).rows;
  if (tables.length !== FAMILY_TABLES.length || tables.some(row => row.owner_access || !row.protected || !row.expected ||
    (row.name === 'local_confirmations' ? row.policies !== 2 || !row.confirmation_read : row.policies !== 1 || row.confirmation_read))) throw new Error('DATABASE_FAMILY_ISOLATION_REQUIRED');
  const canCreate = (await db.query<{ yes: boolean }>("SELECT has_schema_privilege(current_user,'public','CREATE') AS yes")).rows[0].yes;
  if (canCreate) throw new Error('DATABASE_RUNTIME_DDL_FORBIDDEN');
  const crossTables = kind === 'family' ? STUDIO_TABLES.filter(x => !(CONTENT_READ_TABLES as readonly string[]).includes(x)) : FAMILY_TABLES;
  const crossAccess = (await db.query<{ yes: boolean }>("SELECT coalesce(bool_or(has_table_privilege(current_user,'public.' || t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),false) AS yes FROM unnest($1::text[]) t", [crossTables])).rows[0];
  if (crossAccess.yes) throw new Error('DATABASE_CROSS_ROLE_PRIVILEGE');
  if (kind === 'family' && (await db.query<{ yes: boolean }>("SELECT coalesce(bool_or(has_table_privilege(current_user,'public.' || t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),false) AS yes FROM unnest($1::text[]) t", [CONTENT_READ_TABLES])).rows[0].yes) throw new Error('DATABASE_CONTENT_WRITE_FORBIDDEN');
  const required = kind === 'family' ? FAMILY_TABLES : STUDIO_TABLES;
  if ((await db.query<{ yes: boolean }>("SELECT coalesce(bool_or(has_table_privilege(current_user,'public.' || t,'TRUNCATE,REFERENCES,TRIGGER')),false) AS yes FROM unnest($1::text[]) t", [required])).rows[0].yes) throw new Error('DATABASE_RUNTIME_PRIVILEGE_UNSAFE');
  if ((await db.query<{ yes: boolean }>("SELECT has_table_privilege(current_user,'public.schema_migrations','INSERT,UPDATE,DELETE,TRUNCATE') AS yes")).rows[0].yes) throw new Error('DATABASE_MIGRATION_WRITE_FORBIDDEN');
  const functions = ['focus_locked_release(text)', 'focus_locked_family_content(text)', ...(kind === 'studio' ? ['focus_revoke_recalled_sessions(text)'] : [])];
  if (!(await db.query<{ yes: boolean }>("SELECT bool_and(has_function_privilege(current_user,'public.' || f,'EXECUTE')) AS yes FROM unnest($1::text[]) f", [functions])).rows[0].yes) throw new Error('DATABASE_RUNTIME_GRANT_MISSING');
  if (kind === 'family' && (await db.query<{ yes: boolean }>("SELECT has_function_privilege(current_user,'public.focus_revoke_recalled_sessions(text)','EXECUTE') AS yes")).rows[0].yes) throw new Error('DATABASE_CROSS_ROLE_PRIVILEGE');
  const privileges = (await db.query<{ yes: boolean }>(`SELECT bool_and(has_table_privilege(current_user,t,p)) AS yes
    FROM unnest($1::text[]) t CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p`, [required.map(x => 'public.' + x)])).rows[0];
  if (!privileges.yes) throw new Error('DATABASE_RUNTIME_GRANT_MISSING');
}
