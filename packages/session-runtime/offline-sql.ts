export const OFFLINE_SCHEMA = `
CREATE TABLE IF NOT EXISTS offline_generation (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT OR IGNORE INTO offline_generation VALUES(1,0);
CREATE TABLE IF NOT EXISTS offline_resume (id INTEGER PRIMARY KEY CHECK(id=1), session_id TEXT NOT NULL, family_id TEXT NOT NULL, child_id TEXT NOT NULL, generation INTEGER NOT NULL, payload TEXT NOT NULL, highest REAL NOT NULL, fault TEXT, journal_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS offline_closed (session_id TEXT PRIMARY KEY);
`;
export const INVALIDATE_OFFLINE = 'UPDATE offline_generation SET version=version+1 WHERE id=1';
// A late preparation cannot overwrite another identity or resurrect a confirmed session.
export const SAVE_OFFLINE = `INSERT INTO offline_resume(id,session_id,family_id,child_id,generation,payload,highest,fault,journal_hash)
SELECT 1,?,?,?,?,?,?,?,? WHERE (SELECT version FROM offline_generation WHERE id=1)=?
AND EXISTS(SELECT 1 FROM journal WHERE id=? AND family_id=? AND child_id=? AND events=?)
AND NOT EXISTS(SELECT 1 FROM blocked_profiles WHERE family_id=? AND child_id=?)
AND NOT EXISTS(SELECT 1 FROM offline_closed WHERE session_id=?)
ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id,family_id=excluded.family_id,child_id=excluded.child_id,generation=excluded.generation,payload=excluded.payload,
highest=CASE WHEN offline_resume.session_id=excluded.session_id THEN max(offline_resume.highest,excluded.highest) ELSE excluded.highest END,
fault=CASE WHEN offline_resume.session_id=excluded.session_id THEN coalesce(offline_resume.fault,excluded.fault) ELSE excluded.fault END,
journal_hash=excluded.journal_hash`;
export const CHECKPOINT_OFFLINE = `UPDATE offline_resume SET highest=max(highest,?),fault=coalesce(fault,?) WHERE session_id=? AND generation=(SELECT version FROM offline_generation WHERE id=1)`;
export const READ_OFFLINE = `SELECT r.payload,r.highest,r.fault,r.journal_hash,j.events FROM offline_resume r JOIN journal j ON j.id=r.session_id AND j.family_id=r.family_id AND j.child_id=r.child_id
WHERE r.generation=(SELECT version FROM offline_generation WHERE id=1) AND NOT EXISTS(SELECT 1 FROM blocked_profiles b WHERE b.family_id=r.family_id AND b.child_id=r.child_id) AND NOT EXISTS(SELECT 1 FROM offline_closed c WHERE c.session_id=r.session_id)`;
