import { randomUUID } from 'node:crypto';
import type { Queryable } from './database.ts';

export async function migrateMembers(tx: Queryable) {
  if ((await tx.query('SELECT version FROM schema_migrations WHERE version=20')).rows.length) return;
  await tx.query(`CREATE TABLE family_members (
    id uuid PRIMARY KEY, family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    login_name text NOT NULL CHECK(length(login_name) BETWEEN 3 AND 32), display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 40),
    role text NOT NULL CHECK(role IN ('owner','support')), state text NOT NULL CHECK(state IN ('pending','active','revoked')),
    child_ids uuid[] NOT NULL DEFAULT '{}', version int NOT NULL DEFAULT 1 CHECK(version>0),
    password_hash text NOT NULL, auth_failures int NOT NULL DEFAULT 0 CHECK(auth_failures>=0), auth_locked_until timestamptz, password_changed_at timestamptz,
    created_at timestamptz NOT NULL, approved_at timestamptz, revoked_at timestamptz,
    UNIQUE(family_id,login_name), UNIQUE(family_id,id),
    CHECK((role='owner' AND login_name='owner' AND state='active' AND cardinality(child_ids)=0) OR
      (role='support' AND login_name<>'owner' AND cardinality(child_ids) BETWEEN 1 AND 3)),
    CHECK((state='revoked')=(revoked_at IS NOT NULL)))`);
  await tx.query("CREATE UNIQUE INDEX family_owner ON family_members(family_id) WHERE role='owner'");
  await tx.query(`CREATE TABLE family_invitations (
    id uuid PRIMARY KEY, family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    created_by uuid NOT NULL, child_ids uuid[] NOT NULL CHECK(cardinality(child_ids) BETWEEN 1 AND 3),
    code_hash text NOT NULL UNIQUE CHECK(length(code_hash)=64), request_key text NOT NULL,
    created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, cancelled_at timestamptz,
    accepted_by uuid, accepted_at timestamptz, UNIQUE(family_id,request_key),
    FOREIGN KEY(family_id,created_by) REFERENCES family_members(family_id,id),
    FOREIGN KEY(family_id,accepted_by) REFERENCES family_members(family_id,id),
    CHECK(expires_at>created_at), CHECK((accepted_by IS NULL)=(accepted_at IS NULL)))`);
  await tx.query('ALTER TABLE auth_sessions ADD COLUMN member_id uuid');
  const old = await tx.query<{ id: string; name: string; password_hash: string; auth_failures: number; auth_locked_until: string | null; password_changed_at: string | null; created_at: string }>('SELECT * FROM families');
  for (const f of old.rows) {
    const id = randomUUID();
    await tx.query("INSERT INTO family_members(id,family_id,login_name,display_name,role,state,password_hash,auth_failures,auth_locked_until,password_changed_at,created_at,approved_at) VALUES($1,$2,'owner',$3,'owner','active',$4,$5,$6,$7,$8,$8)", [id,f.id,f.name,f.password_hash,f.auth_failures,f.auth_locked_until,f.password_changed_at,f.created_at]);
    await tx.query('UPDATE auth_sessions SET member_id=$2 WHERE family_id=$1', [f.id,id]);
  }
  await tx.query('ALTER TABLE auth_sessions ALTER COLUMN member_id SET NOT NULL, ADD CONSTRAINT auth_family_member FOREIGN KEY(family_id,member_id) REFERENCES family_members(family_id,id) ON DELETE CASCADE');
  await tx.query('CREATE INDEX active_member_auth ON auth_sessions(member_id,expires_at)');
  // Transaction-local identity is set by the server after credential lookup.
  const s = (key: string) => `nullif(current_setting('focus.${key}',true),'')`;
  const mode=s('mode'), family=`${s('family_id')}::uuid`, member=`${s('member_id')}::uuid`, child=`${s('child_id')}::uuid`, scope=s('scope');
  const inFamily=`${mode}='family'`, owner=`${s('member_role')}='owner'`, active=`${s('member_state')}='active'`;
  const owned=`family_id=${family}`, parent=`${scope}='parent'`, visible=(col:string)=>`EXISTS(SELECT 1 FROM public.children c WHERE c.id=${col})`;
  const joinFamily=(col:string)=>`EXISTS(SELECT 1 FROM public.family_invitations i WHERE i.family_id=${col})`;
  const loginFamily=(col:string)=>`EXISTS(SELECT 1 FROM public.families f WHERE f.id=${col})`;
  const policies: Record<string,string> = {
    families:`((${inFamily} OR ${mode}='setup' OR ${mode}='identity') AND id=${family}) OR (${mode}='login' AND login_name=${s('login_name')}) OR (${mode}='join' AND ${joinFamily('families.id')})`,
    family_invitations:`(${inFamily} AND ${owned} AND ${parent} AND ${owner} AND ${active}) OR (${mode}='join' AND code_hash=${s('invite_hash')})`,
    family_members:`(${inFamily} AND ${owned} AND (id=${member} OR (${parent} AND ${owner} AND ${active}))) OR (${mode}='identity' AND ${owned} AND id=${member}) OR (${mode}='setup' AND ${owned} AND role='owner') OR (${mode}='login' AND login_name=${s('member_login')} AND ${loginFamily('family_members.family_id')}) OR (${mode}='join' AND role='support' AND state='pending' AND ${joinFamily('family_members.family_id')})`,
    children:`${inFamily} AND ${owned} AND ${active} AND (${owner} OR id=ANY(coalesce(${s('child_ids')},'{}')::uuid[])) AND (${parent} OR (${scope}='child' AND id=${child}))`,
    auth_sessions:`(${mode}='authenticate' AND token_hash=${s('token_hash')}) OR (${inFamily} AND ${owned} AND ((${parent} AND ${owner} AND ${active}) OR member_id=${member}) AND (${parent} OR child_id=${child})) OR (${mode} IN ('setup','login','join') AND scope='parent' AND child_id IS NULL AND EXISTS(SELECT 1 FROM public.family_members m WHERE m.id=auth_sessions.member_id AND m.family_id=auth_sessions.family_id))`,
    local_confirmations:`${inFamily} AND ${owned} AND ${active} AND ((${parent} AND ${owner}) OR (${scope}='child' AND child_id=${child} AND ${visible('local_confirmations.child_id')}))`,
  };
  for(const [name,policy] of Object.entries(policies)) {
    if(['family_members','family_invitations'].includes(name)) {
      await tx.query(`ALTER TABLE public.${name} ENABLE ROW LEVEL SECURITY`);
      await tx.query(`CREATE POLICY family_isolation_v1 ON public.${name} USING (${policy}) WITH CHECK (${policy})`);
    } else await tx.query(`ALTER POLICY family_isolation_v1 ON public.${name} USING (${policy}) WITH CHECK ((${policy})${name==='auth_sessions' ? ` AND (child_id IS NULL OR ${visible('auth_sessions.child_id')})` : ''})`);
  }
  await tx.query('INSERT INTO schema_migrations(version) VALUES(20)');
}

