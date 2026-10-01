import type { ContentPack } from './index.ts';
import type { Plan } from '../task-engine/index.ts';

/** Staff task observations, never a child session or an efficacy assessment. */
export interface PreviewReceipt {
  id:string; complete:boolean; packHash:string; planHash:string; eventHash:string;
  completedAt:string; formalTrials:number; independentTrials:number;
  interruptions:number; invalidations:number; activeMs:number;
}
export interface CandidatePreview {
  id:string; actorId:string; draftId:string; round:number; packHash:string;
  pack:ContentPack; plan:Plan; planHash:string; budgetMs:number;
  createdAt:string; expiresAt:string; receipt:PreviewReceipt|null;
}
