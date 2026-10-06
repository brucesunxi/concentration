import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import type { Queryable } from '../../apps/api/database.ts';
import { databaseEntitlementReader, recordVerifiedBillingFact } from '../../apps/api/billing-access.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import { createReleaseScope } from '../../apps/api/release-scope.ts';
import { grantRuntimeRoles, verifyRuntimeRole } from '../../apps/api/family-isolation.ts';
import { CONTEXT_SQL } from '../../apps/api/database-context.ts';
import type { GuardianVerification } from '../../apps/api/guardian-consent.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import { practiceStartReview } from '../../packages/contracts/practice-invitation.ts';

const start = '2026-10-01T00:00:00.000Z', end = '2026-11-01T00:00:00.000Z';
const source = { provider: 'app-store' as const, originalTransactionId: 'synthetic-purchase-1' };
const period = (eventId: string, transactionId = 'synthetic-transaction-1') => ({
  kind: 'period' as const, eventId, source, transactionId, productId: 'family-month', startsAt: start, endsAt: end,
});
const credentials = () => ({ name: 'Synthetic-billing-' + randomUUID().slice(0, 8), password: 'Synthetic-billing-2026!', timezone: 'UTC', locale: 'en' as const, residenceCountry: 'ZZ', acknowledgedLocalUse: true });

