import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JOURNAL_SCHEMA, WRITE_JOURNAL } from '../../packages/session-runtime/journal-sql.ts';
import { OFFLINE_SCHEMA, SAVE_OFFLINE, READ_OFFLINE, CHECKPOINT_OFFLINE } from '../../packages/session-runtime/offline-sql.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'focus-storage-full-'));
  const path = join(directory, 'journal.db');
  let db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL;' + JOURNAL_SCHEMA + OFFLINE_SCHEMA);
  const write = (events = '[]', hash = 'old-hash') => db.prepare(WRITE_JOURNAL).run(
    'session-a', 'family-a', 'child-a', events, 1000, hash, 'family-a', 'child-a', 'session-a',
  );
  const prepare = (payload = '{"version":"original"}') => db.prepare(SAVE_OFFLINE).run(
    'session-a', 'family-a', 'child-a', 0, payload, 10000, null, 'old-hash',
    0, 'session-a', 'family-a', 'child-a', '[]', 'family-a', 'child-a', 'session-a',
  );
  write(); prepare();
  const pages = db.prepare('PRAGMA page_count').get()!.page_count;
  db.exec(`PRAGMA max_page_count=${pages}`);
  return {
    get db() { return db; }, write, prepare,
    reopen() { db.close(); db = new DatabaseSync(path); },
    releaseSpace() { db.exec('PRAGMA max_page_count=10000'); },
    close() { db.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

const diskFull = (error: unknown) => typeof error === 'object' && error !== null
  && 'errcode' in error && error.errcode === 13; // SQLITE_FULL, not a mocked exception.

test('SQLite full during a native journal transaction preserves the previous recovery across reopening', () => {
  const f = fixture();
  const before = f.db.prepare(READ_OFFLINE).get();
  const largerEvents = JSON.stringify([{ payload: 'x'.repeat(128 * 1024) }]);
  try {
    f.db.exec('BEGIN');
    assert.throws(() => {
      f.write(largerEvents, 'new-hash');
      f.db.prepare(CHECKPOINT_OFFLINE).run(20000, null, 'session-a');
      f.db.prepare('UPDATE offline_resume SET journal_hash=? WHERE session_id=?').run('new-hash', 'session-a');
    }, diskFull);
    if (f.db.isTransaction) f.db.exec('ROLLBACK');
    f.reopen();
    assert.deepEqual(f.db.prepare(READ_OFFLINE).get(), before);
    assert.deepEqual({ ...f.db.prepare('SELECT events,events_hash,created_at_ms FROM journal').get() },
      { events: '[]', events_hash: 'old-hash', created_at_ms: 1000 });

    f.releaseSpace();
    f.db.exec('BEGIN');
    f.write(largerEvents, 'new-hash');
    f.db.prepare(CHECKPOINT_OFFLINE).run(20000, null, 'session-a');
    f.db.prepare('UPDATE offline_resume SET journal_hash=? WHERE session_id=?').run('new-hash', 'session-a');
    f.db.exec('COMMIT');
    f.reopen();
    const recovered = f.db.prepare(READ_OFFLINE).get()!;
    assert.equal(recovered.events, largerEvents);
    assert.equal(recovered.journal_hash, 'new-hash');
    assert.equal(recovered.highest, 20000);
  } finally { f.close(); }
});

test('SQLite full during native recovery replacement retains the old capsule and allows a later retry', () => {
  const f = fixture();
  const before = f.db.prepare(READ_OFFLINE).get();
  const largerPayload = JSON.stringify({ version: 'replacement', padding: 'x'.repeat(128 * 1024) });
  try {
    assert.throws(() => f.prepare(largerPayload), diskFull);
    f.reopen();
    assert.deepEqual(f.db.prepare(READ_OFFLINE).get(), before);
    f.releaseSpace();
    assert.equal(f.prepare(largerPayload).changes, 1);
    f.reopen();
    const recovered = f.db.prepare(READ_OFFLINE).get()!;
    assert.equal(recovered.payload, largerPayload);
    assert.equal(recovered.events, '[]');
    assert.equal(recovered.journal_hash, 'old-hash');
  } finally { f.close(); }
});
