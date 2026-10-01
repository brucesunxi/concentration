import type { Queryable } from './database.ts';
export async function migrateFamilyContent(tx:Queryable){
  if((await tx.query('SELECT version FROM schema_migrations WHERE version=25')).rows.length)return;
  await tx.query(`CREATE TABLE family_content_releases(hash text PRIMARY KEY CHECK(length(hash)=64),pack_id text NOT NULL,version text NOT NULL,envelope jsonb NOT NULL,state text NOT NULL CHECK(state IN ('active','recalled')),recalled_at timestamptz,reason text,UNIQUE(pack_id,version))`);
  await tx.query('CREATE TABLE family_content_channels(age_band text PRIMARY KEY,hash text NOT NULL REFERENCES family_content_releases(hash))');
  await tx.query('ALTER TABLE life_goals ADD COLUMN content_hash text REFERENCES family_content_releases(hash)');
  await tx.query(`CREATE TABLE support_drafts(id uuid PRIMARY KEY,author uuid NOT NULL REFERENCES studio_users(id),source_hash text NOT NULL REFERENCES family_content_releases(hash),pack jsonb NOT NULL,version int NOT NULL DEFAULT 1,round int NOT NULL DEFAULT 1,state text NOT NULL CHECK(state IN ('draft','in-review','changes-requested','ready','published','recalled')),candidate_hash text,published_hash text REFERENCES family_content_releases(hash),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL)`);
  await tx.query(`CREATE TABLE support_reviews(id uuid PRIMARY KEY,draft_id uuid NOT NULL REFERENCES support_drafts(id),round int NOT NULL,reviewer uuid NOT NULL REFERENCES studio_users(id),scope text NOT NULL CHECK(scope IN ('method','language:zh-CN','language:en')),decision text NOT NULL CHECK(decision IN ('approve','changes')),pack_hash text NOT NULL,note text NOT NULL,checks jsonb NOT NULL,approval jsonb,created_at timestamptz NOT NULL,UNIQUE(draft_id,round,reviewer),UNIQUE(draft_id,round,scope))`);
  await tx.query('CREATE TABLE support_commands(actor uuid NOT NULL REFERENCES studio_users(id),request_key uuid NOT NULL,request_hash text NOT NULL,draft_id uuid NOT NULL REFERENCES support_drafts(id),PRIMARY KEY(actor,request_key))');
  await tx.query('CREATE TABLE support_audit(id uuid PRIMARY KEY,draft_id uuid NOT NULL REFERENCES support_drafts(id),actor uuid NOT NULL REFERENCES studio_users(id),action text NOT NULL,at timestamptz NOT NULL,detail jsonb NOT NULL)');
  await tx.query(`CREATE FUNCTION public.focus_locked_family_content(release_hash text) RETURNS TABLE(envelope jsonb,state text)
    LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT r.envelope,r.state FROM public.family_content_releases r WHERE r.hash=release_hash FOR SHARE $$`);
  await tx.query('REVOKE ALL ON FUNCTION public.focus_locked_family_content(text) FROM PUBLIC');
  await tx.query('INSERT INTO schema_migrations(version) VALUES(25)');
}