test('verified purchase facts persist with one family owner and globally unique channel events', async () => {
  const db = await openDatabase('memory://');
  try {
    await migrate(db); await migrate(db);
    const api = service(db), a = await api.setup(credentials()), b = await api.setup(credentials());
    const familyA = (await api.authenticate(a.value))!.family_id, familyB = (await api.authenticate(b.value))!.family_id;
    const first = await recordVerifiedBillingFact(db, familyA, period('event-1'));
    assert.equal(first.periods['synthetic-transaction-1'].productId, 'family-month');
    assert.deepEqual(await recordVerifiedBillingFact(db, familyA, period('event-1')), first);
    await assert.rejects(recordVerifiedBillingFact(db, familyB, period('event-2')), /BILLING_OWNER_CONFLICT/);
    await assert.rejects(recordVerifiedBillingFact(db, familyA, { ...period('event-1'), endsAt: '2026-12-01T00:00:00.000Z' }), /BILLING_EVENT_CONFLICT/);
    await assert.rejects(recordVerifiedBillingFact(db, familyA, { ...period('event-1'), source: { ...source, originalTransactionId: 'synthetic-purchase-2' } }), /BILLING_EVENT_CONFLICT/);
    assert.equal((await db.query('SELECT * FROM billing_ledgers')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM billing_events')).rows.length, 1);
    const read = databaseEntitlementReader();
    assert.equal((await read.read(db, familyA, '2026-10-15T00:00:00.000Z')).state, 'active');
    assert.equal((await read.read(db, familyB, '2026-10-15T00:00:00.000Z')).state, 'free');
    await recordVerifiedBillingFact(db, familyA, { kind: 'refund', eventId: 'refund-1', source, transactionId: 'synthetic-transaction-1' });
    assert.equal((await read.read(db, familyA, '2026-10-15T00:00:00.000Z')).state, 'refunded');
    await recordVerifiedBillingFact(db, familyA, period('renewal-1', 'synthetic-transaction-2'));
    assert.equal((await read.read(db, familyA, '2026-10-15T00:00:00.000Z')).state, 'active');
    await db.query('DELETE FROM families WHERE id=$1', [familyA]);
    assert.equal((await db.query('SELECT * FROM billing_ledgers')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM billing_events')).rows.length, 0);
  } finally { await db.close(); }
});

test('a paid release starts from persisted entitlement and a refund blocks only new sessions', async () => {
  const db = await openDatabase('memory://');
  const now = Date.parse('2026-10-15T00:00:00.000Z');
  try {
    await migrate(db);
    const notice = { version: 'family-practice-1', sha256: 'a'.repeat(64) };
    const scope = createReleaseScope({ version: '2026-10-01.paid-test', rules: [{ country: 'US', ageBand: '9-11', locale: 'en', platform: 'web', purpose: 'family-practice', access: 'family-entitlement', consentNotice: notice,
      approvals: { product: 'product/paid-test', legal: 'legal/paid-test', security: 'security/paid-test' } }] });
    let proof: GuardianVerification | null = null;
    const api = service(db, () => now, undefined, undefined, scope, { verify: async () => proof }, databaseEntitlementReader());
    const login = { ...credentials(), residenceCountry: 'US' };
    const issued = await api.setup(login), parent = (await api.authenticate(issued.value))!;
    const child = await api.addChild(parent, { alias: 'Synthetic paid child', ageBand: '9-11', locale: 'en' });
    proof = { provider: 'synthetic-verifier', reference: randomUUID(), familyId: parent.family_id, childId: child.id, ownerMemberId: parent.member_id,
      country: 'US', ageBand: '9-11', locale: 'en', purpose: 'family-practice', noticeVersion: notice.version, noticeSha256: notice.sha256,
      releaseScopeIdentity: scope.identity, adultGuardianVerified: true, purposeGranted: true, verifiedAt: now, expiresAt: now + 86400000 };
    await api.grantGuardianConsent(parent, child.id, randomUUID());
    const second = await api.addChild(parent, { alias: 'Synthetic second child', ageBand: '9-11', locale: 'en' });
    proof = { ...proof, reference: randomUUID(), childId: second.id };
    await api.grantGuardianConsent(parent, second.id, randomUUID());
    assert.equal((await api.billingStatus(parent)).state, 'free');
    const input = { task: 'search' as const, deviceId: randomUUID(), environment: TEST_ENVIRONMENT,
      practiceReview: practiceStartReview(await api.practiceLimits(parent, child.id), 'en') }, key = randomUUID();
    await assert.rejects(api.start(parent, child.id, input, key), (error: unknown) => error instanceof ApiError && error.code === 'ENTITLEMENT_REQUIRED');
    await recordVerifiedBillingFact(db, parent.family_id, period('paid-event'));
    const paidStatus = await api.billingStatus(parent);
    assert.equal(paidStatus.state, 'active');
    assert.equal(paidStatus.validUntil, end);
    assert.equal(JSON.stringify(paidStatus).includes(source.originalTransactionId), false);
    const started = await api.start(parent, child.id, input, key);
    await recordVerifiedBillingFact(db, parent.family_id, { kind: 'refund', eventId: 'paid-refund', source, transactionId: 'synthetic-transaction-1' });
    const renewedParent = (await api.authenticate((await api.login({ name: login.name, password: login.password })).value))!;
    assert.equal((await api.billingStatus(renewedParent)).state, 'refunded');
    assert.equal((await api.start(renewedParent, child.id, input, key)).session.id, started.session.id);
    const anotherParent = (await api.authenticate((await api.login({ name: login.name, password: login.password })).value))!;
    await assert.rejects(api.start(anotherParent, second.id, { ...input, deviceId: randomUUID() }, randomUUID()),
      (error: unknown) => error instanceof ApiError && error.code === 'ENTITLEMENT_REQUIRED');
    assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM sessions WHERE child_id=$1', [child.id])).rows[0].n, 1);
  } finally { await db.close(); }
});

test('the family runtime role can read only its own entitlement and cannot issue purchase facts', async () => {
  const db = await openDatabase('memory://');
  try {
    await migrate(db);
    const api = service(db), a = await api.setup(credentials()), b = await api.setup(credentials());
    const familyA = (await api.authenticate(a.value))!.family_id, familyB = (await api.authenticate(b.value))!.family_id;
    await recordVerifiedBillingFact(db, familyA, period('role-event'));
    await db.query('CREATE ROLE focus_billing_test');
    await grantRuntimeRoles(db, 'focus_billing_test');
    await db.query('SET ROLE focus_billing_test');
    try {
      await verifyRuntimeRole(db, 'family');
      const context = (familyId: string) => ['family', familyId, '', 'parent', '', '', '', 'owner', 'active', '{}', '', ''];
      const read = databaseEntitlementReader();
      assert.equal((await db.transaction(async tx => {
        await tx.query(CONTEXT_SQL, context(familyA));
        return read.read(tx, familyA, '2026-10-15T00:00:00.000Z');
      })).state, 'active');
      assert.equal((await db.transaction(async tx => {
        await tx.query(CONTEXT_SQL, context(familyB));
        return read.read(tx, familyA, '2026-10-15T00:00:00.000Z');
      })).state, 'free');
      await assert.rejects(db.query("UPDATE public.billing_ledgers SET body='{}'::jsonb"), /permission denied/);
      await assert.rejects(db.query('SELECT * FROM public.billing_events'), /permission denied/);
    } finally { await db.query('RESET ROLE'); }
  } finally { await db.close(); }
});

test('runtime verification shares one transaction and still rejects a missing billing grant', async () => {
  const db = await openDatabase('memory://');
  try {
    await migrate(db);
    await db.query('CREATE ROLE focus_verification_test');
    await grantRuntimeRoles(db, 'focus_verification_test');
    await db.query('SET ROLE focus_verification_test');
    let transactions = 0, checks = 0;
    const scoped = {
      query: async () => { throw new Error('CHECK_ESCAPED_TRANSACTION'); },
      transaction: <T>(fn: (tx: Queryable) => Promise<T>) => {
        transactions++;
        return db.transaction(tx => fn({ query: <R>(sql: string, params?: unknown[]) => {
          checks++;
          return tx.query<R>(sql, params);
        } }));
      },
    };
    try {
      await verifyRuntimeRole(scoped, 'family');
      assert.equal(transactions, 1);
      assert.ok(checks >= 15);
      await db.transaction(tx => verifyRuntimeRole(tx, 'family'));
    } finally { await db.query('RESET ROLE'); }
    await db.query('REVOKE SELECT ON public.billing_ledgers FROM focus_verification_test');
    await db.query('SET ROLE focus_verification_test');
    try {
      await assert.rejects(verifyRuntimeRole(scoped, 'family'), /DATABASE_BILLING_READ_REQUIRED/);
      assert.equal(transactions, 2);
    } finally { await db.query('RESET ROLE'); }
  } finally { await db.close(); }
});
