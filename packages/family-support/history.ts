import { z } from 'zod';
import type { LifeSpace } from './model.ts';

export const LIFE_HISTORY_VERSION = 'life-history-1' as const;
export const LIFE_HISTORY_PAGE_SIZE = 20;
export interface LifeHistorySpace extends LifeSpace {
  // goals contains the current open goal, if any, plus this closed-history page.
  history: { version: typeof LIFE_HISTORY_VERSION; pageSize: number; nextCursor: string | null };
}
export const lifeHistoryQuerySchema = z.object({ cursor: z.string().min(1).max(512).optional() }).strict();
export const lifeHistoryCursorSchema = z.object({
  v: z.literal(1), kind: z.literal('life-goals'), childId: z.string().uuid(),
  at: z.iso.datetime({ precision: 6 }), id: z.string().uuid(),
}).strict();
