import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { hashObject } from '../../packages/content/index.ts';
import { verifyJournalEvents } from '../../packages/session-runtime/journal-integrity.ts';
import { JOURNAL_SCHEMA, WRITE_JOURNAL } from '../../packages/session-runtime/journal-sql.ts';
import { localRecoveryForExport } from '../../packages/session-runtime/profile-actions.ts';

test('native journal export detects changed events and distinguishes old unverified rows', async () => {
  const original = JSON.stringify([{ id: 'event-a', seq: 1 }]);
  const hash = await hashObject(JSON.parse(original));
  assert.deepEqual(await verifyJournalEvents(original, hash), { events: JSON.parse(original), sha256: hash, integrity: 'verified' });
  assert.equal((await verifyJournalEvents(original, null)).integrity, 'legacy-unverified');
  await assert.rejects(verifyJournalEvents(JSON.stringify([{ id: 'event-b', seq: 1 }]), hash), /LOCAL_EXPORT_INTEGRITY_FAILURE/);
  await assert.rejects(verifyJournalEvents('not json', hash), /LOCAL_EXPORT_UNREADABLE/);
  await assert.rejects(verifyJournalEvents('{}', null), /LOCAL_EXPORT_UNREADABLE/);
  const unavailable = await localRecoveryForExport('this-device-only', () => verifyJournalEvents('[{"id":"changed"}]', hash).then(result => [result]));
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.records, []);
});

test('native journal write updates event bytes and their hash in the same row', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(JOURNAL_SCHEMA);
    const write = (events: string, hash: string) => db.prepare(WRITE_JOURNAL).run('session-a', 'family-a', 'child-a', events, 1000, hash, 'family-a', 'child-a', 'session-a');
    write('[1]', 'first-hash');
    write('[1,2]', 'second-hash');
    assert.deepEqual({ ...db.prepare('SELECT events,events_hash FROM journal WHERE id=?').get('session-a') }, { events: '[1,2]', events_hash: 'second-hash' });
  } finally { db.close(); }
});

test('existing native journals retain their events while the new hash column starts unverified', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE journal (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, child_id TEXT NOT NULL, events TEXT NOT NULL, created_at_ms INTEGER NOT NULL)');
    db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run('session-a','family-a','child-a','[1]',1000);
    db.exec(JOURNAL_SCHEMA);
    const columns = db.prepare('PRAGMA table_info(journal)').all() as { name: string }[];
    if (!columns.some(column => column.name === 'events_hash')) db.exec('ALTER TABLE journal ADD COLUMN events_hash TEXT');
    assert.deepEqual({ ...db.prepare('SELECT events,events_hash FROM journal WHERE id=?').get('session-a') }, { events: '[1]', events_hash: null });
    db.prepare(WRITE_JOURNAL).run('session-a','family-a','child-a','[1,2]',2000,'new-hash','family-a','child-a','session-a');
    assert.deepEqual({ ...db.prepare('SELECT events,events_hash FROM journal WHERE id=?').get('session-a') }, { events: '[1,2]', events_hash: 'new-hash' });
  } finally { db.close(); }
});
