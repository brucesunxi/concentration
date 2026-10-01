import type { Queryable } from './database.ts';
import type { Entitlement } from '../../packages/billing/index.ts';
import { createHash } from 'node:crypto';
import { applyVerifiedBillingFact, billingLedgerSchema, BillingConflict, emptyBillingLedger, entitlementAt, verifiedBillingFactSchema } from '../../packages/billing/index.ts';
import type { Database } from './database.ts';
import type { BillingLedger } from '../../packages/billing/index.ts';

/** Read a server-verified family entitlement from the same transaction that creates a session. */
export interface FamilyEntitlementReader {
  read(tx: Queryable, familyId: string, at: string): Promise<Entitlement>;
}

interface LedgerRow { provider: string; original_transaction_id: string; family_id: string; body: unknown }
const fingerprint = (fact: unknown) => createHash('sha256').update(JSON.stringify(fact)).digest('hex');

export function databaseEntitlementReader(): FamilyEntitlementReader {
  return { async read(tx, familyId, at) {
    const rows = (await tx.query<LedgerRow>('SELECT provider,original_transaction_id,family_id,body FROM public.billing_ledgers WHERE family_id=$1', [familyId])).rows;
    const ledgers = rows.map(row => {
      const ledger = billingLedgerSchema.parse(row.body);
      if (row.family_id !== familyId || ledger.source.provider !== row.provider || ledger.source.originalTransactionId !== row.original_transaction_id) throw new BillingConflict('BILLING_LEDGER_CORRUPT');
      return ledger;
    });
    return entitlementAt(ledgers, at);
  } };
}

/** The verified channel adapter calls this; no family HTTP route can submit facts. */
export async function recordVerifiedBillingFact(db: Database, familyId: string, raw: unknown): Promise<BillingLedger> {
  const fact = verifiedBillingFactSchema.parse(raw), source = fact.source;
  const hash = fingerprint(fact);
  return db.transaction(async tx => {
    const owner = (await tx.query<{ id: string }>('SELECT id FROM public.families WHERE id=$1 FOR UPDATE', [familyId])).rows[0];
    if (!owner) throw new BillingConflict('BILLING_FAMILY_NOT_FOUND');
    await tx.query(`INSERT INTO public.billing_ledgers(provider,original_transaction_id,family_id,body)
      VALUES($1,$2,$3,$4) ON CONFLICT (provider,original_transaction_id) DO NOTHING`,
      [source.provider, source.originalTransactionId, familyId, emptyBillingLedger(source)]);
    const row = (await tx.query<LedgerRow>(`SELECT provider,original_transaction_id,family_id,body FROM public.billing_ledgers
      WHERE provider=$1 AND original_transaction_id=$2 FOR UPDATE`, [source.provider, source.originalTransactionId])).rows[0];
    if (!row || row.family_id !== familyId) throw new BillingConflict('BILLING_OWNER_CONFLICT');
    const current = billingLedgerSchema.parse(row.body);
    if (current.source.provider !== source.provider || current.source.originalTransactionId !== source.originalTransactionId) throw new BillingConflict('BILLING_LEDGER_CORRUPT');
    const inserted = (await tx.query<{ event_id: string }>(`INSERT INTO public.billing_events(provider,event_id,original_transaction_id,family_id,fingerprint)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT (provider,event_id) DO NOTHING RETURNING event_id`,
      [source.provider, fact.eventId, source.originalTransactionId, familyId, hash])).rows[0];
    if (!inserted) {
      const existing = (await tx.query<{ original_transaction_id: string; family_id: string; fingerprint: string }>(
        'SELECT original_transaction_id,family_id,fingerprint FROM public.billing_events WHERE provider=$1 AND event_id=$2',
        [source.provider, fact.eventId])).rows[0];
      if (!existing || existing.original_transaction_id !== source.originalTransactionId || existing.family_id !== familyId || existing.fingerprint !== hash) throw new BillingConflict('BILLING_EVENT_CONFLICT');
      return current;
    }
    const next = applyVerifiedBillingFact(current, fact);
    await tx.query(`UPDATE public.billing_ledgers SET body=$4,updated_at=now()
      WHERE provider=$1 AND original_transaction_id=$2 AND family_id=$3`, [source.provider, source.originalTransactionId, familyId, next]);
    return next;
  });
}
