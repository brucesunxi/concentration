import { z } from 'zod';
import type { FamilyContentInfo } from './publication.ts';
import type { AgeBand, Locale, TaskId } from '../task-engine/index.ts';

export const supportSchema = z.enum(['together', 'ask-first', 'space']);
export type Support = z.infer<typeof supportSchema>;
export const createGoalSchema = z.object({ intent: z.enum(['suggest', 'choose']), templateId: z.enum(['find', 'turns', 'steps', 'return']), support: supportSchema, contentHash:z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const reflectionSchema = z.object({ outcome: z.enum(['tried', 'partly', 'not-today']), helpful: z.enum(['yes', 'no', 'unsure']), next: z.enum(['same', 'smaller', 'different', 'rest']) }).strict();
export type Reflection = z.infer<typeof reflectionSchema>;
export const goalActionSchema = z.union([
  z.object({ action: z.literal('accept'), support: supportSchema }).strict(),
  z.object({ action: z.literal('decline') }).strict(),
  z.object({ action: z.literal('stop') }).strict(),
  z.object({ action: z.literal('reflect'), sharing:z.literal('family'), reflection: reflectionSchema }).strict(),
  z.object({ action: z.literal('reflect'), sharing:z.literal('none') }).strict(),
  z.object({ action: z.literal('unshare') }).strict(),
]);
export type GoalInput = z.infer<typeof createGoalSchema>;
/** Preselects a related off-screen activity without creating a goal for the child. */
export const lifeTemplateForTask: Readonly<Record<TaskId, GoalInput['templateId']>> = Object.freeze({ search:'find', stop:'turns', memory:'steps', sustain:'return' });
export type GoalAction = z.infer<typeof goalActionSchema>;
export type Words = Record<Locale, string>;
export type GoalState = 'proposed' | 'active' | 'reflected' | 'declined' | 'stopped';
export interface LifeTemplate { id: GoalInput['templateId']; version: string; review: 'unreviewed'|'approved'; ageBand: AgeBand; task: TaskId; title: Words; steps: Words[]; parentTip: Words }
export type ReflectionSharing='not-recorded'|'legacy-family'|'family'|'not-stored'|'withdrawn';
export interface LifeGoal { contentHash:string|null; id: string; childId: string; version: number; state: GoalState; template: LifeTemplate; support: Support; createdBy: 'parent' | 'child'; reflection: Reflection | null; reflectionSharing:ReflectionSharing; createdAt: string; updatedAt: string; closedReason: 'withdrawn' | null }
export const REFLECTION_SHARING_POLICY='reflection-sharing-1' as const;
export interface LifeSpace { contentPolicy:'family-content-1';content:FamilyContentInfo;releases:Record<string,FamilyContentInfo>;childId: string; role: 'parent' | 'child'; sharingPolicy:typeof REFLECTION_SHARING_POLICY; collectionActive: boolean; templates: LifeTemplate[]; goals: LifeGoal[]; total: number }
export interface GoalReply { goal: LifeGoal; replayed: boolean }
export const openGoal = (goal: LifeGoal) => goal.state === 'proposed' || goal.state === 'active';
export const sharedReflection=(goal:LifeGoal)=>goal.reflectionSharing==='family'||goal.reflectionSharing==='legacy-family';
// Never put unshared on-screen answers in a network request or a retry fingerprint.
export const reflectionAction=(share:boolean,reflection:Reflection):GoalAction=>share?{action:'reflect',sharing:'family',reflection}:{action:'reflect',sharing:'none'};

export const goalContentState=(goal:LifeGoal,space:LifeSpace)=>goal.contentHash?space.releases[goal.contentHash]?.state??'unavailable':'legacy';
export const usableGoalContent=(goal:LifeGoal,space:LifeSpace)=>['available','legacy'].includes(goalContentState(goal,space));
