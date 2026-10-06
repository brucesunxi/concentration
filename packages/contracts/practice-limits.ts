import { z } from 'zod';
import type { AgeBand } from '../task-engine/index.ts';

export const practiceLimitInput = z.object({ minutes: z.number().int().min(0).max(12), effectiveDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), acknowledged: z.literal(true) }).strict();
export const pausePracticeTodayInput = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), acknowledged: z.literal(true) }).strict();
export interface PracticeLimits {
  version: 'practice-limits-1'; childId: string; ageBand: AgeBand; settingsVersion: number;
  canEdit: boolean; collectionActive: boolean; timezone: string; day: string; nextDay: string; generatedAt: string;
  maximumMinutes: number; currentMinutes: number; next: { minutes: number; day: string } | null;
  confirmedMs: number; reservedMs: number; availableMs: number;
  status: 'available' | 'reserved' | 'daily-limit' | 'paused' | 'collection-stopped';
}
