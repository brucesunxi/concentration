import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytesAsync } from 'expo-crypto';
import { File } from 'expo-file-system';
import type { JournalPort } from '../../../packages/session-runtime/index.ts';
import type { EngineEvent } from '../../../packages/task-engine/index.ts';
import { JOURNAL_SCHEMA, WRITE_JOURNAL, BLOCK_PROFILE, DELETE_CHILD_JOURNALS, SEAL_EXPIRED_JOURNALS, DROP_EXPIRED_OFFLINE, DROP_EXPIRED_JOURNALS } from '../../../packages/session-runtime/journal-sql.ts';
import { SerialQueue } from '../../../packages/session-runtime/serial-queue.ts';
import { OFFLINE_SCHEMA, INVALIDATE_OFFLINE, SAVE_OFFLINE, CHECKPOINT_OFFLINE, READ_OFFLINE } from '../../../packages/session-runtime/offline-sql.ts';
import type { ClockCheckpoint } from '../../../packages/session-runtime/authorization.ts';
import { offlineCapsuleSchema, OfflinePreparationChanged } from '../../../packages/session-runtime/offline-session.ts';
import type { OfflineCapsule, OfflineSaved } from '../../../packages/session-runtime/offline-session.ts';
import { hashObject } from '../../../packages/content/index.ts';
import { nativeVerifier } from '../../../packages/content/native-verifier.ts';
import { UNSYNCED_RETENTION_MS, UNSYNCED_WARNING_MS, retentionClock } from '../../../packages/session-runtime/journal-retention.ts';
import { nativeDatabaseDirectoryUri } from '../../../packages/session-runtime/native-database-path.ts';

let pending: Promise<SQLite.SQLiteDatabase> | undefined;
const operations = new SerialQueue();
const withDatabase = <T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>) => operations.run(async () => fn(await open()));
async function open() {
  return pending ??= (async () => {
    let stage = 'read-key';
    try {
      const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
      let key = await SecureStore.getItemAsync('focus.local.journal-key.v1', options);
      if (!key) {
        stage = 'check-existing-file';
        if (new File(nativeDatabaseDirectoryUri(SQLite.defaultDatabaseDirectory), 'focus-family.db').exists) throw new Error('Journal key is unavailable; existing data was preserved');
        stage = 'write-key';
        key = [...await getRandomBytesAsync(32)].map(v => v.toString(16).padStart(2, '0')).join('');
        await SecureStore.setItemAsync('focus.local.journal-key.v1', key, options);
      }
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid journal key');
      stage = 'open-database';
      const db = await SQLite.openDatabaseAsync('focus-family.db');
      try {
        stage = 'set-cipher-key';
        await db.execAsync(`PRAGMA key = "x'${key}'";`);
        stage = 'check-cipher';
        const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
        if (!cipher?.cipher_version) throw new Error('An encrypted native development build is required');
        stage = 'create-schema';
        await db.execAsync('PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;' + JOURNAL_SCHEMA + OFFLINE_SCHEMA);
        stage = 'migrate-journal';
        const columns=await db.getAllAsync<{name:string}>('PRAGMA table_info(journal)');
        if(!columns.some(column=>column.name==='created_at_ms'))await db.withTransactionAsync(async()=>{
          await db.execAsync('ALTER TABLE journal ADD COLUMN created_at_ms INTEGER');
          // Old records have no original creation time. Begin their window at upgrade.
          await db.runAsync('UPDATE journal SET created_at_ms=? WHERE created_at_ms IS NULL',Date.now());
        });
        return db;
      } catch (e) { await db.closeAsync(); throw e; }
    } catch (error) {
      // Stage and type are diagnostic only; never log the key, SQL or family data.
      console.error('NATIVE_JOURNAL_OPEN_FAILED', stage, error instanceof Error ? error.name : 'UnknownError');
      throw error;
    }
  })().catch(e => { pending = undefined; throw e; });
}
async function pruneExpiredJournals() {
  let effectiveNow=0;
  await withDatabase(db=>db.withTransactionAsync(async()=>{
    const row=await db.getFirstAsync<{highest_ms:number}>('SELECT highest_ms FROM journal_retention_clock WHERE id=1');
    effectiveNow=retentionClock(Date.now(),row?.highest_ms);
    await db.runAsync('UPDATE journal_retention_clock SET highest_ms=? WHERE id=1',effectiveNow);
    const cutoff=effectiveNow-UNSYNCED_RETENTION_MS;
    await db.runAsync(SEAL_EXPIRED_JOURNALS,cutoff);
    await db.runAsync(DROP_EXPIRED_OFFLINE,cutoff);
    await db.runAsync(DROP_EXPIRED_JOURNALS,cutoff);
  }));
  return effectiveNow;
}
export async function expiringLocalJournals(familyId:string,childId:string) {
  const effectiveNow=await pruneExpiredJournals();
  const cutoff=effectiveNow-UNSYNCED_RETENTION_MS+UNSYNCED_WARNING_MS;
  const row=await withDatabase(db=>db.getFirstAsync<{n:number}>('SELECT count(*) AS n FROM journal WHERE family_id=? AND child_id=? AND created_at_ms<=?',familyId,childId,cutoff));
  return row?.n??0;
}
export function journalFor(familyId: string, childId: string, sessionId: string, checkpoint?: () => ClockCheckpoint): JournalPort {
  return {
    async load() {
      await pruneExpiredJournals();
      const row = await withDatabase(db => db.getFirstAsync<{ family_id: string; child_id: string; events: string }>('SELECT family_id,child_id,events FROM journal WHERE id=?', sessionId));
      if (row && (row.family_id !== familyId || row.child_id !== childId)) throw new Error('Journal owner mismatch');
      return row ? JSON.parse(row.events) as EngineEvent[] : [];
    },
    async save(events) {
      const effectiveNow=await pruneExpiredJournals();
      const point=checkpoint?.(),hash=await hashObject(events,nativeVerifier);
      await withDatabase(db => db.withTransactionAsync(async () => {
        const saved=await db.runAsync(WRITE_JOURNAL,sessionId,familyId,childId,JSON.stringify(events),effectiveNow,familyId,childId,sessionId);
        if(saved.changes!==1)throw new Error('Journal owner mismatch or collection stopped');
        if(point)await db.runAsync(CHECKPOINT_OFFLINE,point.highest,point.fault,sessionId);
        await db.runAsync('UPDATE offline_resume SET journal_hash=? WHERE session_id=?',hash,sessionId);
      }));
    },
    async remove() { await withDatabase(db => db.withTransactionAsync(async()=>{
      await db.runAsync('INSERT OR IGNORE INTO offline_closed(session_id) VALUES(?)',sessionId);
      await db.runAsync('DELETE FROM offline_resume WHERE session_id=? AND family_id=? AND child_id=?',sessionId,familyId,childId);
      await db.runAsync('DELETE FROM journal WHERE id=? AND family_id=? AND child_id=?',sessionId,familyId,childId);
    })); },
  };
}
export async function removeChildJournals(familyId: string, childId: string) {
  // Expo's exclusive helper opens another connection without this PRAGMA key.
  // Serialize every access instead, so the transaction uses the keyed connection.
  await withDatabase(db => db.withTransactionAsync(async () => {
    await db.runAsync(BLOCK_PROFILE, familyId, childId);
    await db.runAsync(DELETE_CHILD_JOURNALS, familyId, childId);
    await db.runAsync('DELETE FROM offline_resume WHERE family_id=? AND child_id=?',familyId,childId);
  }));
}
export async function readChildJournals(familyId: string, childId: string) {
  await pruneExpiredJournals();
  const rows = await withDatabase(db => db.getAllAsync<{ id: string; events: string }>('SELECT id,events FROM journal WHERE family_id=? AND child_id=? ORDER BY id', familyId, childId));
  return rows.map(row => {
    const events = JSON.parse(row.events) as EngineEvent[];
    if (!Array.isArray(events)) throw new Error('LOCAL_EXPORT_UNREADABLE');
    return { sessionId: row.id, events };
  });
}
/** Only call with the complete, server-authenticated parent family profile list. */
export async function reconcileFamilyJournals(familyId: string, children: { id: string; consentActive: boolean }[]) {
  await pruneExpiredJournals();
  const allowed = new Set(children.filter(child => child.consentActive).map(child => child.id));
  await withDatabase(db => db.withTransactionAsync(async () => {
    const rows = await db.getAllAsync<{ child_id: string }>('SELECT DISTINCT child_id FROM journal WHERE family_id=?', familyId);
    const candidates = new Set([...rows.map(row => row.child_id), ...children.filter(c => !c.consentActive).map(c => c.id)]);
    for (const childId of candidates) if (!allowed.has(childId)) {
      await db.runAsync(BLOCK_PROFILE, familyId, childId);
      await db.runAsync(DELETE_CHILD_JOURNALS, familyId, childId);
      await db.runAsync('DELETE FROM offline_resume WHERE family_id=? AND child_id=?',familyId,childId);
    }
  }));
}

