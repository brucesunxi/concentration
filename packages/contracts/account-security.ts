import { z } from 'zod';

// Existing credentials retain their original byte representation. A new password
// may be a passphrase: no composition rules or trimming, and full Unicode allowed.
export const newPasswordSchema = z.string().max(128).refine(value => {
  const n = [...value].length; return n >= 15 && n <= 128;
}, 'Use 15–128 characters.');
export const confirmPasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), acknowledged: z.literal(true) }).strict();
export const changePasswordSchema = confirmPasswordSchema.extend({ newPassword: newPasswordSchema });
export interface AccountSecurity {
  version: 'account-security-1'; familyId: string; passwordChangedAt: string | null;
  memberRole?: 'owner' | 'support';
  active: { parent: { web: number; native: number }; child: { web: number; native: number } };
}
export type AccountAction = 'password' | 'signout';
