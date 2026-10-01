import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import { databaseReady } from '../../apps/api/readiness.ts';
import { REQUIRED_SCHEMA_VERSION } from '../../apps/api/family-isolation.ts';

test('readiness checks the live schema and fails closed when the database cannot answer',async()=>{
  const db=await openDatabase('memory://');
  try {
    assert.equal(await databaseReady(db),false);
    await migrate(db);
    assert.equal(await databaseReady(db),true);
    await db.query('DELETE FROM schema_migrations WHERE version=$1',[REQUIRED_SCHEMA_VERSION]);
    assert.equal(await databaseReady(db),false);
  } finally { await db.close(); }
  assert.equal(await databaseReady(db),false);
});
