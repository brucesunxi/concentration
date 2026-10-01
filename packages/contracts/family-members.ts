import { z } from 'zod';
import { newPasswordSchema } from './account-security.ts';

export const memberLoginSchema = z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).transform(x => x.toLowerCase());
export const inviteInput = z.object({ childIds: z.array(z.string().uuid()).min(1).max(3).refine(x => new Set(x).size === x.length), acknowledged: z.literal(true) }).strict();
export const joinInput = z.object({ code: z.string().regex(/^[a-f0-9]{64}$/), loginName: memberLoginSchema.refine(x => x !== 'owner'), displayName: z.string().trim().min(1).max(24), password: newPasswordSchema, acknowledgedLocalUse: z.literal(true) }).strict();
export const memberActionInput = z.object({ action: z.enum(['approve', 'revoke']), acknowledged: z.literal(true) }).strict();
export const cancelInviteInput = z.object({ acknowledged: z.literal(true) }).strict();
export type MemberRole = 'owner' | 'support';
export type MemberState = 'pending' | 'active' | 'revoked';
export interface MemberIdentity { id: string; loginName: string; displayName: string; role: MemberRole; state: MemberState }
export interface FamilyMembers {
  version: 'family-members-1'; familyId: string; viewerId: string; canManage: boolean;
  members: (MemberIdentity & { childIds: string[]; version: number; createdAt: string })[];
  invitations: { id: string; childIds: string[]; state: 'open' | 'expired' | 'accepted' | 'cancelled'; expiresAt: string }[];
}
