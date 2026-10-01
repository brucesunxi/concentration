import type { Queryable } from './database.ts';

export async function migrateBilling(tx: Queryable) {
  if ((await tx.query('SELECT version FROM schema_migrations WHERE version=32')).rows.length) return;
  await tx.query(`CREATE TABLE public.billing_ledgers (
    provider text NOT NULL CHECK(provider IN ('app-store','google-play','web')),
    original_transaction_id text NOT NULL CHECK(length(original_transaction_id) BETWEEN 1 AND 200),
    family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    body jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(provider,original_transaction_id),
    UNIQUE(family_id,provider,original_transaction_id)
  )`);
  await tx.query('CREATE INDEX billing_ledgers_family ON public.billing_ledgers(family_id)');
  await tx.query(`CREATE TABLE public.billing_events (
    provider text NOT NULL CHECK(provider IN ('app-store','google-play','web')),
    event_id text NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
    original_transaction_id text NOT NULL,
    family_id uuid NOT NULL,
    fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(provider,event_id),
    FOREIGN KEY(family_id,provider,original_transaction_id)
      REFERENCES public.billing_ledgers(family_id,provider,original_transaction_id) ON DELETE CASCADE
  )`);
  await tx.query('ALTER TABLE public.billing_ledgers ENABLE ROW LEVEL SECURITY');
  await tx.query(`CREATE POLICY family_isolation_v1 ON public.billing_ledgers FOR SELECT USING (
    nullif(current_setting('focus.mode',true),'')='family'
    AND family_id=nullif(current_setting('focus.family_id',true),'')::uuid
    AND current_setting('focus.scope',true)='parent'
    AND current_setting('focus.member_state',true)='active'
  )`);
  // Raw channel references and fingerprints are operator-only evidence.
  await tx.query('ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY');
  await tx.query('INSERT INTO schema_migrations(version) VALUES(32)');
}
