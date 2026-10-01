import type { Queryable } from './database.ts';
import type { Entitlement } from '../../packages/billing/index.ts';

/** Read a server-verified family entitlement from the same transaction that creates a session. */
export interface FamilyEntitlementReader {
  read(tx: Queryable, familyId: string, at: string): Promise<Entitlement>;
}
