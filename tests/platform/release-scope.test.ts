import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import { service, ApiError } from '../../apps/api/service.ts';
import { createReleaseScope, localReleaseScope } from '../../apps/api/release-scope.ts';
import type { ReleaseManifest } from '../../apps/api/release-scope.ts';
import type { GuardianVerification } from '../../apps/api/guardian-consent.ts';
import { collectionStatusAllowsPractice, collectionStatusCopy } from '../../packages/contracts/collection-status.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';

const approvals = { product: 'product/ticket-1234', legal: 'legal/ticket-1234', security: 'security/ticket-1234' };
const consentNotice = { version: 'family-practice-1', sha256: 'a'.repeat(64) };
const approved: ReleaseManifest = { version: '2026-10-01.us-pilot', rules: [{ country: 'US', ageBand: '9-11', locale: 'en', platform: 'web', purpose: 'family-practice', consentNotice, approvals }] };
const setup = (country: string, locale: 'en' | 'zh-CN' = 'en') => ({ name: 'Synthetic-' + randomUUID().slice(0, 8), password: 'Synthetic-release-2026!', timezone: 'UTC', locale, residenceCountry: country, acknowledgedLocalUse: true });
const denied = (error: unknown) => error instanceof ApiError && error.code === 'MARKET_NOT_OPEN';

test('older family services cannot make a newer client claim collection is allowed', () => {
  const oldResponse = { consentActive: true } as { consentActive: boolean; collectionStatus?: undefined };
  assert.match(collectionStatusCopy(oldResponse.collectionStatus, 'en').detail, /cannot be confirmed/);
  assert.match(collectionStatusCopy(oldResponse.collectionStatus, 'zh-CN').detail, /无法确认/);
  assert.equal(collectionStatusAllowsPractice(oldResponse.collectionStatus, oldResponse.consentActive), false);
  assert.equal(collectionStatusAllowsPractice('guardian-verified', false), false);
  assert.equal(collectionStatusAllowsPractice('guardian-verified', true), true);
});

test('release matrix defaults closed and requires three independent approval references', () => {
  const scope = createReleaseScope({ version: '2026-10-01.empty', rules: [] });
  assert.equal(scope.permitsRegistration('US', 'en', ['web']), false);
  assert.equal(scope.permitsChild('US', '9-11', 'en'), false);
  assert.equal(scope.permits('US', '9-11', 'en', 'web'), false);
  assert.throws(() => createReleaseScope({ ...approved, rules: [{ ...approved.rules[0], country: 'ZZ' }] }), /RELEASE_RULE_INVALID/);
  assert.throws(() => createReleaseScope({ ...approved, rules: [{ ...approved.rules[0], approvals: { ...approvals, security: approvals.legal } }] }), /RELEASE_APPROVALS_REQUIRED/);
  assert.throws(() => createReleaseScope({ ...approved, rules: [{ ...approved.rules[0], consentNotice: { version: 'test', sha256: 'bad' } }] }), /CONSENT_NOTICE_REQUIRED/);
  assert.throws(() => createReleaseScope({ ...approved, rules: [approved.rules[0], { ...approved.rules[0], platform: 'ios', consentNotice: { ...consentNotice, sha256: 'b'.repeat(64) } }] }), /CONSENT_NOTICE_CONFLICT/);
  assert.throws(() => createReleaseScope({ ...approved, rules: [approved.rules[0], approved.rules[0]] }), /RELEASE_RULE_DUPLICATE/);
  const open = createReleaseScope(approved);
  const twoRows: ReleaseManifest = { ...approved, rules: [approved.rules[0], { ...approved.rules[0], country: 'CA' }] };
  const sameRows = createReleaseScope({ ...twoRows, rules: [...twoRows.rules].reverse() });
  const altered = createReleaseScope({ ...approved, rules: [{ ...approved.rules[0], approvals: { ...approvals, legal: 'legal/ticket-5678' } }] });
  assert.equal(createReleaseScope(twoRows).identity, sameRows.identity);
  assert.notEqual(open.identity, altered.identity);
  assert.equal(open.permitsRegistration('US', 'en', ['web']), true);
  assert.equal(open.permitsRegistration('US', 'zh-CN', ['web']), false);
  assert.equal(open.permits('US', '9-11', 'en', 'web'), true);
  assert.equal(open.permits('US', '9-11', 'en', 'ios'), false);
  assert.equal(open.permits('CA', '9-11', 'en', 'web'), false);
  assert.equal(localReleaseScope.permits('US', '9-11', 'en', 'web'), false);
});

