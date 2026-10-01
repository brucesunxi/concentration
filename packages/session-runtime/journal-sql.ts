export const JOURNAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS journal (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, child_id TEXT NOT NULL, events TEXT NOT NULL, created_at_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS blocked_profiles (family_id TEXT NOT NULL, child_id TEXT NOT NULL, PRIMARY KEY(family_id,child_id));
CREATE TABLE IF NOT EXISTS offline_closed (session_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS journal_retention_clock (id INTEGER PRIMARY KEY CHECK(id=1), highest_ms INTEGER NOT NULL);
INSERT OR IGNORE INTO journal_retention_clock(id,highest_ms) VALUES(1,0);
CREATE INDEX IF NOT EXISTS journal_owner ON journal(family_id,child_id);
`;
export const WRITE_JOURNAL = `INSERT INTO journal (id,family_id,child_id,events,created_at_ms)
SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM blocked_profiles WHERE family_id=? AND child_id=?)
AND NOT EXISTS (SELECT 1 FROM offline_closed WHERE session_id=?)
ON CONFLICT(id) DO UPDATE SET events=excluded.events
WHERE journal.family_id=excluded.family_id AND journal.child_id=excluded.child_id`;
export const BLOCK_PROFILE = 'INSERT INTO blocked_profiles(family_id,child_id) VALUES(?,?) ON CONFLICT DO NOTHING';
export const DELETE_CHILD_JOURNALS = 'DELETE FROM journal WHERE family_id=? AND child_id=?';
export const SEAL_EXPIRED_JOURNALS = 'INSERT OR IGNORE INTO offline_closed(session_id) SELECT id FROM journal WHERE coalesce(created_at_ms,0)<=?';
export const DROP_EXPIRED_OFFLINE = 'DELETE FROM offline_resume WHERE session_id IN (SELECT id FROM journal WHERE coalesce(created_at_ms,0)<=?)';
export const DROP_EXPIRED_JOURNALS = 'DELETE FROM journal WHERE coalesce(created_at_ms,0)<=?';
