import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../apps/api/database.ts';
import { grantRuntimeRoles, verifyRuntimeRole, REQUIRED_SCHEMA_VERSION } from '../apps/api/family-isolation.ts';
import { databaseEntitlementReader, recordVerifiedBillingFact } from '../apps/api/billing-access.ts';
import { service } from '../apps/api/service.ts';
import type { Database } from '../apps/api/database.ts';
import { verifiedPostgresUrl } from '../packages/database/neon-tls.ts';

const ownerUrl = process.env.DATABASE_MIGRATION_URL, runtimeUrl = process.env.DATABASE_URL;
if (!ownerUrl || !runtimeUrl) throw new Error('BILLING_AUDIT_DATABASE_CONFIG_REQUIRED');
const owner = new URL(ownerUrl), runtime = new URL(runtimeUrl);
if (owner.hostname !== runtime.hostname || owner.pathname !== runtime.pathname || owner.username === runtime.username) throw new Error('BILLING_AUDIT_DATABASE_PAIR_INVALID');
const name = `focus_billing_audit_${randomBytes(5).toString('hex')}`;
const databaseUrl = (base: URL) => { const copy = new URL(base); copy.pathname = `/${name}`; return copy.toString(); };
const admin = new pg.Client({ connectionString: verifiedPostgresUrl(ownerUrl), connectionTimeoutMillis: 20000 });
let created = false, ownerDb: Database | undefined, runtimeDb: Database | undefined;
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  created = true;
  ownerDb = await openDatabase('memory://', databaseUrl(owner));
  await migrate(ownerDb);
  await migrate(ownerDb);
  await grantRuntimeRoles(ownerDb, runtime.username);
  const api = service(ownerDb);
  const makeFamily = async () => {
    const account = await api.setup({ name: `Synthetic-billing-audit-${randomUUID().slice(0, 8)}`, password: 'Synthetic-billing-audit-2026!', timezone: 'UTC', locale: 'en', residenceCountry: 'ZZ', acknowledgedLocalUse: true });
    return (await api.authenticate(account.value))!;
  };
  const first = await makeFamily(), second = await makeFamily();
  const source = { provider: 'app-store' as const, originalTransactionId: `synthetic-${randomUUID()}` };
  const period = { kind: 'period' as const, eventId: `synthetic-${randomUUID()}`, source, transactionId: `synthetic-${randomUUID()}`,
    productId: 'family-month', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' };
  await recordVerifiedBillingFact(ownerDb, first.family_id, period);
  await recordVerifiedBillingFact(ownerDb, first.family_id, period);
  await ownerDb.close(); ownerDb = undefined;
  runtimeDb = await openDatabase('memory://', databaseUrl(runtime));
  await verifyRuntimeRole(runtimeDb, 'family');
  const read = databaseEntitlementReader();
  const check = (familyId: string, memberId: string, lookupId: string) => runtimeDb!.context!({ mode: 'family', familyId, childId: null,
    scope: 'parent', memberId, memberRole: 'owner', memberState: 'active', childIds: [] }, () => runtimeDb!.transaction(tx => read.read(tx, lookupId, '2026-10-15T00:00:00.000Z')));
  if ((await check(first.family_id, first.member_id, first.family_id)).state !== 'active') throw new Error('BILLING_AUDIT_OWNER_READ_FAILED');
  if ((await check(second.family_id, second.member_id, first.family_id)).state !== 'free') throw new Error('BILLING_AUDIT_FAMILY_ISOLATION_FAILED');
  const forbidden = async (sql: string) => { try { await runtimeDb!.query(sql); throw new Error('BILLING_AUDIT_UNEXPECTED_ACCESS'); }
    catch (error) { if ((error as { code?: string }).code !== '42501') throw error; } };
  await forbidden("UPDATE public.billing_ledgers SET body='{}'::jsonb");
  await forbidden('SELECT * FROM public.billing_events');
  console.log(JSON.stringify({ event: 'BILLING_NEON_AUDIT', schema: REQUIRED_SCHEMA_VERSION, migratedTwice: true, ownerRead: true, crossFamilyDenied: true, runtimeWritesDenied: true }));
} finally {
  if (runtimeDb) await runtimeDb.close();
  if (ownerDb) await ownerDb.close();
  if (created) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await admin.end();
}
