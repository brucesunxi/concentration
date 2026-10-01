import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase,migrate} from '../../apps/api/database.ts';
import {migrateReflectionSharing} from '../../apps/api/reflection-schema.ts';
import {lifeTemplates} from '../../packages/family-support/catalogue.ts';

test('migration labels previously family-visible reflections without inventing consent or losing answers, and reruns preserve later choices',async()=>{
 const db=await openDatabase('memory://');try{
  await migrate(db);
  // Restore only migration 7's original constraints on a fresh fixture, then insert legacy rows.
  await db.query('ALTER TABLE life_goals DROP CONSTRAINT life_reflection_visibility, DROP COLUMN reflection_sharing');
  await db.query("ALTER TABLE life_goals ADD CONSTRAINT life_goals_check CHECK((state='reflected')=(reflection IS NOT NULL))");
  await db.query('ALTER TABLE life_goal_actions DROP CONSTRAINT life_action_receipt, DROP CONSTRAINT life_redacted_answers, DROP COLUMN answers_removed');
  await db.query('ALTER TABLE life_goal_actions ADD CONSTRAINT life_goal_actions_check CHECK((request_key IS NULL)=(request_hash IS NULL))');
  await db.query('DELETE FROM schema_migrations WHERE version=15');
  const family=randomUUID(),child=randomUUID(),goal=randomUUID(),reflection={outcome:'partly',helpful:'unsure',next:'rest'};
  await db.query('INSERT INTO families(id,name,login_name,password_hash,timezone,locale) VALUES($1,$2,$2,$3,$4,$5)',[family,'Migration fixture','fixture-only','UTC','en']);
  await db.query('INSERT INTO children(id,family_id,alias,age_band,locale) VALUES($1,$2,$3,$4,$5)',[child,family,'Synthetic child','15-17','en']);
  await db.query("INSERT INTO life_goals(id,child_id,version,state,template,support,created_by,reflection,created_at,updated_at,request_key,request_hash) VALUES($1,$2,2,'reflected',$3,'space','child',$4,now(),now(),$5,$6)",[goal,child,lifeTemplates('15-17')[0],reflection,randomUUID(),'fixture-create-hash']);
  await db.query("INSERT INTO life_goal_actions(id,goal_id,version,actor_scope,payload,request_key,request_hash,created_at) VALUES($1,$2,2,'child',$3,$4,$5,now())",[randomUUID(),goal,{action:'reflect',reflection},randomUUID(),'fixture-answer-hash']);
  await migrateReflectionSharing(db);
  let row=(await db.query<{reflection_sharing:string;reflection:unknown}>('SELECT reflection_sharing,reflection FROM life_goals WHERE id=$1',[goal])).rows[0];
  assert.equal(row.reflection_sharing,'legacy-family');assert.deepEqual(row.reflection,reflection);
  await db.query("UPDATE life_goals SET reflection=NULL,reflection_sharing='withdrawn' WHERE id=$1",[goal]);
  await migrateReflectionSharing(db);row=(await db.query<{reflection_sharing:string;reflection:unknown}>('SELECT reflection_sharing,reflection FROM life_goals WHERE id=$1',[goal])).rows[0];
  assert.equal(row.reflection_sharing,'withdrawn');assert.equal(row.reflection,null);
  assert.equal((await db.query('SELECT version FROM schema_migrations WHERE version=15')).rows.length,1);
 }finally{await db.close();}
});
