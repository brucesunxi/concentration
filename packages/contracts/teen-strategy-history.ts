import { z } from 'zod';
import type { TaskId } from '../task-engine/index.ts';

export const TEEN_STRATEGY_PAGE_SIZE = 20;
export type TeenStrategyStatus = 'completed' | 'stopped' | 'previous-device';
export interface TeenStrategyEntry {
  id: string;
  task: TaskId;
  createdAt: string;
  status: TeenStrategyStatus;
}
export interface TeenStrategyHistory {
  version: 'teen-strategy-history-1';
  childId: string;
  pageSize: number;
  items: TeenStrategyEntry[];
  nextCursor: string | null;
}
export const teenStrategyQuerySchema = z.object({ cursor: z.string().min(1).max(512).optional() }).strict();
export const teenStrategyCursorSchema = z.object({
  v: z.literal(1), childId: z.string().uuid(), kind: z.literal('teen-strategy'),
  at: z.iso.datetime({ precision: 6 }), id: z.string().uuid(),
}).strict();
