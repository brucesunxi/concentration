import { z } from 'zod';
import { newPasswordSchema } from './account-security.ts';
import { memberLoginSchema } from './family-members.ts';
export const ageBandSchema = z.enum(['6-8', '9-11', '12-14', '15-17']);
export const localeSchema = z.enum(['zh-CN', 'en']);
export const residenceCountrySchema = z.string().regex(/^[A-Z]{2}$/);
export const taskSchema = z.enum(['search', 'stop', 'memory', 'sustain']);
export const setupSchema = z.object({
  name: z.string().trim().min(1).max(40), password: newPasswordSchema,
  timezone: z.string().max(80).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }),
  locale: localeSchema, residenceCountry: residenceCountrySchema.default('ZZ'),
  registrationPlatform: z.enum(['web', 'ios', 'android']).optional(), acknowledgedLocalUse: z.literal(true).optional(),
}).strict();
export const loginSchema = z.object({ name: z.string().trim().min(1).max(40), password: z.string().min(1).max(128), memberLogin: memberLoginSchema.optional() }).strict();
export const profileSchema = z.object({ alias: z.string().trim().min(1).max(24), ageBand: ageBandSchema, locale: localeSchema, localConfirmation: z.literal(true).optional() }).strict();
export const ageReviewRequestSchema = z.object({ targetAgeBand: ageBandSchema.or(z.literal('18+')), acknowledged: z.literal(true) }).strict();
export const ageReviewApplySchema = z.object({ acknowledged: z.literal(true), localConfirmation: z.literal(true).optional(), resolveExpiredUploads: z.literal(true).optional() }).strict();
export const environmentSchema = z.object({ platform: z.enum(['web', 'ios', 'android']), deviceClass: z.enum(['desktop', 'tablet', 'phone']), input: z.enum(['pointer', 'touch', 'keyboard', 'assistive']), modality: z.literal('visual') }).strict();
export const startSchema = z.object({ task: taskSchema, deviceId: z.string().uuid(), environment: environmentSchema }).strict();
export const recoverySchema = z.object({ deviceId: z.string().uuid() }).strict();
export const handoverSchema = recoverySchema.extend({ acknowledged: z.literal(true) }).strict();
const common = { id: z.string().uuid(), seq: z.number().int().min(1).max(3000), at: z.number().min(0).max(86400000) };
export const eventSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('present'), trialId: z.string().max(100), presentation: z.object({ frameDeltaMs: z.number().min(0).max(10000), assetsReady: z.boolean(), method: z.enum(['raf-pair', 'native-frame']) }).strict().optional() }).strict(),
  z.object({ ...common, type: z.literal('choose'), index: z.number().int().min(0).max(99), input: z.enum(['pointer', 'touch', 'keyboard', 'assistive']).optional() }).strict(),
  z.object({ ...common, type: z.literal('undo') }).strict(),
  z.object({ ...common, type: z.literal('encode_end') }).strict(),
  z.object({ ...common, type: z.literal('help') }).strict(),
  z.object({ ...common, type: z.literal('submit') }).strict(),
  z.object({ ...common, type: z.literal('interrupt'), reason: z.enum(['background', 'pause', 'asset_failure', 'reload', 'render_failure', 'timer_late', 'input_changed']) }).strict(),
  z.object({ ...common, type: z.literal('end'), reason: z.enum(['completed', 'child_stopped', 'time_limit']) }).strict(),
]);
export const batchSchema = z.object({ events: z.array(eventSchema).min(1).max(100) }).strict();
export const finalizeSchema = z.object({ lastSeq: z.number().int().min(1).max(3000) }).strict();
export const observationSchema = z.object({ task: taskSchema, context: z.enum(['packing', 'tidying', 'reading', 'project']), prompts: z.number().int().min(0).max(20), childChoice: z.boolean() }).strict();
export const weeklyQuerySchema = z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();
export const emptyActionSchema = z.object({}).strict();