export async function migrateMemberAudit(tx:Queryable) {
  if((await tx.query('SELECT version FROM schema_migrations WHERE version=21')).rows.length)return;
  await tx.query(`CREATE TABLE IF NOT EXISTS family_member_audit (
    id uuid PRIMARY KEY, family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL, target_id uuid, invitation_id uuid REFERENCES family_invitations(id),
    action text NOT NULL CHECK(action IN ('invite','cancel','join','approve','revoke')), created_at timestamptz NOT NULL,
    FOREIGN KEY(family_id,actor_id) REFERENCES family_members(family_id,id),
    FOREIGN KEY(family_id,target_id) REFERENCES family_members(family_id,id))`);

  await tx.query('ALTER TABLE public.family_member_audit ENABLE ROW LEVEL SECURITY');
  if(!(await tx.query("SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='family_member_audit' AND policyname='family_isolation_v1'")).rows.length) {
    const policy = `(current_setting('focus.mode',true)='family' AND family_id=nullif(current_setting('focus.family_id',true),'')::uuid
      AND current_setting('focus.scope',true)='parent' AND current_setting('focus.member_role',true)='owner' AND current_setting('focus.member_state',true)='active') OR
      (current_setting('focus.mode',true)='join' AND action='join' AND EXISTS(SELECT 1 FROM public.family_invitations i WHERE i.family_id=family_member_audit.family_id))`;
    await tx.query(`CREATE POLICY family_isolation_v1 ON public.family_member_audit USING (${policy}) WITH CHECK (${policy})`);
  }
  await tx.query('INSERT INTO schema_migrations(version) VALUES(21)');
}

