import type { Queryable } from './database.ts';
import type { Report } from '../../packages/contracts/models.ts';
import { HISTORY_PAGE_SIZE, historyCursorSchema } from '../../packages/contracts/history.ts';
import type { HistoryKind, HistoryPageInfo } from '../../packages/contracts/history.ts';

export class InvalidHistoryCursor extends Error {}
export async function historyPage<K extends HistoryKind>(db: Queryable, childId: string, kind: K, cursor?: string): Promise<{ rows: Report[K]; page: HistoryPageInfo }> {
  let boundary: { at: string; id: string } | undefined;
  if (cursor) {
    try {
      if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const value = historyCursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
      if (value.childId !== childId || value.kind !== kind) throw new Error();
      boundary = value;
    } catch { throw new InvalidHistoryCursor(); }
  }
  // The cursor is a position, never an authorization token. The caller must
  // authenticate the current parent and child before either query.
  const columns = kind === 'sessions' ? 'id,state,result' : 'id,task,context,prompts,child_choice';
  const found = await db.query<Report[K][number]>(`SELECT ${columns},
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
    FROM ${kind} WHERE child_id=$1 ${kind === 'sessions' ? 'AND result IS NOT NULL' : ''}
    ${boundary ? 'AND (created_at,id)<($2::timestamptz,$3::uuid)' : ''}
    ORDER BY ${kind}.created_at DESC,${kind}.id DESC LIMIT ${HISTORY_PAGE_SIZE + 1}`, boundary ? [childId,boundary.at,boundary.id] : [childId]);
  const rows = found.rows.slice(0,HISTORY_PAGE_SIZE), last = rows.at(-1);
  const nextCursor = found.rows.length > HISTORY_PAGE_SIZE && last ? Buffer.from(JSON.stringify({v:1,childId,kind,at:last.created_at,id:last.id})).toString('base64url') : null;
  return { rows: rows as Report[K], page: {nextCursor} };
}