test('registration, child creation and new practice enforce the same server matrix', async () => {
  const db = await openDatabase('memory://');
  try {
    await migrate(db); await migrate(db);
    let proof: GuardianVerification | null = null;
    const open = service(db, Date.now, undefined, undefined, createReleaseScope(approved), { verify: async () => proof });
    await assert.rejects(open.setup(setup('CA')), denied);
    await assert.rejects(open.setup(setup('US', 'zh-CN')), denied);
    await assert.rejects(open.setup({ ...setup('US'), registrationPlatform: 'ios' }, 'native'), denied);
    await assert.rejects(open.setup(setup('US'), 'native'), (error: unknown) => error instanceof ApiError && error.code === 'REGISTRATION_PLATFORM_REQUIRED');
    await assert.rejects(open.setup({ ...setup('US'), registrationPlatform: 'ios' }, 'web'), (error: unknown) => error instanceof ApiError && error.code === 'REGISTRATION_PLATFORM_MISMATCH');
    const credentials = setup('US');
    const registration = await open.setup({...credentials,acknowledgedLocalUse:undefined});
    const parent = (await open.authenticate(registration.value))!;
    assert.equal((await open.me(parent)).family.residenceCountry, 'US');
    await assert.rejects(open.addChild(parent, { alias: 'Synthetic child', ageBand: '6-8', locale: 'en', localConfirmation: true }), denied);
    await assert.rejects(open.addChild(parent, { alias: 'Synthetic child', ageBand: '9-11', locale: 'zh-CN', localConfirmation: true }), denied);
    const child = await open.addChild(parent, { alias: 'Synthetic child', ageBand: '9-11', locale: 'en', localConfirmation: true });
    assert.equal(child.localPreviewConfirmation,false);
    assert.equal(child.verifiedGuardianConsent,false);
    assert.equal(child.collectionStatus,'guardian-verification-required');
    await assert.rejects(open.start(parent, child.id, { task: 'search', deviceId: randomUUID(), environment: TEST_ENVIRONMENT }, randomUUID()), (error: unknown) => error instanceof ApiError && error.code==='CONSENT_REVOKED');
    proof={ provider:'synthetic-verifier',reference:randomUUID(),familyId:parent.family_id,childId:child.id,ownerMemberId:parent.member_id,
      country:'US',ageBand:'9-11',locale:'en',purpose:'family-practice',noticeVersion:consentNotice.version,noticeSha256:consentNotice.sha256,
      releaseScopeIdentity:createReleaseScope(approved).identity,adultGuardianVerified:true,purposeGranted:true,verifiedAt:Date.now(),expiresAt:Date.now()+86400000 };
    assert.equal((await open.grantGuardianConsent(parent,child.id,randomUUID())).verifiedGuardianConsent,true);
    assert.equal((await open.me(parent)).children[0].collectionStatus,'guardian-verified');
    const closed = service(db, Date.now, undefined, undefined, createReleaseScope({ version: '2026-10-01.closed', rules: [] }));
    await assert.rejects(closed.start(parent, child.id, { task: 'search', deviceId: randomUUID(), environment: TEST_ENVIRONMENT }, randomUUID()), denied);
    const started = await open.start(parent, child.id, { task: 'search', deviceId: randomUUID(), environment: TEST_ENVIRONMENT }, randomUUID());
    assert.equal(started.session.plan.ageBand, '9-11');
    const childPrincipal = (await open.authenticate(started.auth.value))!;
    const sameMarketDifferentApproval = service(db, Date.now, undefined, undefined, createReleaseScope({ ...approved, rules: [{ ...approved.rules[0], approvals: { ...approvals, legal: 'legal/ticket-5678' } }] }));
    const changed = (error: unknown) => error instanceof ApiError && error.code === 'MARKET_SCOPE_CHANGED';
    await assert.rejects(sameMarketDifferentApproval.sessionStatus(childPrincipal, started.session.id), changed);
    await assert.rejects(sameMarketDifferentApproval.active(childPrincipal), changed);
    await assert.rejects(sameMarketDifferentApproval.append(childPrincipal, started.session.id, { events: [{ id: randomUUID(), seq: 1, at: 0, type: 'help' }] }), changed);
    await assert.rejects(sameMarketDifferentApproval.finalize(childPrincipal, started.session.id, { lastSeq: 1 }), changed);
    const newParent = (await sameMarketDifferentApproval.authenticate((await sameMarketDifferentApproval.login({ name: credentials.name, password: credentials.password })).value))!;
    const recovery = await sameMarketDifferentApproval.recoverySpace(newParent, child.id, { deviceId: started.session.device_id });
    assert.equal(recovery.marketOpen, true);
    assert.equal(recovery.active?.mayResume, false);
    assert.equal(recovery.active?.handoverAvailable, true);
    const closedRecovery = await closed.recoverySpace(newParent, child.id, { deviceId: started.session.device_id });
    assert.equal(closedRecovery.marketOpen, false);
    assert.equal(closedRecovery.availableMs, 0);
    await assert.rejects(sameMarketDifferentApproval.recover(newParent, child.id, started.session.id, { deviceId: started.session.device_id }), changed);
    await assert.rejects(sameMarketDifferentApproval.start(newParent, child.id, { task: 'search', deviceId: randomUUID(), environment: TEST_ENVIRONMENT }, randomUUID()), changed);
    const legacy = await db.query<{ residence_country: string }>('SELECT residence_country FROM families WHERE id=$1', [parent.family_id]);
    assert.equal(legacy.rows[0].residence_country, 'US');
  } finally { await db.close(); }
});

