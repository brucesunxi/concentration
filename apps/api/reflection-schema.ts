import type {Database} from './database.ts';

export async function migrateReflectionSharing(db:Database){
  await db.transaction(async tx=>{
    if((await tx.query('SELECT version FROM schema_migrations WHERE version=15')).rows.length)return;
    // Keep old answers explicitly labelled as already family-visible, never as new consent.
    await tx.query("ALTER TABLE life_goals ADD COLUMN reflection_sharing text NOT NULL DEFAULT 'not-recorded'");
    await tx.query("UPDATE life_goals SET reflection_sharing='legacy-family' WHERE reflection IS NOT NULL");
    await tx.query('ALTER TABLE life_goals DROP CONSTRAINT life_goals_check');
    await tx.query(`ALTER TABLE life_goals ADD CONSTRAINT life_reflection_visibility CHECK (
      (state='reflected' AND ((reflection_sharing IN ('family','legacy-family') AND reflection IS NOT NULL) OR
        (reflection_sharing IN ('not-stored','withdrawn') AND reflection IS NULL))) OR
      (state<>'reflected' AND reflection_sharing='not-recorded' AND reflection IS NULL))`);
    await tx.query('ALTER TABLE life_goal_actions ADD COLUMN answers_removed boolean NOT NULL DEFAULT false');
    await tx.query('ALTER TABLE life_goal_actions DROP CONSTRAINT life_goal_actions_check');
    await tx.query(`ALTER TABLE life_goal_actions ADD CONSTRAINT life_action_receipt CHECK (
      (request_key IS NULL AND request_hash IS NULL) OR
      (request_key IS NOT NULL AND (request_hash IS NOT NULL OR answers_removed)))`);
    await tx.query(`ALTER TABLE life_goal_actions ADD CONSTRAINT life_redacted_answers CHECK (
      NOT answers_removed OR (request_hash IS NULL AND NOT (payload ? 'reflection')))`);
    await tx.query('INSERT INTO schema_migrations(version) VALUES(15)');
  });
}
