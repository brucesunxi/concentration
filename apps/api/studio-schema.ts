import type { Database } from './database.ts';
export async function migrateStudio(db:Database){
  await db.transaction(async tx=>{
    if((await tx.query('SELECT version FROM schema_migrations WHERE version=11')).rows.length)return;
    const statements=[
      `CREATE TABLE studio_users(id uuid PRIMARY KEY,login text UNIQUE NOT NULL,name text NOT NULL,role text NOT NULL CHECK(role IN ('editor','method-reviewer','language-reviewer','publisher')),password_hash text NOT NULL,enabled boolean NOT NULL DEFAULT true,last_totp_step bigint NOT NULL DEFAULT -1,failed_count int NOT NULL DEFAULT 0,locked_until timestamptz,created_at timestamptz NOT NULL)`,
      `CREATE TABLE studio_sessions(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES studio_users(id),csrf text NOT NULL,expires_at timestamptz NOT NULL,mfa_at timestamptz NOT NULL)`,
      `CREATE TABLE studio_drafts(id uuid PRIMARY KEY,author uuid NOT NULL REFERENCES studio_users(id),source_hash text NOT NULL REFERENCES content_releases(hash),pack jsonb NOT NULL,version int NOT NULL DEFAULT 1,round int NOT NULL DEFAULT 1,state text NOT NULL CHECK(state IN ('draft','in-review','changes-requested','ready','published','recalled')),candidate_hash text,published_hash text REFERENCES content_releases(hash),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL)`,
      `CREATE UNIQUE INDEX studio_pack_version ON studio_drafts((pack->>'id'),(pack->>'version'))`,
      `CREATE TABLE studio_reviews(id uuid PRIMARY KEY,draft_id uuid NOT NULL REFERENCES studio_drafts(id),round int NOT NULL,reviewer uuid NOT NULL REFERENCES studio_users(id),role text NOT NULL CHECK(role IN ('method-reviewer','language-reviewer')),decision text NOT NULL CHECK(decision IN ('approve','changes')),pack_hash text NOT NULL,note text NOT NULL,checks jsonb NOT NULL,approval jsonb,created_at timestamptz NOT NULL,UNIQUE(draft_id,round,role),UNIQUE(draft_id,round,reviewer))`,
      `CREATE TABLE studio_audit(id uuid PRIMARY KEY,draft_id uuid REFERENCES studio_drafts(id),actor uuid NOT NULL REFERENCES studio_users(id),action text NOT NULL,at timestamptz NOT NULL,detail jsonb NOT NULL)`,
      `CREATE TABLE studio_commands(actor uuid NOT NULL REFERENCES studio_users(id),request_key uuid NOT NULL,request_hash text NOT NULL,draft_id uuid NOT NULL REFERENCES studio_drafts(id),PRIMARY KEY(actor,request_key))`,
      `CREATE TABLE content_channels(slot text PRIMARY KEY,hash text NOT NULL REFERENCES content_releases(hash))`,
      `CREATE INDEX studio_audit_history ON studio_audit(draft_id,at,id)`,
      `INSERT INTO schema_migrations(version) VALUES(11)`,
    ];for(const statement of statements)await tx.query(statement);
  });
  await db.transaction(async tx=>{
    if((await tx.query('SELECT version FROM schema_migrations WHERE version=12')).rows.length)return;
    await tx.query('CREATE TABLE studio_write_guard(id int PRIMARY KEY CHECK(id=1))');
    await tx.query('INSERT INTO studio_write_guard VALUES(1)');
    await tx.query('INSERT INTO schema_migrations(version) VALUES(12)');
  });
  await db.transaction(async tx=>{
    if((await tx.query('SELECT version FROM schema_migrations WHERE version=13')).rows.length)return;
    await tx.query(`CREATE TABLE studio_previews(id uuid PRIMARY KEY,actor uuid NOT NULL REFERENCES studio_users(id),draft_id uuid NOT NULL REFERENCES studio_drafts(id),round int NOT NULL,pack_hash text NOT NULL,pack jsonb NOT NULL,plan jsonb NOT NULL,plan_hash text NOT NULL,budget_ms int NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,request_key uuid NOT NULL,request_hash text NOT NULL,receipt jsonb,events jsonb,UNIQUE(actor,request_key))`);
    await tx.query('ALTER TABLE studio_reviews ADD COLUMN preview_id uuid REFERENCES studio_previews(id)');
    await tx.query('CREATE INDEX studio_preview_history ON studio_previews(draft_id,created_at DESC)');
    await tx.query('INSERT INTO schema_migrations(version) VALUES(13)');
  });

  await db.transaction(async tx=>{
    if((await tx.query('SELECT version FROM schema_migrations WHERE version=14')).rows.length)return;
    await tx.query(`CREATE TABLE content_media_sources(hash text PRIMARY KEY,bytes int NOT NULL CHECK(bytes>0),body bytea NOT NULL,CHECK(octet_length(body)=bytes))`);
    await tx.query(`CREATE TABLE content_media_objects(hash text PRIMARY KEY,mime text NOT NULL CHECK(mime IN ('image/png','audio/mpeg')),bytes int NOT NULL CHECK(bytes>0),body bytea NOT NULL,CHECK(octet_length(body)=bytes))`);
    await tx.query(`CREATE TABLE studio_media(id uuid PRIMARY KEY,actor uuid NOT NULL REFERENCES studio_users(id),metadata jsonb NOT NULL,source_hash text NOT NULL,source_bytes int NOT NULL,state text NOT NULL CHECK(state IN ('awaiting','ready','rejected')),asset_hash text REFERENCES content_media_objects(hash),asset_bytes int,inspection jsonb,rejection text,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,request_key uuid NOT NULL,request_hash text NOT NULL,UNIQUE(actor,request_key),CHECK((state='ready')=(asset_hash IS NOT NULL)))`);
    await tx.query('CREATE INDEX studio_media_created ON studio_media(created_at DESC,id DESC)');
    await tx.query('INSERT INTO schema_migrations(version) VALUES(14)');
  });

}
