import type { FamilyContentInfo } from './publication.ts';
import type { AgeBand, TaskId } from '../task-engine/index.ts';
import type { courseUnit } from '../task-engine/index.ts';
import type { GoalInput, Words } from './model.ts';

export const PARENT_GUIDE_VERSION = 'parent-guide-2-preview';
export type GuideStage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export interface ParentLesson {
  stage: GuideStage;
  title: Words;
  purpose: Words;
  invitation: Words;
  example: Words;
  steps: Words[];
  fallback: Words;
  notice: Words;
  templateId: GoalInput['templateId'] | null;
  task: TaskId | null;
}
export interface ParentGuide {
  childId: string;
  ageBand: AgeBand;
  version: typeof PARENT_GUIDE_VERSION;
  review: 'unreviewed'|'approved';
  content:FamilyContentInfo;
  collectionActive: boolean;
  course: ReturnType<typeof courseUnit>;
  recommended: GuideStage;
  lessons: ParentLesson[];
}
