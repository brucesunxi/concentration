import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { JOURNAL_SCHEMA, WRITE_JOURNAL, BLOCK_PROFILE, DELETE_CHILD_JOURNALS } from '../../packages/session-runtime/journal-sql.ts';

test('SQLite ownership guards and revocation markers prevent late writes from recreating deleted records', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(JOURNAL_SCHEMA);
    const save = (id: string, family: string, child: string) => db.prepare(WRITE_JOURNAL).run(id, family, child, '[]', 1000, family, child, id).changes;
    assert.equal(save('a', 'family-a', 'child-a'), 1);
    assert.equal(save('a', 'family-b', 'child-b'), 0);
    assert.equal(save('b', 'family-a', 'child-b'), 1);
    assert.equal(save('c', 'family-b', 'child-c'), 1);
    db.exec('BEGIN');
    db.prepare(BLOCK_PROFILE).run('family-a', 'child-a');
    db.prepare(DELETE_CHILD_JOURNALS).run('family-a', 'child-a');
    db.exec('COMMIT');
    assert.equal(save('a', 'family-a', 'child-a'), 0);
    assert.equal(save('late-new-id', 'family-a', 'child-a'), 0);
    assert.equal(save('b', 'family-a', 'child-b'), 1);
    assert.equal(save('c', 'family-b', 'child-c'), 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM journal').get()?.n, 2);
    db.exec(JOURNAL_SCHEMA);
    assert.equal(save('after-reopen-schema', 'family-a', 'child-a'), 0);
  } finally { db.close(); }
});