export async function migrateMemberAuthGuard(tx:Queryable) {
  if((await tx.query('SELECT version FROM schema_migrations WHERE version=22')).rows.length)return;
  // Apply the child check to every branch, including a creator issuing access.
  // This also repairs development databases that already applied migration 20.
  const policy=(await tx.query<{qual:string}>("SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='auth_sessions' AND policyname='family_isolation_v1'")).rows[0];
  if(!policy)throw new Error('AUTH_POLICY_MISSING');
  await tx.query(`ALTER POLICY family_isolation_v1 ON public.auth_sessions WITH CHECK ((${policy.qual}) AND
    (child_id IS NULL OR EXISTS(SELECT 1 FROM public.children c WHERE c.id=auth_sessions.child_id)))`);
  await tx.query('INSERT INTO schema_migrations(version) VALUES(22)');
}

export async function migrateMemberWriteGuard(tx:Queryable) {
  if((await tx.query('SELECT version FROM schema_migrations WHERE version=23')).rows.length)return;
  const policy=(await tx.query<{qual:string}>("SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='family_members' AND policyname='family_isolation_v1'")).rows[0];
  if(!policy)throw new Error('MEMBER_POLICY_MISSING');
  await tx.query(`ALTER POLICY family_isolation_v1 ON public.family_members WITH CHECK ((${policy.qual}) AND
    (current_setting('focus.mode',true)<>'family' OR current_setting('focus.member_role',true)='owner' OR
      (role='support' AND state=current_setting('focus.member_state',true) AND
        child_ids=coalesce(nullif(current_setting('focus.child_ids',true),''),'{}')::uuid[])))`);
  await tx.query('INSERT INTO schema_migrations(version) VALUES(23)');
}

export async function migrateMemberLifeGuard(tx:Queryable) {
  if((await tx.query('SELECT version FROM schema_migrations WHERE version=24')).rows.length)return;
  const policy=`nullif(current_setting('focus.mode',true),'')='family'
    AND EXISTS(SELECT 1 FROM public.children c WHERE c.id=life_goals.child_id)
    AND (current_setting('focus.scope',true)='child' OR current_setting('focus.member_role',true)='owner')`;
  // Actions inherit this restriction through their existing visible-goal policy.
  await tx.query(`ALTER POLICY family_isolation_v1 ON public.life_goals USING (${policy}) WITH CHECK (${policy})`);
  await tx.query('INSERT INTO schema_migrations(version) VALUES(24)');
}

export async function migrateLocalConfirmationRead(tx:Queryable) {
  if((await tx.query('SELECT version FROM schema_migrations WHERE version=26')).rows.length)return;
  // An approved support parent can see only a confirmation for a child already
  // visible to that member. The existing write policy stays owner-only.
  await tx.query(`CREATE POLICY family_local_confirmation_read ON public.local_confirmations FOR SELECT USING (
    nullif(current_setting('focus.mode',true),'')='family'
    AND family_id=nullif(current_setting('focus.family_id',true),'')::uuid
    AND current_setting('focus.scope',true)='parent'
    AND current_setting('focus.member_state',true)='active'
    AND EXISTS(SELECT 1 FROM public.children c WHERE c.id=local_confirmations.child_id)
  )`);
  await tx.query('INSERT INTO schema_migrations(version) VALUES(26)');
}
