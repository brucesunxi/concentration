import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { JOURNAL_SCHEMA, WRITE_JOURNAL, BLOCK_PROFILE, SEAL_EXPIRED_JOURNALS, DROP_EXPIRED_OFFLINE, DROP_EXPIRED_JOURNALS } from '../../packages/session-runtime/journal-sql.ts';
import { OFFLINE_SCHEMA, SAVE_OFFLINE, INVALIDATE_OFFLINE, READ_OFFLINE, CHECKPOINT_OFFLINE } from '../../packages/session-runtime/offline-sql.ts';

function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(JOURNAL_SCHEMA + OFFLINE_SCHEMA);
  const journal = (id = 'session-a', events = '[]', family = 'family-a', child = 'child-a') => db.prepare(WRITE_JOURNAL).run(id, family, child, events, 1000, family, child, id);
  const save = (generation = 0, id = 'session-a', events = '[]', family = 'family-a', child = 'child-a') => db.prepare(SAVE_OFFLINE).run(id, family, child, generation, '{}', 10000, null, 'hash-a', generation, id, family, child, events, family, child, id).changes;
  return { db, journal, save };
}

test('offline preparation requires the exact durable event snapshot and the original journal owner', () => {
  const {db, journal, save} = fixture();
  try {
    assert.equal(save(), 0); journal();
    assert.equal(save(0, 'session-a', '[]', 'family-b', 'child-a'), 0);
    assert.equal(save(0, 'session-a', '[]', 'family-a', 'child-b'), 0);
    assert.equal(save(), 1); journal('session-a', '[1]');
    assert.equal(save(), 0); assert.equal(save(0, 'session-a', '[1]'), 1);
  } finally {db.close();}
});

test('a family transition invalidates an already stored entry and rejects late preparation without deleting its journal', () => {
  const {db, journal, save} = fixture();
  try {
    journal(); assert.equal(save(), 1); assert.ok(db.prepare(READ_OFFLINE).get());
    db.exec(INVALIDATE_OFFLINE);
    assert.equal(db.prepare(READ_OFFLINE).get(), undefined); assert.equal(save(), 0);
    assert.equal(db.prepare('SELECT count(*) n FROM journal').get()?.n, 1);
    journal('session-b', '[]', 'family-b', 'child-b');
    assert.equal(save(1, 'session-b', '[]', 'family-b', 'child-b'), 1);
    assert.equal(save(), 0); assert.equal(db.prepare('SELECT family_id FROM offline_resume').get()?.family_id, 'family-b');
  } finally {db.close();}
});

test('stopped profiles and closed sessions cannot reappear through a late initialization', () => {
  const {db, journal, save} = fixture();
  try {
    journal(); assert.equal(save(), 1);
    db.prepare(BLOCK_PROFILE).run('family-a', 'child-a');
    assert.equal(db.prepare(READ_OFFLINE).get(), undefined); assert.equal(save(), 0);
    journal('session-b', '[]', 'family-b', 'child-b');
    assert.equal(save(0, 'session-b', '[]', 'family-b', 'child-b'), 1);
    db.prepare('INSERT INTO offline_closed(session_id) VALUES(?)').run('session-b');
    assert.equal(db.prepare(READ_OFFLINE).get(), undefined);
    assert.equal(save(0, 'session-b', '[]', 'family-b', 'child-b'), 0);
    db.exec(OFFLINE_SCHEMA);
    assert.equal(save(0, 'session-b', '[]', 'family-b', 'child-b'), 0);
  } finally {db.close();}
});

test('checkpoint high water and faults survive delayed checkpoints and same-session preparation', () => {
  const {db, journal, save} = fixture();
  try {
    journal(); save();
    db.prepare(CHECKPOINT_OFFLINE).run(20000, 'SESSION_CLOCK_CHANGED', 'session-a');
    db.prepare(CHECKPOINT_OFFLINE).run(15000, null, 'session-a'); save();
    const row = db.prepare(READ_OFFLINE).get()!;
    assert.equal(row.highest, 20000); assert.equal(row.fault, 'SESSION_CLOCK_CHANGED');
    db.exec(INVALIDATE_OFFLINE);
    assert.equal(db.prepare(CHECKPOINT_OFFLINE).run(25000, null, 'session-a').changes, 0);
  } finally {db.close();}
});

test('a checkpoint storage failure rolls back the journal write as part of the same transaction', () => {
  const {db, journal, save} = fixture();
  try {
    journal(); save();
    db.exec("CREATE TRIGGER fail_checkpoint BEFORE UPDATE OF highest ON offline_resume BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END;");
    db.exec('BEGIN');
    assert.throws(() => { journal('session-a', '[1]'); db.prepare(CHECKPOINT_OFFLINE).run(20000, null, 'session-a'); }, /synthetic disk failure/);
    db.exec('ROLLBACK');
    const row = db.prepare(READ_OFFLINE).get()!;
    assert.equal(row.events, '[]'); assert.equal(row.highest, 10000); assert.equal(row.journal_hash, 'hash-a');
  } finally {db.close();}
});

test('native expiry seals old sessions and removes their prepared recovery without touching newer journals',()=>{
  const {db,journal,save}=fixture();
  try{
    journal('old');assert.equal(save(0,'old'),1);
    journal('new','[]','family-a','child-a');
    db.prepare('UPDATE journal SET created_at_ms=100000 WHERE id=?').run('new');
    db.exec('BEGIN');
    for(const sql of [SEAL_EXPIRED_JOURNALS,DROP_EXPIRED_OFFLINE,DROP_EXPIRED_JOURNALS])db.prepare(sql).run(1000);
    db.exec('COMMIT');
    assert.equal(db.prepare(READ_OFFLINE).get(),undefined);
    assert.equal(db.prepare('SELECT count(*) AS n FROM journal').get()?.n,1);
    assert.equal(journal('old').changes,0);
    assert.equal(journal('new').changes,1);
    assert.equal(db.prepare('SELECT created_at_ms FROM journal WHERE id=?').get('new')?.created_at_ms,100000);
  }finally{db.close();}
});