export async function offlineGeneration() { await pruneExpiredJournals();return (await withDatabase(db=>db.getFirstAsync<{version:number}>('SELECT version FROM offline_generation WHERE id=1')))!.version; }
export async function invalidateOffline() {
  await withDatabase(db=>db.withTransactionAsync(async()=>{await db.runAsync(INVALIDATE_OFFLINE);await db.runAsync('DELETE FROM offline_resume');}));
}
export async function dropOfflineSession(sessionId:string, preventPreparation = false) {
  await withDatabase(db=>db.withTransactionAsync(async()=>{
    if(preventPreparation)await db.runAsync('INSERT OR IGNORE INTO offline_closed(session_id) VALUES(?)',sessionId);
    await db.runAsync('DELETE FROM offline_resume WHERE session_id=?',sessionId);
  }));
}
export async function saveOfflineSession(raw:OfflineCapsule,generation:number,point:ClockCheckpoint,events:EngineEvent[]) {
  await pruneExpiredJournals();
  const capsule=offlineCapsuleSchema.parse(raw),id=capsule.session.id,child=capsule.session.child_id,family=capsule.familyId;
  const hash=await hashObject(events,nativeVerifier),json=JSON.stringify(events);
  const result=await withDatabase(db=>db.runAsync(SAVE_OFFLINE,id,family,child,generation,JSON.stringify(capsule),point.highest,point.fault,hash,generation,id,family,child,json,family,child,id));
  if(result.changes!==1)throw new OfflinePreparationChanged();
}
export async function checkpointOffline(sessionId:string,point:ClockCheckpoint) { await pruneExpiredJournals();await withDatabase(db=>db.runAsync(CHECKPOINT_OFFLINE,point.highest,point.fault,sessionId)); }
export async function readOfflineSession():Promise<(OfflineSaved & {events:EngineEvent[]})|null> {
  await pruneExpiredJournals();
  const row=await withDatabase(db=>db.getFirstAsync<{payload:string;highest:number;fault:string|null;journal_hash:string;events:string}>(READ_OFFLINE));
  if(!row)return null;
  return {capsule:offlineCapsuleSchema.parse(JSON.parse(row.payload)),checkpoint:{highest:row.highest,fault:row.fault},journalHash:row.journal_hash,events:JSON.parse(row.events)};
}
