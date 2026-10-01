import { z } from 'zod';

export const HISTORY_PAGE_SIZE = 50;
export type HistoryKind = 'sessions' | 'observations';
export interface HistoryPageInfo { nextCursor: string | null }
export interface HistoryInfo { version: 'family-history-1'; pageSize: number; sessions: HistoryPageInfo; observations: HistoryPageInfo }
export const historyQuerySchema = z.object({
  sessionsCursor: z.string().min(1).max(512).optional(),
  observationsCursor: z.string().min(1).max(512).optional(),
}).strict();
export const historyCursorSchema = z.object({
  v: z.literal(1), childId: z.string().uuid(), kind: z.enum(['sessions', 'observations']),
  // Preserve the database's microsecond precision: JS Date rounds to milliseconds.
  at: z.iso.datetime({ precision: 6 }), id: z.string().uuid(),
}).strict();
