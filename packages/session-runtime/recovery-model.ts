import type { TaskId, Environment } from '../task-engine/index.ts';
export interface RecoveryItem {
  id: string; task: TaskId; createdAt: string; environment: Environment | null; sameDevice: boolean;
  historyOnly: boolean; finalized: boolean; receivedEvents: number; etag: string;
  recordUntil: string | null; uploadUntil: string | null; handoverAvailable: boolean;
  mayResume?: boolean;
}
export interface RecoverySpace { childId: string; collectionActive: boolean; marketOpen?: boolean; active: RecoveryItem | null; history: RecoveryItem[]; budgetDay: string; availableMs: number; timezone: string }
export interface HandoverReceipt { childId: string; sessionId: string; closedAt: string; replayed: boolean }