test('local preview accepts only its synthetic region', async () => {
  const db = await openDatabase('memory://');
  try {
    await migrate(db);
    const api = service(db);
    await assert.rejects(api.setup(setup('US')), denied);
    await assert.rejects(api.setup({...setup('ZZ'),acknowledgedLocalUse:undefined}), (error:unknown)=>error instanceof ApiError && error.code==='LOCAL_USE_ACK_REQUIRED');
    const account = await api.setup(setup('ZZ'));
    const parent=(await api.authenticate(account.value))!;
    assert.equal((await api.me(parent)).family.residenceCountry, 'ZZ');
    assert.equal((await api.addChild(parent,{alias:'Synthetic preview',ageBand:'6-8',locale:'en',localConfirmation:true})).collectionStatus,'local-preview-enabled');
  } finally { await db.close(); }
});

test('verified consent is bound to guardian, child, notice, release scope and expiry', async () => {
  const db = await openDatabase('memory://');
  let clock = Date.now();
  try {
    await migrate(db);
    const scope = createReleaseScope(approved);
    let proof: GuardianVerification | null = null;
    const verifier = { verify: async (_token: string) => proof };
    const api = service(db, () => clock, undefined, undefined, scope, verifier);
    const credentials = setup('US');
    const issued = await api.setup(credentials);
    let parent = (await api.authenticate(issued.value))!;
    const c = await api.addChild(parent,{alias:'Synthetic child',ageBand:'9-11',locale:'en',localConfirmation:true});
    const noVerifier = service(db,()=>clock,undefined,undefined,scope);
    const code = (name:string) => (error:unknown) => error instanceof ApiError && error.code===name;
    await assert.rejects(noVerifier.grantGuardianConsent(parent,c.id,randomUUID()),code('GUARDIAN_VERIFICATION_UNAVAILABLE'));
    proof = {provider:'synthetic-verifier',reference:randomUUID(),familyId:parent.family_id,childId:c.id,ownerMemberId:parent.member_id,
      country:'US',ageBand:'9-11',locale:'en',purpose:'family-practice',noticeVersion:consentNotice.version,noticeSha256:consentNotice.sha256,
      releaseScopeIdentity:scope.identity,adultGuardianVerified:true,purposeGranted:true,verifiedAt:clock,expiresAt:clock+3600000};
    const valid = proof;
    for (const invalid of [
      {...valid,familyId:randomUUID()},
      {...valid,childId:randomUUID()},
      {...valid,ownerMemberId:randomUUID()},
      {...valid,country:'CA'},
      {...valid,locale:'zh-CN'},
      {...valid,noticeSha256:'b'.repeat(64)},
      {...valid,releaseScopeIdentity:'another-release'},
      {...valid,expiresAt:clock-1},
      {...valid,verifiedAt:clock+1},
      {...valid,adultGuardianVerified:false},
      {...valid,purposeGranted:false},
    ]) {
      proof = invalid as GuardianVerification;
      await assert.rejects(api.grantGuardianConsent(parent,c.id,randomUUID()),code('GUARDIAN_VERIFICATION_REJECTED'));
    }
    assert.equal((await db.query('SELECT * FROM guardian_consents')).rows.length,0);
    proof=valid;
    assert.equal((await api.grantGuardianConsent(parent,c.id,randomUUID())).verifiedGuardianConsent,true);
    await assert.rejects(api.grantGuardianConsent(parent,c.id,randomUUID()),code('VERIFICATION_REPLAYED'));
    const records=(await db.query<Record<string,unknown>>('SELECT * FROM guardian_consents')).rows;
    assert.equal(records.length,1);
    assert.equal(records[0].reference,undefined);
    assert.equal(records[0].verification_ref_hash===valid.reference,false);
    assert.equal((await api.me(parent)).children[0].consentActive,true);
    const changed = service(db,()=>clock,undefined,undefined,createReleaseScope({...approved,rules:[{...approved.rules[0],consentNotice:{...consentNotice,sha256:'b'.repeat(64)}}]}),verifier);
    assert.equal((await changed.me(parent)).children[0].verifiedGuardianConsent,false);
    assert.equal((await changed.me(parent)).children[0].collectionStatus,'guardian-verification-required');
    await assert.rejects(changed.start(parent,c.id,{task:'search',deviceId:randomUUID(),environment:TEST_ENVIRONMENT},randomUUID()),code('CONSENT_REVOKED'));
    clock+=3600001;
    parent=(await api.authenticate((await api.login({name:credentials.name,password:credentials.password})).value))!;
    assert.equal((await api.me(parent)).children[0].verifiedGuardianConsent,false);
    assert.equal((await api.me(parent)).children[0].collectionStatus,'guardian-verification-required');
    await assert.rejects(api.start(parent,c.id,{task:'search',deviceId:randomUUID(),environment:TEST_ENVIRONMENT},randomUUID()),code('CONSENT_REVOKED'));
    proof={...valid,reference:randomUUID(),verifiedAt:clock,expiresAt:clock+3600000};
    assert.equal((await api.grantGuardianConsent(parent,c.id,randomUUID())).verifiedGuardianConsent,true);
    await api.withdraw(parent,c.id);
    assert.equal((await api.me(parent)).children[0].consentActive,false);
    assert.equal((await api.me(parent)).children[0].collectionStatus,'collection-withdrawn');
    assert.equal((await db.query<{ withdrawn_at:string|null }>('SELECT withdrawn_at FROM guardian_consents WHERE child_id=$1',[c.id])).rows.every(row=>row.withdrawn_at!==null),true);
    await assert.rejects(api.grantGuardianConsent(parent,c.id,randomUUID()),code('CONSENT_REVOKED'));
    assert.equal((await api.exportChild(parent,c.id)).verifiedConsents.length,2);
  } finally { await db.close(); }
});

test('a slow provider cannot hold the family lock or restore consent after withdrawal', async () => {
  const db=await openDatabase('memory://');
  try {
    await migrate(db);
    const scope=createReleaseScope(approved), clock=Date.now();
    let begin!:()=>void, finish!:(proof:GuardianVerification)=>void;
    const verifying=new Promise<void>(resolve=>{begin=resolve});
    const provider=new Promise<GuardianVerification>(resolve=>{finish=resolve});
    const api=service(db,()=>clock,undefined,undefined,scope,{verify:async(_token:string,_signal:AbortSignal)=>{begin();return provider}});
    const credentials=setup('US'), account=await api.setup(credentials), parent=(await api.authenticate(account.value))!;
    const c=await api.addChild(parent,{alias:'Synthetic child',ageBand:'9-11',locale:'en'});
    const proof:GuardianVerification={provider:'synthetic-verifier',reference:randomUUID(),familyId:parent.family_id,childId:c.id,ownerMemberId:parent.member_id,
      country:'US',ageBand:'9-11',locale:'en',purpose:'family-practice',noticeVersion:consentNotice.version,noticeSha256:consentNotice.sha256,
      releaseScopeIdentity:scope.identity,adultGuardianVerified:true,purposeGranted:true,verifiedAt:clock,expiresAt:clock+3600000};
    const granting=api.grantGuardianConsent(parent,c.id,randomUUID());
    await verifying;
    let withdrew=false;
    try {
      await Promise.race([
        api.withdraw(parent,c.id).then(()=>{withdrew=true}),
        new Promise<never>((_resolve,reject)=>setTimeout(()=>reject(new Error('WITHDRAW_BLOCKED_BY_PROVIDER')),1000)),
      ]);
    } finally { finish(proof); }
    assert.equal(withdrew,true);
    await assert.rejects(granting,(error:unknown)=>error instanceof ApiError && error.code==='CONSENT_REVOKED');
    assert.equal((await db.query('SELECT id FROM guardian_consents')).rows.length,0);
  } finally { await db.close(); }
});
