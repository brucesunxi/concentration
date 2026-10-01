import { randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Database, Queryable } from './database.ts';
import type { DatabaseContext } from './database-context.ts';
import { transactionScope } from './transaction-scope.ts';
import { changePasswordSchema, confirmPasswordSchema, deleteFamilySchema } from '../../packages/contracts/account-security.ts';
import type { AccountSecurity } from '../../packages/contracts/account-security.ts';
import { createPlan, replay, metrics, adapt, DAILY_LIMIT, courseUnit, POLICY_VERSION } from '../../packages/task-engine/index.ts';
import type { AgeBand, Locale, TaskId, Plan, EngineEvent, Evidence } from '../../packages/task-engine/index.ts';
import { setupSchema, loginSchema, profileSchema, ageReviewRequestSchema, ageReviewApplySchema, startSchema, batchSchema, finalizeSchema, observationSchema, weeklyQuerySchema, recoverySchema, handoverSchema } from '../../packages/contracts/index.ts';
import { buildWeeklyReport, weekRange, reportQueryBounds } from '../../packages/reports/weekly.ts';
import type { ReportSession, ReportObservation } from '../../packages/reports/weekly.ts';
import { createLocalContent } from './content.ts';
import type { LocalContent } from './content.ts';
import { lifeGoals } from './life-goals.ts';
import { makeParentGuide } from '../../packages/family-support/parent-guide.ts';
import { createSessionAuthority } from './session-authority.ts';
import type { LocalSessionAuthority } from './session-authority.ts';
import type { ContinuationGrant } from '../../packages/session-runtime/authorization.ts';
import type { RecoveryItem, RecoverySpace } from '../../packages/session-runtime/recovery-model.ts';
import { nextFamilyDay } from '../../packages/session-runtime/day-boundary.ts';
import { practiceWindowPolicy } from '../../packages/session-runtime/practice-window.ts';
import { effectiveMinutes, usageTotals } from './practice-limits.ts';
import type { LimitSettings } from './practice-limits.ts';
import { practiceLimitInput } from '../../packages/contracts/practice-limits.ts';
import type { PracticeLimits } from '../../packages/contracts/practice-limits.ts';
import { familyMembers, memberContext, identity } from './family-members.ts';
import type { MemberRow } from './family-members.ts';
import { historyPage, InvalidHistoryCursor } from './history.ts';
import { HISTORY_PAGE_SIZE, historyQuerySchema } from '../../packages/contracts/history.ts';
import { TEEN_STRATEGY_PAGE_SIZE, teenStrategyCursorSchema, teenStrategyQuerySchema } from '../../packages/contracts/teen-strategy-history.ts';
import type { TeenStrategyHistory } from '../../packages/contracts/teen-strategy-history.ts';
import { LOCAL_CONFIRMATION_PURPOSE, LOCAL_CONFIRMATION_VERSION, activeLocalConfirmationSql, activeVerifiedConsentSql, localCollectionActive } from './collection-authority.ts';
import { localReleaseScope } from './release-scope.ts';
import type { ReleaseScope, ReleasePlatform } from './release-scope.ts';
import { checkedGuardianVerification } from './guardian-consent.ts';
import type { GuardianVerifier } from './guardian-consent.ts';
import type { FamilyEntitlementReader } from './billing-access.ts';
import type { FamilyBillingStatus } from '../../packages/contracts/family-billing.ts';

const scrypt = promisify(scryptCallback);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export class ApiError extends Error {
  status: number; code: string; details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) { super(message); this.status = status; this.code = code; this.details = details; }
}
export type AuthTransport = 'web' | 'native';
export interface Principal { token_hash: string; csrf: string; family_id: string; child_id: string | null; scope: 'parent' | 'child'; expires_at: string; transport: AuthTransport; device_id?: string | null; member_id: string; member_role: 'owner' | 'support'; member_state: 'pending' | 'active' | 'revoked'; allowed_children: string[] }
interface Family { id: string; name: string; timezone: string; locale: Locale; residence_country: string; password_hash: string; auth_failures: number; auth_locked_until: string | null; password_changed_at: string | null }
interface Child extends LimitSettings { id: string; family_id: string; alias: string; age_band: AgeBand; locale: Locale; levels: Record<TaskId, number>; completed_sessions: number; course_units: number; consent_active: boolean; local_confirmation_active: boolean; verified_guardian_consent_active: boolean; age_review_version: number; age_reviewed_at: string; age_review_due_at: string; age_transition_target: AgeBand | '18+' | null; age_transition_requested_at: string | null; age_transition_request_key: string | null }
interface Session { id: string; child_id: string; request_key: string; request_hash: string; device_id: string; plan: Plan; state: string; budget_day: string; budget_ms: number; used_ms: number; result: unknown; created_at: string; completed_at: string | null; continuation_grant: ContinuationGrant | null; closed_reason: string | null; release_scope_identity: string }
function fail(status: number, code: string, message: string): never { throw new ApiError(status, code, message); }
function parent(p: Principal) { if (p.scope !== 'parent') fail(403, 'PARENT_REQUIRED', '请先验证家长密码。'); }
function recentParent(p: Principal, now: number) { parent(p); if (now - (new Date(p.expires_at).getTime() - 8 * 3600000) > 10 * 60000) fail(403, 'REAUTH_REQUIRED', '请重新验证家长密码后操作。'); }
async function one<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> { return (await db.query<T>(sql, params)).rows[0]; }
export function service(source: Database, now: () => number = Date.now, content?: LocalContent, authority?: LocalSessionAuthority, releaseScope: ReleaseScope = localReleaseScope, guardianVerifier?: GuardianVerifier, entitlementReader?: FamilyEntitlementReader) {
  const collecting = (c: Child) => c.consent_active && (releaseScope.mode === 'approved'
    ? c.verified_guardian_consent_active : localCollectionActive(c.consent_active, c.local_confirmation_active));
  const collectionStatus = (c: Child) => !c.consent_active ? 'collection-withdrawn' as const : releaseScope.mode === 'approved'
    ? c.verified_guardian_consent_active ? 'guardian-verified' as const : 'guardian-verification-required' as const
    : c.local_confirmation_active ? 'local-preview-enabled' as const : 'local-preview-required' as const;
  const ageReview = (c: Child) => ({ version: c.age_review_version,
    state: c.age_transition_target === '18+' ? 'adult-pending' as const : c.age_transition_target ? 'pending' as const : now() >= new Date(c.age_review_due_at).getTime() ? 'due' as const : 'current' as const,
    reviewedAt: new Date(c.age_reviewed_at).toISOString(), dueAt: new Date(c.age_review_due_at).toISOString(), targetAgeBand: c.age_transition_target });
  const publicChild = (c: Child) => ({ id: c.id, alias: c.alias, ageBand: c.age_band, locale: c.locale, levels: c.levels, completedSessions: c.completed_sessions,
    consentActive: collecting(c), collectionStatus: collectionStatus(c), localPreviewConfirmation: releaseScope.mode === 'local-development' && c.local_confirmation_active,
    verifiedGuardianConsent: releaseScope.mode === 'approved' && c.consent_active && c.verified_guardian_consent_active, ageReview: ageReview(c), course: courseUnit(c.course_units) });
  const db = transactionScope(source);
  const context = <T>(value: DatabaseContext, action: () => Promise<T>) => db.context ? db.context(value, action) : action();
  // A service can be constructed for a read-only or rejected request and never
  // used. Starting database initialization here can outlive that request (or a
  // test database), so initialize on first actual use instead.
  let contentPromise: Promise<LocalContent> | undefined;
  let authorityPromise: Promise<LocalSessionAuthority> | undefined;
  const contentReady = () => contentPromise ??= content ? Promise.resolve(content) : createLocalContent(db, { now });
  const authorityReady = () => authorityPromise ??= authority ? Promise.resolve(authority) : createSessionAuthority(db);
  async function authenticated<T>(p: Principal, action: (current: Principal, tx: Queryable) => Promise<T>, allowPending = false) {
    // Finish catalogue initialization before taking any family transaction lock.
    await contentReady(); await authorityReady();
    return context(memberContext(p), () => db.transaction(async tx => {
      // One family boundary orders login revocation, child rotation and data
      // operations. Other families retain independent concurrency.
      await tx.query('SELECT id FROM families WHERE id=$1 FOR UPDATE', [p.family_id]);
      const current = await one<Principal>(tx, 'SELECT * FROM auth_sessions WHERE token_hash=$1 AND expires_at>$2 FOR UPDATE', [p.token_hash, new Date(now()).toISOString()]);
      if (!current || current.member_id !== p.member_id || current.family_id !== p.family_id || current.scope !== p.scope || current.child_id !== p.child_id || current.transport !== p.transport || (current.device_id ?? null) !== (p.device_id ?? null)) fail(401, 'UNAUTHENTICATED', '登录已结束，请重新登录家庭空间。');
      const member = await one<MemberRow>(tx, 'SELECT * FROM family_members WHERE family_id=$1 AND id=$2', [p.family_id,p.member_id]);
      if (!member || member.state === 'revoked' || member.role !== p.member_role || canonical(member.child_ids) !== canonical(p.allowed_children)) fail(401,'UNAUTHENTICATED','家长权限已更新，请重新登录。');
      if (member.state !== 'active' && !allowPending) fail(403,'MEMBER_PENDING','请等待家庭创建者确认后再进入。');
      return action({...current, member_role:member.role, member_state:member.state, allowed_children:member.child_ids}, tx);
    }));
  }
  async function passwordMatches(value: string, stored?: string) {
    const [salt, hash] = (stored ?? '00000000000000000000000000000000:' + '0'.repeat(128)).split(':');
    const actual = await scrypt(value, salt, 64) as Buffer;
    return !!stored && timingSafeEqual(Buffer.from(hash, 'hex'), actual);
  }
  async function hashPassword(value:string) { const salt=randomBytes(16).toString('hex'); return `${salt}:${(await scrypt(value,salt,64) as Buffer).toString('hex')}`; }
  function owner(p:Principal) { recentParent(p,now()); if(p.member_role!=='owner')fail(403,'OWNER_REQUIRED','这项操作需要家庭创建者确认。'); }
  async function passwordCheck(tx: Queryable, f: MemberRow, value: string) {
    if (f.auth_locked_until && new Date(f.auth_locked_until).getTime() > now()) return 'ACCOUNT_LOCKED' as const;
    if (await passwordMatches(value, f.password_hash)) {
      await tx.query('UPDATE family_members SET auth_failures=0,auth_locked_until=NULL WHERE id=$1', [f.id]); return null;
    }
    const count = f.auth_locked_until ? 1 : f.auth_failures + 1;
    await tx.query('UPDATE family_members SET auth_failures=$2,auth_locked_until=$3 WHERE id=$1', [f.id, count, count >= 8 ? new Date(now() + 15 * 60000).toISOString() : null]);
    return count >= 8 ? 'ACCOUNT_LOCKED' as const : 'PASSWORD_REJECTED' as const;
  }
  async function accountCommand(p: Principal, raw: unknown, change: boolean) {
    parent(p);
    const input: { currentPassword: string; acknowledged: true; newPassword?: string } = change ? changePasswordSchema.parse(raw) : confirmPasswordSchema.parse(raw);
    if (input.newPassword !== undefined && input.newPassword === input.currentPassword) fail(400, 'PASSWORD_UNCHANGED', '新密码需要与当前密码不同。');
    const result = await authenticated(p, async (_current, tx) => {
      const f = (await one<MemberRow>(tx, 'SELECT * FROM family_members WHERE family_id=$1 AND id=$2', [p.family_id,p.member_id]))!;
      const error = await passwordCheck(tx, f, input.currentPassword);
      if (error) return error; // Commit the failure counter, then reject outside.
      if (input.newPassword !== undefined) {
        const salt = randomBytes(16).toString('hex'), hash = (await scrypt(input.newPassword, salt, 64) as Buffer).toString('hex');
        await tx.query('UPDATE family_members SET password_hash=$2,password_changed_at=$3 WHERE id=$1', [p.member_id, `${salt}:${hash}`, new Date(now()).toISOString()]);
        if(p.member_role==='owner')await tx.query('UPDATE families SET password_hash=$2,password_changed_at=$3 WHERE id=$1', [p.family_id, `${salt}:${hash}`, new Date(now()).toISOString()]);
      }
      if(p.member_role==='owner')await tx.query('DELETE FROM auth_sessions WHERE family_id=$1', [p.family_id]);
      else await tx.query('DELETE FROM auth_sessions WHERE family_id=$1 AND member_id=$2', [p.family_id,p.member_id]);
      return null;
    }, true);
    if (result) fail(result === 'ACCOUNT_LOCKED' ? 429 : 403, result, result === 'ACCOUNT_LOCKED' ? '密码尝试过于频繁，请在十五分钟后再试。' : '当前密码不正确，请重新输入。');
    return { ok: true as const, signInRequired: true as const };
  }
  async function token(familyId: string, childId: string | null = null, transport: AuthTransport = 'web', tx: Queryable = db, deviceId: string | null = null, memberId: string) {
    const value = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
    await tx.query('INSERT INTO auth_sessions(token_hash,csrf,family_id,child_id,scope,expires_at,transport,device_id,member_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [digest(value), csrf, familyId, childId, childId ? 'child' : 'parent', new Date(now() + (childId ? 24 : 8) * 3600000).toISOString(), transport, deviceId, memberId]);
    return { value, csrf };
  }
  async function child(tx: Queryable, p: Principal, id: string, lock = false): Promise<Child> {
    if (p.member_state !== 'active' || (p.member_role === 'support' && !p.allowed_children.includes(id))) fail(404,'NOT_FOUND','未找到档案。');
    if (p.scope === 'child' && p.child_id !== id) fail(404, 'NOT_FOUND', '未找到档案。');
    const c = await one<Child>(tx, `SELECT c.*, ${activeLocalConfirmationSql('c', 3)} AS local_confirmation_active,
      ${activeVerifiedConsentSql('c', 3, 4)} AS verified_guardian_consent_active
      FROM children c WHERE c.id=$1 AND c.family_id=$2${lock ? ' FOR UPDATE OF c' : ''}`, [id, p.family_id, new Date(now()).toISOString(), releaseScope.identity]);
    if (!c) fail(404, 'NOT_FOUND', '未找到档案。'); return c;
  }
  async function session(tx: Queryable, p: Principal, id: string, lock = false): Promise<Session> {
    let s = await one<Session>(tx, 'SELECT s.* FROM sessions s JOIN children c ON c.id=s.child_id WHERE s.id=$1 AND c.family_id=$2', [id, p.family_id]);
    if (!s) fail(404, 'NOT_FOUND', '未找到练习。');
    const c = await child(tx, p, s.child_id, lock);
    const f = await one<Family>(tx, 'SELECT residence_country FROM families WHERE id=$1', [p.family_id]);
    if (!f || s.release_scope_identity !== releaseScope.identity || !s.plan.environment?.platform || !releaseScope.permits(f.residence_country, c.age_band, c.locale, s.plan.environment.platform)) fail(409, 'MARKET_SCOPE_CHANGED', '这次练习的开放范围已改变，请到家长空间查看记录。');
    if (!collecting(c)) fail(403, 'CONSENT_REVOKED', '此档案已停止采集，请到家长空间查看。');
    if (lock) { s = await one<Session>(tx, 'SELECT * FROM sessions WHERE id=$1 FOR UPDATE', [id]); if (!s) fail(404, 'NOT_FOUND', '未找到练习。'); }
    if (s.plan.content) await (await contentReady()).release(s.plan.content, tx, lock);
    return s;
  }
  async function allEvents(tx: Queryable, id: string) { return (await tx.query<{ body: EngineEvent }>('SELECT body FROM events WHERE session_id=$1 ORDER BY seq', [id])).rows.map(x => x.body); }
  function day(timezone: string, at = now()) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)); }
  const life = lifeGoals(db, { child, collecting, fail, now,recentParent:currentParent, content:async()=> (await contentReady()).family });
  function uploadAllowed(s: Session, p: Principal) {
    if (!s.continuation_grant) return; // Historical sessions retain their original contract.
    if (p.scope !== 'child' || p.device_id !== s.device_id || p.transport !== s.continuation_grant.body.transport) fail(403, 'SESSION_DEVICE_MISMATCH', '这次练习属于原先的设备，请在原设备恢复。');
    if (s.closed_reason === 'upload_expired' || now() >= Date.parse(s.continuation_grant.body.uploadUntil)) fail(409, 'SESSION_UPLOAD_EXPIRED', '这次练习的补传期限已结束，请到家长空间处理。');
  }
  async function currentParent(tx: Queryable, p: Principal) {
    recentParent(p, now());
    const current = await one<Principal>(tx, 'SELECT * FROM auth_sessions WHERE token_hash=$1 AND expires_at>$2 FOR UPDATE', [p.token_hash, new Date(now()).toISOString()]);
    if (!current || current.scope !== 'parent' || current.family_id !== p.family_id || current.transport !== p.transport) fail(401, 'UNAUTHENTICATED', '请重新验证家长身份。');
  }
  async function guardianTarget(tx: Queryable, p: Principal, childId: string) {
    const c = await child(tx,p,childId,true);
    if (!c.consent_active) fail(403,'CONSENT_REVOKED','此档案已停止采集。');
    const f = (await one<Family>(tx,'SELECT residence_country FROM families WHERE id=$1',[p.family_id]))!;
    const notice = releaseScope.consentNotice(f.residence_country,c.age_band,c.locale);
    if (!notice || !releaseScope.permitsChild(f.residence_country,c.age_band,c.locale)) fail(403,'MARKET_NOT_OPEN','当前地区、年龄或语言尚未开放此体验。');
    return {c,f,notice};
  }
  async function recoveryItem(tx: Queryable, s: Session, deviceId: string): Promise<RecoveryItem> {
    const events = await allEvents(tx, s.id);
    return { id: s.id, task: s.plan.task, createdAt: new Date(s.created_at).toISOString(), environment: s.plan.environment ?? null, sameDevice: s.device_id === deviceId,
      historyOnly: s.closed_reason === 'device_handover', finalized: !!s.result, receivedEvents: events.length,
      etag: '"' + digest(canonical({ id: s.id, state: s.state, closedReason: s.closed_reason, result: s.result, events })) + '"',
      recordUntil: s.continuation_grant?.body.recordUntil ?? null, uploadUntil: s.continuation_grant?.body.uploadUntil ?? null,
      handoverAvailable: !!s.continuation_grant && s.state === 'active' };
  }
  async function ageReviewSpaceTx(tx: Queryable,p: Principal,childId: string) {
    const c=await child(tx,p,childId);
    const unfinished=(await tx.query<{id:string;state:string;created_at:string;device_id:string;upload_until:string|null}>(
      `SELECT id,state,created_at,device_id,continuation_grant->'body'->>'uploadUntil' AS upload_until
       FROM sessions WHERE child_id=$1 AND (state='active' OR
         (closed_reason='device_handover' AND result IS NULL AND
          (continuation_grant IS NULL OR (continuation_grant->'body'->>'uploadUntil')::timestamptz>$2::timestamptz)))
       ORDER BY created_at,id`,[childId,new Date(now()).toISOString()])).rows;
    return {childId,currentAgeBand:c.age_band,locale:c.locale,...ageReview(c),canEdit:p.member_role==='owner',
      unfinished:unfinished.map(s=>({id:s.id,state:s.state,createdAt:new Date(s.created_at).toISOString(),deviceId:s.device_id,uploadUntil:s.upload_until}))};
  }
  const members = familyMembers(db,{now,fail,owner,hashPassword,context,token,releaseScope});
  const operations = {
    familyMembers:members.read, inviteMember:members.invite, cancelInvitation:members.cancel, actMember:members.act, join:members.join,
    async billingStatus(p: Principal): Promise<FamilyBillingStatus> {
      parent(p);
      const checkedAt = new Date(now()).toISOString();
      if (releaseScope.mode === 'local-development') return { version: 'family-billing-1', familyId: p.family_id, state: 'preview', validUntil: null, autoRenew: null, checkedAt };
      if (!entitlementReader) fail(503, 'ENTITLEMENT_UNAVAILABLE', '家庭权益暂时无法确认，请稍后重试。');
      try {
        const entitlement = await entitlementReader.read(db, p.family_id, checkedAt);
        return { version: 'family-billing-1', familyId: p.family_id, state: entitlement.state, validUntil: entitlement.validUntil, autoRenew: entitlement.autoRenew, checkedAt };
      } catch { fail(503, 'ENTITLEMENT_UNAVAILABLE', '家庭权益暂时无法确认，请稍后重试。'); }
    },
    async ageReviewSpace(p: Principal, childId: string) {
      parent(p);
      return ageReviewSpaceTx(db,p,childId);
    },
    async requestAgeReview(p: Principal, childId: string, raw: unknown, ifMatch: unknown, key: string) {
      const input=ageReviewRequestSchema.parse(raw);
      if (typeof key!=='string'||key.length<16||key.length>128) fail(400,'INVALID_IDEMPOTENCY_KEY','需要有效的请求标识。');
      if (ifMatch===undefined) fail(428,'VERSION_REQUIRED','请先读取档案复核状态。');
      if (typeof ifMatch!=='string'||!/^"[1-9][0-9]{0,8}"$/.test(ifMatch)) fail(400,'INVALID_VERSION','复核版本无效。');
      return db.transaction(async tx=>{
        owner(p); const c=await child(tx,p,childId,true);
        if(c.age_transition_request_key===key && c.age_transition_target===input.targetAgeBand) return ageReviewSpaceTx(tx,p,childId);
        if(c.age_review_version!==Number(ifMatch.slice(1,-1))) fail(409,'AGE_REVIEW_VERSION_CONFLICT','档案复核已改变，请重新读取。');
        if(c.age_transition_target && input.targetAgeBand!==c.age_band) fail(409,'AGE_TRANSITION_PENDING','请先处理已提出的年龄变更。');
        const at=new Date(now()).toISOString();
        if(input.targetAgeBand===c.age_band) await tx.query(`UPDATE children SET age_review_version=age_review_version+1,
          age_reviewed_at=$2,age_review_due_at=$3,age_transition_target=NULL,age_transition_requested_at=NULL,age_transition_request_key=NULL WHERE id=$1`,
          [childId,at,new Date(now()+365*86400000).toISOString()]);
        else await tx.query(`UPDATE children SET age_review_version=age_review_version+1,age_transition_target=$2,
          age_transition_requested_at=$3,age_transition_request_key=$4 WHERE id=$1`,[childId,input.targetAgeBand,at,key]);
        return ageReviewSpaceTx(tx,p,childId);
      });
    },
    async applyAgeReview(p: Principal, childId: string, raw: unknown, ifMatch: unknown) {
      const input=ageReviewApplySchema.parse(raw);
      if(ifMatch===undefined) fail(428,'VERSION_REQUIRED','请先读取档案复核状态。');
      if(typeof ifMatch!=='string'||!/^"[1-9][0-9]{0,8}"$/.test(ifMatch)) fail(400,'INVALID_VERSION','复核版本无效。');
      return db.transaction(async tx=>{
        owner(p); const c=await child(tx,p,childId,true);
        if(c.age_review_version!==Number(ifMatch.slice(1,-1))) fail(409,'AGE_REVIEW_VERSION_CONFLICT','档案复核已改变，请重新读取。');
        if(!c.age_transition_target) fail(409,'AGE_TRANSITION_NOT_PENDING','没有待生效的年龄变更。');
        if(c.age_transition_target==='18+') fail(409,'ADULT_RIGHTS_REVIEW_REQUIRED','成年后的资料权利需要单独核验，当前不能自动转换。');
        const unfinished=await one<{n:number}>(tx,`SELECT count(*)::int n FROM sessions WHERE child_id=$1 AND
          (state='active' OR (closed_reason='device_handover' AND result IS NULL AND
          (continuation_grant IS NULL OR (continuation_grant->'body'->>'uploadUntil')::timestamptz>$2::timestamptz)))`,[childId,new Date(now()).toISOString()]);
        if((unfinished?.n??0)>0) fail(409,'UNFINISHED_SESSIONS','请先结束或处理旧设备上的练习。');
        if(releaseScope.mode==='local-development' && input.localConfirmation!==true) fail(400,'LOCAL_CONFIRMATION_REQUIRED','请确认新年龄档的本地预览范围。');
        const at=new Date(now()).toISOString();
        await tx.query(`UPDATE children SET age_band=$2,age_review_version=age_review_version+1,age_reviewed_at=$3,
          age_review_due_at=$4,age_transition_target=NULL,age_transition_requested_at=NULL,age_transition_request_key=NULL,
          levels='{"search":1,"stop":1,"memory":1,"sustain":1}'::jsonb,course_units=0,
          daily_limit_minutes=NULL,next_daily_limit_minutes=NULL,daily_limit_effective_day=NULL,daily_limit_version=daily_limit_version+1
          WHERE id=$1`,[childId,c.age_transition_target,at,new Date(now()+365*86400000).toISOString()]);
        await tx.query('UPDATE local_confirmations SET withdrawn_at=$2 WHERE child_id=$1 AND withdrawn_at IS NULL',[childId,at]);
        if(releaseScope.mode==='local-development') await tx.query('INSERT INTO local_confirmations(id,family_id,child_id,purpose,version,acknowledged_at) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(),p.family_id,childId,LOCAL_CONFIRMATION_PURPOSE,LOCAL_CONFIRMATION_VERSION,at]);
        await tx.query("DELETE FROM auth_sessions WHERE child_id=$1 AND scope='child'",[childId]);
        return ageReviewSpaceTx(tx,p,childId);
      });
    },
    async practiceLimits(p: Principal, childId: string): Promise<PracticeLimits> {
      const c = await child(db, p, childId, true);
      const f = (await one<Family>(db, 'SELECT timezone FROM families WHERE id=$1', [p.family_id]))!;
      const at = now(), today = day(f.timezone, at), minutes = effectiveMinutes(c, today);
      const { confirmed, reserved } = await usageTotals(db, childId, today);
      const available = Math.max(0, minutes * 60000 - confirmed - reserved);
      return { version: 'practice-limits-1', childId, ageBand: c.age_band, settingsVersion: c.daily_limit_version,
        canEdit: p.scope === 'parent' && p.member_role === 'owner', collectionActive: collecting(c), timezone: f.timezone, day: today,
        nextDay: day(f.timezone, nextFamilyDay(at, f.timezone)), generatedAt: new Date(at).toISOString(),
        maximumMinutes: DAILY_LIMIT[c.age_band] / 60000, currentMinutes: minutes,
        next: c.daily_limit_effective_day && c.daily_limit_effective_day > today ? { minutes: c.next_daily_limit_minutes!, day: c.daily_limit_effective_day } : null,
        confirmedMs: confirmed, reservedMs: reserved, availableMs: collecting(c) ? available : 0,
        status: !collecting(c) ? 'collection-stopped' : minutes === 0 ? 'paused' : reserved > 0 ? 'reserved' : available < 5000 ? 'daily-limit' : 'available' };
    },
    async setPracticeLimit(p: Principal, childId: string, raw: unknown, ifMatch: unknown): Promise<PracticeLimits> {
      parent(p); recentParent(p, now()); const input = practiceLimitInput.parse(raw);
      if (ifMatch === undefined) fail(428, 'VERSION_REQUIRED', '请先读取当前设置。');
      if (typeof ifMatch !== 'string' || !/^"[1-9][0-9]{0,8}"$/.test(ifMatch)) fail(400, 'INVALID_VERSION', '设置版本无效。');
      const c = await child(db, p, childId, true);
      if (!collecting(c)) fail(403, 'CONSENT_REVOKED', '这份档案已停止采集。');
      if (c.daily_limit_version !== Number(ifMatch.slice(1, -1))) fail(409, 'LIMIT_VERSION_CONFLICT', '设置已改变，请读取后重新确认。');
      if (input.minutes * 60000 > DAILY_LIMIT[c.age_band]) fail(400, 'LIMIT_ABOVE_AGE_MAXIMUM', '不能超过这一年龄段的上限。');
      const f = (await one<Family>(db, 'SELECT timezone FROM families WHERE id=$1', [p.family_id]))!;
      const at = now(), today = day(f.timezone, at), current = effectiveMinutes(c, today);
      const nextDay = day(f.timezone, nextFamilyDay(at, f.timezone));
      if (input.effectiveDay !== nextDay) fail(409, 'LIMIT_DAY_CHANGED', '家庭日期已改变，请重新读取生效日期。');
      const next = input.minutes === current ? null : input.minutes;
      await db.query(`UPDATE children SET daily_limit_minutes=$2,next_daily_limit_minutes=$3,daily_limit_effective_day=$4,
        daily_limit_version=daily_limit_version+1,daily_limit_updated_at=$5 WHERE id=$1`,
        [childId, current, next, next === null ? null : nextDay, new Date(at).toISOString()]);
      return operations.practiceLimits(p, childId);
    },
    changePassword: (p: Principal, raw: unknown) => accountCommand(p, raw, true),
    logoutAll: (p: Principal, raw: unknown) => accountCommand(p, raw, false),
    async deleteFamily(p: Principal, raw: unknown) {
      owner(p);
      const input = deleteFamilySchema.parse(raw);
      const result = await authenticated(p, async (current, tx) => {
        owner(current);
        const family = await one<Family>(tx, 'SELECT id,name FROM families WHERE id=$1 FOR UPDATE', [current.family_id]);
        if (!family) fail(401, 'UNAUTHENTICATED', '家庭空间已不存在。');
        if (family.name !== input.familyName) return 'FAMILY_NAME_MISMATCH' as const;
        const member = (await one<MemberRow>(tx, 'SELECT * FROM family_members WHERE family_id=$1 AND id=$2', [current.family_id, current.member_id]))!;
        const error = await passwordCheck(tx, member, input.currentPassword);
        if (error) return error;
        await tx.query('DELETE FROM families WHERE id=$1', [current.family_id]);
        return null;
      });
      if (result) fail(result === 'ACCOUNT_LOCKED' ? 429 : 403, result, result === 'FAMILY_NAME_MISMATCH' ? '请完整输入家庭名称。' : result === 'ACCOUNT_LOCKED' ? '密码尝试过于频繁，请在十五分钟后再试。' : '当前密码不正确，请重新输入。');
      return { ok: true as const, signInRequired: true as const };
    },
    async accountSecurity(p: Principal): Promise<AccountSecurity> {
      parent(p);
      const f = (await one<MemberRow>(db, 'SELECT password_changed_at FROM family_members WHERE family_id=$1 AND id=$2', [p.family_id,p.member_id]))!;
      const rows = (await db.query<{ scope: 'parent' | 'child'; transport: AuthTransport; n: number }>('SELECT scope,transport,count(*)::int n FROM auth_sessions WHERE family_id=$1 AND expires_at>$2 AND ($3::boolean OR member_id=$4) GROUP BY scope,transport', [p.family_id, new Date(now()).toISOString(),p.member_role==='owner',p.member_id])).rows;
      const active = { parent: { web: 0, native: 0 }, child: { web: 0, native: 0 } };
      for (const row of rows) active[row.scope][row.transport] = row.n;
      return { version: 'account-security-1', familyId: p.family_id, memberRole:p.member_role, passwordChangedAt: f.password_changed_at ? new Date(f.password_changed_at).toISOString() : null, active };
    },
    async recoverySpace(p: Principal, childId: string, raw: unknown): Promise<RecoverySpace> {
      parent(p); const input = recoverySchema.parse(raw);
      return db.transaction(async tx => {
        const c = await child(tx, p, childId, true), family = (await one<Family>(tx, 'SELECT timezone,residence_country FROM families WHERE id=$1', [p.family_id]))!;
        const budgetDay = day(family.timezone);
        const rows = (await tx.query<Session>("SELECT * FROM sessions WHERE child_id=$1 AND (state='active' OR closed_reason='device_handover') ORDER BY (state='active') DESC,created_at DESC,id DESC LIMIT 21", [childId])).rows;
        const marketOpen=releaseScope.permitsChild(family.residence_country,c.age_band,c.locale);
        const items = await Promise.all(rows.map(async s => { const item=await recoveryItem(tx,s,input.deviceId);return {...item,mayResume:s.release_scope_identity===releaseScope.identity&&!!s.plan.environment?.platform&&releaseScope.permits(family.residence_country,c.age_band,c.locale,s.plan.environment.platform),handoverAvailable:p.member_role==='owner'&&item.handoverAvailable}; }));
        // Active grants and unconfirmed handovers retain their allowance until a valid end is acknowledged.
        const spent = await usageTotals(tx, childId, budgetDay);
        return { childId, collectionActive:collecting(c), marketOpen, active:items.find((_,i) => rows[i].state === 'active') ?? null, history:items.filter(x => x.historyOnly).slice(0,20), budgetDay, availableMs: collecting(c)&&marketOpen ? Math.max(0,effectiveMinutes(c,budgetDay)*60000-spent.confirmed-spent.reserved) : 0, timezone:family.timezone };
      });
    },
    async handover(p: Principal, childId: string, id: string, raw: unknown, match: unknown, key: string) {
      recentParent(p,now()); const input=handoverSchema.parse(raw);
      if (!key || key.length<16 || key.length>128) fail(400,'INVALID_IDEMPOTENCY_KEY','需要有效的请求标识。');
      if (match === undefined) fail(428,'PRECONDITION_REQUIRED','请先读取当前练习状态。');
      if (typeof match !== 'string' || !/^"[a-f0-9]{64}"$/.test(match)) fail(400,'INVALID_PRECONDITION','需要有效的练习状态版本。');
      const requestHash=digest(canonical({id,input,match,transport:p.transport}));
      return db.transaction(async tx => {
        const c=await child(tx,p,childId,true); await currentParent(tx,p);
        if (!collecting(c)) fail(403,'CONSENT_REVOKED','此档案已停止采集。');
        const prior=await one<{session_id:string;request_hash:string;created_at:string}>(tx,'SELECT * FROM session_handovers WHERE child_id=$1 AND request_key=$2',[childId,key]);
        if (prior) { if (prior.request_hash!==requestHash) fail(409,'IDEMPOTENCY_CONFLICT','重复请求的内容不同。'); return {childId,sessionId:prior.session_id,closedAt:new Date(prior.created_at).toISOString(),replayed:true}; }
        const s=await one<Session>(tx,'SELECT * FROM sessions WHERE id=$1 AND child_id=$2 FOR UPDATE',[id,childId]);
        if (!s) fail(404,'NOT_FOUND','未找到练习。');
        if (s.state!=='active' || (await recoveryItem(tx,s,input.deviceId)).etag!==match) fail(409,'HANDOVER_CONFLICT','练习记录已更新，请重新查看后确认。');
        if (!s.continuation_grant) fail(409,'LEGACY_SESSION','旧版练习需在原设备结束。');
        const closedAt=new Date(now()).toISOString();
        await tx.query("UPDATE sessions SET state='aborted',closed_reason='device_handover',used_ms=budget_ms WHERE id=$1",[id]);
        await tx.query('INSERT INTO session_handovers VALUES($1,$2,$3,$4,$5,$6)',[id,childId,input.deviceId,key,requestHash,closedAt]);
        return {childId,sessionId:id,closedAt,replayed:false};
      });
    },
    async recover(p: Principal, childId: string, id: string, raw: unknown) {
      recentParent(p,now()); const input=recoverySchema.parse(raw);
      return db.transaction(async tx => {
        await child(tx,p,childId,true); await currentParent(tx,p);
        if (!(await one(tx,'SELECT id FROM sessions WHERE id=$1 AND child_id=$2',[id,childId]))) fail(404,'NOT_FOUND','未找到练习。');
        const s=await session(tx,p,id,true);
        if(s.child_id!==childId) fail(404,'NOT_FOUND','未找到练习。');
        if(s.device_id!==input.deviceId || (s.plan.environment?.platform==='web' ? 'web':'native')!==p.transport) fail(403,'SESSION_DEVICE_MISMATCH','请在原设备恢复这些记录。');
        if(s.result || !(s.state==='active' || s.closed_reason==='device_handover')) fail(409,'SESSION_ENDED','这次练习已结束。');
        if(s.continuation_grant && now()>=Date.parse(s.continuation_grant.body.uploadUntil)) fail(409,'SESSION_UPLOAD_EXPIRED','这次练习的补传期限已结束。');
        const auth=await token(p.family_id,childId,p.transport,tx,input.deviceId,p.member_id);
        await tx.query('DELETE FROM auth_sessions WHERE token_hash=$1',[p.token_hash]);
        return {session:{...s,events:await allEvents(tx,id)},auth};
      });
    },
    lifeSpace: life.read, lifeHistory: life.history, createLifeGoal: life.create, actLifeGoal: life.act,
    async parentGuide(p: Principal, childId: string) {
      parent(p);
      const c = await child(db, p, childId);
      const family=(await contentReady()).family, release=await family.current(c.age_band,db);
      family.requireAvailable(release.info);
      return {...makeParentGuide(c.id, c.age_band, c.course_units, collecting(c)),lessons:release.pack.lessons,content:release.info,review:release.pack.review};
    },
    async sessionAuthorities() { return (await authorityReady()).trust(); },
    async sessionStatus(p: Principal, id: string) {
      return db.transaction(async tx => {
        const s = await session(tx, p, id, true); uploadAllowed(s, p);
        return { id: s.id, state: s.state, canContinue: s.state === 'active' && (!s.continuation_grant || now() < Date.parse(s.continuation_grant.body.recordUntil)), historyOnly: s.closed_reason === 'device_handover', grantHash: s.continuation_grant ? digest(canonical(s.continuation_grant)) : null, serverTime: new Date(now()).toISOString() };
      });
    },
    async enterChild(p: Principal, childId: string) {
      parent(p);
      return db.transaction(async tx => {
        const c = await child(tx, p, childId, true);
        if (!collecting(c)) fail(403, 'CONSENT_REVOKED', '此档案已停止采集。');
        const active = await tx.query('SELECT token_hash FROM auth_sessions WHERE token_hash=$1 AND expires_at>$2 FOR UPDATE', [p.token_hash, new Date(now()).toISOString()]);
        if (!active.rows.length) fail(401, 'UNAUTHENTICATED', '请重新进入家庭空间。');
        const auth = await token(p.family_id, childId, p.transport, tx, null, p.member_id);
        await tx.query('DELETE FROM auth_sessions WHERE token_hash=$1', [p.token_hash]);
        return { child: publicChild(c), auth };
      });
    },
    async authenticate(value: string | undefined, transport: AuthTransport = 'web') {
      if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
      const session = await context({ mode: 'authenticate', tokenHash: digest(value) }, async () =>
        await one<Principal>(db, 'SELECT * FROM auth_sessions WHERE token_hash=$1 AND expires_at>$2 AND transport=$3', [digest(value), new Date(now()).toISOString(), transport]) ?? null);
      if(!session)return null;
      const member = await context({mode:'identity',familyId:session.family_id,memberId:session.member_id},()=>one<MemberRow>(db,'SELECT * FROM family_members WHERE family_id=$1 AND id=$2',[session.family_id,session.member_id]));
      if(!member||member.state==='revoked'||(session.scope==='child'&&(member.state!=='active'||(member.role==='support'&&!member.child_ids.includes(session.child_id!)))))return null;
      return {...session,member_role:member.role,member_state:member.state,allowed_children:member.child_ids};
    },
    async setup(raw: unknown, transport: AuthTransport = 'web') {
      const input = setupSchema.parse(raw), salt = randomBytes(16).toString('hex');
      if (releaseScope.mode === 'local-development' && input.acknowledgedLocalUse !== true) fail(400,'LOCAL_USE_ACK_REQUIRED','请先确认本地预览的使用范围。');
      if (transport === 'web' && input.registrationPlatform && input.registrationPlatform !== 'web') fail(400, 'REGISTRATION_PLATFORM_MISMATCH', '注册平台与客户端不一致。');
      if (transport === 'native' && input.registrationPlatform === 'web') fail(400, 'REGISTRATION_PLATFORM_MISMATCH', '注册平台与客户端不一致。');
      if (transport === 'native' && releaseScope.mode === 'approved' && !input.registrationPlatform) fail(400, 'REGISTRATION_PLATFORM_REQUIRED', '请提供设备平台。');
      const possiblePlatforms: ReleasePlatform[] = transport === 'web' ? ['web'] : input.registrationPlatform ? [input.registrationPlatform] : ['ios', 'android'];
      if (!releaseScope.permitsRegistration(input.residenceCountry, input.locale, possiblePlatforms)) fail(403, 'MARKET_NOT_OPEN', '当前地区、语言或平台尚未开放家庭使用。');
      const hashed = (await scrypt(input.password, salt, 64) as Buffer).toString('hex');
      const id = randomUUID();
      try { return await context({ mode: 'setup', familyId: id }, () => db.transaction(async tx => {
        await tx.query('INSERT INTO families(id,name,login_name,password_hash,timezone,locale,residence_country) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, input.name, input.name.toLocaleLowerCase('en'), `${salt}:${hashed}`, input.timezone, input.locale, input.residenceCountry]);
        const memberId=randomUUID();
        await tx.query("INSERT INTO family_members(id,family_id,login_name,display_name,role,state,password_hash,created_at,approved_at) VALUES($1,$2,'owner',$3,'owner','active',$4,$5,$5)",[memberId,id,input.name,`${salt}:${hashed}`,new Date(now()).toISOString()]);
        return token(id, null, transport, tx, null, memberId);
      })); }
      catch (error) { if ((error as { code?: string }).code === '23505') fail(409, 'NAME_TAKEN', '家庭名称已存在，请登录或换一个名称。'); throw error; }
    },
    async login(raw: unknown, transport: AuthTransport = 'web') {
      const input = loginSchema.parse(raw);
      const result = await context({ mode: 'login', loginName: input.name.toLocaleLowerCase('en'), memberLogin:input.memberLogin ?? 'owner' }, () => db.transaction(async tx => {
        const f = await one<Family>(tx, 'SELECT * FROM families WHERE login_name=$1 FOR UPDATE', [input.name.toLocaleLowerCase('en')]);
        if (!f) { await passwordMatches(input.password); return null; }
        const member = await one<MemberRow>(tx,'SELECT * FROM family_members WHERE family_id=$1 AND login_name=$2 FOR UPDATE',[f.id,input.memberLogin ?? 'owner']);
        if(!member||member.state==='revoked'){await passwordMatches(input.password);return null;}
        if (await passwordCheck(tx, member, input.password)) return null;
        return token(f.id, null, transport, tx, null, member.id);
      }));
      if (!result) fail(401, 'LOGIN_FAILED', '家庭名称或密码不正确，或暂时无法登录。');
      return result;
    },
    async logout(p: Principal) { await db.query('DELETE FROM auth_sessions WHERE token_hash=$1', [p.token_hash]); },
    async me(p: Principal) {
      const f = await one<Family>(db, 'SELECT id,name,timezone,locale,residence_country FROM families WHERE id=$1', [p.family_id]);
      const children = (await db.query<Child>(`SELECT c.*, ${activeLocalConfirmationSql('c', 6)} AS local_confirmation_active,
        ${activeVerifiedConsentSql('c', 6, 7)} AS verified_guardian_consent_active
        FROM children c WHERE c.family_id=$1 AND ($2::uuid IS NULL OR c.id=$2) AND $3::boolean AND ($4::boolean OR c.id=ANY($5::uuid[])) ORDER BY c.created_at,c.id`, [p.family_id, p.child_id,p.member_state==='active',p.member_role==='owner',p.allowed_children,new Date(now()).toISOString(),releaseScope.identity])).rows;
      const member=await one<MemberRow>(db,'SELECT * FROM family_members WHERE family_id=$1 AND id=$2',[p.family_id,p.member_id]);
      return { family: { id: f!.id, name: f!.name, timezone: f!.timezone, locale: f!.locale, residenceCountry: f!.residence_country }, role: p.scope, ...(p.scope==='parent'?{member:identity(member!)}:{}), csrf: p.csrf, children: children.map(publicChild), mode: releaseScope.mode, policyVersion: POLICY_VERSION, releaseScopeVersion: releaseScope.version };
    },
    async addChild(p: Principal, raw: unknown) {
      parent(p); const input = profileSchema.parse(raw), id = randomUUID();
      if (releaseScope.mode === 'local-development' && input.localConfirmation !== true) fail(400,'LOCAL_CONFIRMATION_REQUIRED','本地预览需要先确认使用范围。');
      return db.transaction(async tx => {
        const f = await one<Family>(tx, 'SELECT * FROM families WHERE id=$1 FOR UPDATE', [p.family_id]);
        if (!f || !releaseScope.permitsChild(f.residence_country, input.ageBand, input.locale)) fail(403, 'MARKET_NOT_OPEN', '当前地区、年龄或语言尚未开放此体验。');
        const total = await one<{ n: number }>(tx, 'SELECT count(*)::int n FROM children WHERE family_id=$1', [p.family_id]);
        if (total && total.n >= 3) fail(409, 'PROFILE_LIMIT', '一个家庭最多建立三个档案。');
        await tx.query('INSERT INTO children(id,family_id,alias,age_band,locale) VALUES($1,$2,$3,$4,$5)', [id, p.family_id, input.alias, input.ageBand, input.locale]);
        if (releaseScope.mode === 'local-development') await tx.query('INSERT INTO local_confirmations(id,family_id,child_id,purpose,version,acknowledged_at) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), p.family_id, id, LOCAL_CONFIRMATION_PURPOSE, LOCAL_CONFIRMATION_VERSION, new Date(now()).toISOString()]);
        return publicChild(await child(tx,p,id));
      });
    },
    // Keep the network-bound provider call outside both family transactions.
    // The final transaction rechecks all mutable facts after withdrawal,
    // password rotation, scope changes or another consent grant.
    async grantGuardianConsent(p: Principal, childId: string, opaqueToken: string) {
      if (releaseScope.mode !== 'approved' || !guardianVerifier) fail(503,'GUARDIAN_VERIFICATION_UNAVAILABLE','监护核验暂不可用。');
      if (typeof opaqueToken !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/.test(opaqueToken)) fail(400,'VERIFICATION_TOKEN_INVALID','核验凭证无效。');
      await authenticated(p, async (current,tx) => { owner(current); await guardianTarget(tx,current,childId); });
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let providerProof: Awaited<ReturnType<GuardianVerifier['verify']>>;
      try {
        providerProof = await Promise.race([
          guardianVerifier.verify(opaqueToken,controller.signal),
          new Promise<never>((_resolve,reject) => { timer=setTimeout(() => { controller.abort(); reject(new Error('GUARDIAN_VERIFICATION_TIMEOUT')); },8000); }),
        ]);
      } catch {
        fail(503,'GUARDIAN_VERIFICATION_UNAVAILABLE','监护核验暂不可用，请稍后重试。');
      } finally { if (timer) clearTimeout(timer); }
      return authenticated(p, async (current,tx) => {
        owner(current);
        const {c,f,notice} = await guardianTarget(tx,current,childId);
        const grantedAt = now();
        const verified = checkedGuardianVerification(providerProof,{
          familyId:current.family_id,childId,ownerMemberId:current.member_id,country:f.residence_country,ageBand:c.age_band,locale:c.locale,
          noticeVersion:notice.version,noticeSha256:notice.sha256,releaseScopeIdentity:releaseScope.identity,
        },grantedAt);
        if (!verified) fail(403,'GUARDIAN_VERIFICATION_REJECTED','监护核验未通过或已失效。');
        try {
          await tx.query(`INSERT INTO guardian_consents(id,family_id,child_id,owner_member_id,provider,verification_ref_hash,country,age_band,locale,purpose,
            notice_version,notice_sha256,release_scope_identity,verified_at,granted_at,expires_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'family-practice',$10,$11,$12,$13,$14,$15)`,[
            randomUUID(),current.family_id,childId,current.member_id,verified.provider,verified.referenceHash,f.residence_country,c.age_band,c.locale,
            notice.version,notice.sha256,releaseScope.identity,verified.verifiedAt,new Date(grantedAt).toISOString(),verified.expiresAt,
          ]);
        } catch (error) {
          if ((error as {code?:string}).code==='23505') fail(409,'VERIFICATION_REPLAYED','这份核验凭证已经使用，请重新核验。');
          throw error;
        }
        return publicChild(await child(tx,current,childId));
      });
    },
    async start(p: Principal, childId: string, raw: unknown, key: string) {
      await contentReady(); await authorityReady();
      const input = startSchema.parse(raw);
      if ((p.transport === 'native') !== (input.environment.platform !== 'web')) fail(400, 'ENVIRONMENT_TRANSPORT_MISMATCH', '练习平台与登录方式不一致。');
      if (!key || key.length < 16 || key.length > 128) fail(400, 'INVALID_IDEMPOTENCY_KEY', '需要有效的请求标识。');
      const requestHash = digest(canonical(input));
      return db.transaction(async tx => {
        const c = await child(tx, p, childId, true);
        if(ageReview(c).state!=='current') fail(409,'AGE_REVIEW_REQUIRED','请先由家长确认适合的年龄档，再开始新练习。');
        const family = await one<Family>(tx, 'SELECT * FROM families WHERE id=$1', [p.family_id]);
        if (!family || !releaseScope.permits(family.residence_country, c.age_band, c.locale, input.environment.platform)) fail(403, 'MARKET_NOT_OPEN', '当前地区、年龄、语言或平台尚未开放此练习。');
        const previous = await one<Session>(tx, 'SELECT * FROM sessions WHERE child_id=$1 AND request_key=$2', [childId, key]);
        let result = previous;
        if (previous?.closed_reason === 'device_handover') fail(409,'SESSION_REPLACED','这次练习已由家长结束，请从恢复记录入口处理。');
        if (previous && previous.release_scope_identity !== releaseScope.identity) fail(409, 'MARKET_SCOPE_CHANGED', '原练习的开放范围已改变，请重新查看家庭空间。');
        if (previous && previous.request_hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', '重复请求的内容不同。');
        let active = await one<Session>(tx, "SELECT * FROM sessions WHERE child_id=$1 AND state='active'", [childId]);
        if (active && active.release_scope_identity !== releaseScope.identity) fail(409, 'MARKET_SCOPE_CHANGED', '原练习的开放范围已改变，请到家长空间查看记录。');
        if (!collecting(c)) fail(403, 'CONSENT_REVOKED', '此档案已停止采集。');
        if (active?.continuation_grant && now() >= Date.parse(active.continuation_grant.body.uploadUntil)) {
          // Do not refund a budget whose offline use could no longer be reconciled.
          await tx.query("UPDATE sessions SET state='aborted',closed_reason='upload_expired',used_ms=budget_ms WHERE id=$1", [active.id]);
          active = undefined;
        }
        if (previous?.continuation_grant && (previous.closed_reason === 'upload_expired' || now() >= Date.parse(previous.continuation_grant.body.uploadUntil))) fail(409, 'SESSION_UPLOAD_EXPIRED', '原请求的补传期限已结束，请开始新练习。');
        if (!result && active) { if (active.device_id !== input.deviceId || (active.continuation_grant && active.continuation_grant.body.transport !== p.transport)) fail(409, 'SESSION_CONFLICT', '另一台设备有未结束的练习。'); result = active; }
        if (!result) {
          const f = await one<Family>(tx, 'SELECT timezone FROM families WHERE id=$1', [p.family_id]);
          const issued = now(), budgetDay = day(f!.timezone, issued);
          if (releaseScope.requiresEntitlement(family.residence_country, c.age_band, c.locale, input.environment.platform)) {
            if (!entitlementReader) fail(503, 'ENTITLEMENT_UNAVAILABLE', '家庭权益暂时无法确认，请稍后重试。');
            let entitlement;
            try { entitlement = await entitlementReader.read(tx, p.family_id, new Date(issued).toISOString()); }
            catch { fail(503, 'ENTITLEMENT_UNAVAILABLE', '家庭权益暂时无法确认，请稍后重试。'); }
            if (entitlement.state !== 'active' && entitlement.state !== 'grace') fail(403, 'ENTITLEMENT_REQUIRED', '这项练习需要有效的家庭权益，请家长查看家庭空间。');
            if (!entitlement.productId || !entitlement.validUntil || Date.parse(entitlement.validUntil) <= issued || !Number.isFinite(Date.parse(entitlement.validUntil))) fail(503, 'ENTITLEMENT_UNAVAILABLE', '家庭权益暂时无法确认，请稍后重试。');
          }
          const spent = await usageTotals(tx, childId, budgetDay), minutes = effectiveMinutes(c, budgetDay);
          const available = Math.max(0, minutes * 60000 - spent.confirmed - spent.reserved);
          if (minutes === 0) fail(409, 'PRACTICE_PAUSED', '家庭已暂停新练习，可以先休息或尝试生活中的小策略。');
          if (available < 5000) fail(409, 'DAILY_LIMIT', '今天的练习已足够，可以把策略带到生活里。');
          const reference = await (await contentReady()).pick(input.task, c.age_band, c.locale, tx);
          const previousCondition = await one<{ level: number }>(tx, `SELECT (result->'decision'->>'level')::int AS level FROM sessions WHERE child_id=$1 AND state='completed' AND plan->'environment'=$2::jsonb AND plan->'content'->>'sha256'=$3 AND continuation_grant->'body'->'windowPolicy'=$4::jsonb ORDER BY completed_at DESC,created_at DESC,id DESC LIMIT 1`, [childId, input.environment, reference.sha256, practiceWindowPolicy(c.age_band)]);
          const level = previousCondition?.level ?? 1;
          const id = randomUUID(), plan = createPlan({ id, task: input.task, ageBand: c.age_band, locale: c.locale, seed: randomBytes(16).toString('hex'), level, environment: input.environment, content: reference });
          const release = await (await contentReady()).release(reference, tx, true);
          const grant = await (await authorityReady()).issue({ id, childId, deviceId: input.deviceId, plan, budgetMs: available, transport: p.transport, now: issued, contentExpiry: Date.parse(release.body.expiresAt), dayEnd: nextFamilyDay(issued, f!.timezone) });
          result = (await one<Session>(tx, 'INSERT INTO sessions(id,child_id,request_key,request_hash,device_id,plan,budget_day,budget_ms,created_at,continuation_grant,daily_limit_snapshot,release_scope_identity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *', [id, childId, key, requestHash, input.deviceId, plan, budgetDay, available, new Date(issued).toISOString(), grant, { version: 'practice-limits-1', settingsVersion: c.daily_limit_version, day: budgetDay, minutes }, releaseScope.identity]))!;
        }
        if (result.plan.content) await (await contentReady()).release(result.plan.content, tx, true);
        const auth = await token(p.family_id, childId, p.transport, tx, input.deviceId, p.member_id);
        await tx.query('DELETE FROM auth_sessions WHERE token_hash=$1', [p.token_hash]);
        return { session: result, auth };
      });
    },
    async active(p: Principal) {
      if (!p.child_id) return null;
      const s = await one<Session>(db, "SELECT * FROM sessions WHERE child_id=$1 AND (state='active' OR (closed_reason='device_handover' AND result IS NULL)) AND (continuation_grant IS NULL OR device_id=$2) ORDER BY (state='active') DESC,created_at DESC LIMIT 1", [p.child_id, p.device_id ?? null]);
      if (!s) return null;
      await session(db, p, s.id);
      return { ...s, events: await allEvents(db, s.id) };
    },
    async append(p: Principal, id: string, raw: unknown) {
      const { events } = batchSchema.parse(raw);
      return db.transaction(async tx => {
        const s = await session(tx, p, id, true);
        uploadAllowed(s, p);
        const accepted: string[] = [], duplicates: string[] = [];
        for (const e of events) {
          const existing = await one<{ body: EngineEvent }>(tx, 'SELECT body FROM events WHERE session_id=$1 AND (seq=$2 OR event_id=$3)', [id, e.seq, e.id]);
          if (existing) { if (canonical(existing.body) !== canonical(e)) fail(409, 'EVENT_CONFLICT', '同一记录标识对应了不同内容。'); duplicates.push(e.id); continue; }
          if (s.state !== 'active' && !(s.closed_reason === 'device_handover' && !s.result)) fail(409, 'SESSION_ENDED', '这次练习已结束。');
          await tx.query('INSERT INTO events VALUES($1,$2,$3,$4)', [id, e.seq, e.id, e]); accepted.push(e.id);
        }
        const full = await allEvents(tx, id), prefix: EngineEvent[] = [];
        for (const e of full) { if (e.seq !== prefix.length + 1) break; prefix.push(e); }
        const state = replay(s.plan, prefix, s.budget_ms);
        return { acceptedIds: accepted, duplicateIds: duplicates, highestContiguousSeq: prefix.length, activeMs: state.activeMs };
      });
    },
    async finalize(p: Principal, id: string, raw: unknown) {
      const { lastSeq } = finalizeSchema.parse(raw);
      return db.transaction(async tx => {
        const s = await session(tx, p, id, true);
        uploadAllowed(s, p);
        const events = await allEvents(tx, id);
        if (events.length !== lastSeq || events.some((e, i) => e.seq !== i + 1)) throw new ApiError(409, 'MISSING_EVENTS', '还有记录等待同步。', { received: events.map(e => e.seq), lastSeq });
        if (s.result) return s.result;
        const state = replay(s.plan, events, s.budget_ms);
        if (!state.ended) fail(422, 'MISSING_END', '缺少结束事件。');
        const completed = state.endReason === 'completed', historyOnly = s.closed_reason === 'device_handover';
        const c = await child(tx, p, s.child_id, true);
        const previous = await tx.query<{ plan: Plan; result: { trials: typeof state.results; invalidations?: typeof state.invalidations }; completed_at: string }>("SELECT plan,result,completed_at FROM sessions WHERE child_id=$1 AND state='completed' AND plan->>'condition'=$2 AND completed_at>=$3 AND coalesce(continuation_grant->'body'->'windowPolicy','null'::jsonb)=$4::jsonb ORDER BY completed_at DESC,created_at DESC,id DESC LIMIT 3", [s.child_id, s.plan.condition, new Date(now() - 14 * 86400000).toISOString(), canonical(s.continuation_grant?.body.version === 2 ? s.continuation_grant.body.windowPolicy : null)]);
        const completedAt = new Date(now()).toISOString();
        const evidence: Evidence[] = previous.rows.reverse().map(x => ({ condition: x.plan.condition, results: x.result.trials, invalidations: x.result.invalidations, completedAt: new Date(x.completed_at).toISOString() }));
        if (completed && !historyOnly) evidence.push({ condition: s.plan.condition, results: state.results, invalidations: state.invalidations, completedAt });
        const decision = completed && !historyOnly ? adapt(s.plan, evidence, now()) : { level: c.levels[s.plan.task], reason: historyOnly ? 'HOLD_DEVICE_HANDOVER' : 'HOLD_INCOMPLETE' };
        const result = { ...(historyOnly ? {historyOnly:true} : {}), sessionId: id, task: s.plan.task, condition: s.plan.condition, completed, completedAt, metrics: metrics(state.results), trials: state.results, interruptions: state.interruptions, invalidations: state.invalidations, activeMs: state.activeMs, decision, engineVersion: s.plan.version, content: s.plan.content, environment: s.plan.environment, policyVersion: s.plan.policyVersion ?? 'conservative-1' };
        await tx.query('UPDATE sessions SET state=$2,used_ms=$3,result=$4,completed_at=$5 WHERE id=$1', [id, completed && !historyOnly ? 'completed' : 'aborted', Math.ceil(Math.min(s.budget_ms, state.activeMs)), result, completedAt]);
        if (completed && !historyOnly) {
          const course = courseUnit(c.course_units);
          const advance = !course.complete && s.plan.task === course.task ? 1 : 0;
          await tx.query('UPDATE children SET completed_sessions=completed_sessions+1,levels=$2,course_units=course_units+$3 WHERE id=$1', [c.id, { ...c.levels, [s.plan.task]: decision.level }, advance]);
        }
        return result;
      });
    },
    async report(p: Principal, childId: string, raw: unknown = {}) {
      parent(p); const c = await child(db, p, childId);
      const input = historyQuerySchema.parse(raw);
      try {
        const sessions = await historyPage(db,childId,'sessions',input.sessionsCursor);
        const observations = await historyPage(db,childId,'observations',input.observationsCursor);
        const total = await one<{ n: number }>(db, 'SELECT count(*)::int n FROM observations WHERE child_id=$1', [childId]);
        return { child: publicChild(c), sessions: sessions.rows, observations: observations.rows, observationCount: total?.n ?? 0,
          history:{version:'family-history-1' as const,pageSize:HISTORY_PAGE_SIZE,sessions:sessions.page,observations:observations.page} };
      } catch(error) {
        if(error instanceof InvalidHistoryCursor)fail(400,'INVALID_HISTORY_CURSOR','翻页位置已不可用，请重新读取最新记录。');
        throw error;
      }
    },
    async teenStrategyHistory(p: Principal, childId: string, raw: unknown = {}): Promise<TeenStrategyHistory> {
      if (p.scope !== 'child') fail(403, 'CHILD_REQUIRED', '请在孩子空间查看自己的策略记录。');
      const c = await child(db, p, childId);
      if (c.age_band !== '12-14' && c.age_band !== '15-17') fail(403, 'AGE_GROUP_UNAVAILABLE', '此记录入口面向青少年。');
      const input = teenStrategyQuerySchema.parse(raw);
      let boundary: { at: string; id: string } | undefined;
      if (input.cursor) {
        try {
          if (!/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
          const cursor = teenStrategyCursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
          if (cursor.childId !== childId) throw new Error();
          boundary = cursor;
        } catch { fail(400, 'INVALID_HISTORY_CURSOR', '翻页位置已不可用，请重新读取。'); }
      }
      const rows = (await db.query<{ id: string; task: TaskId; created_at: string; closed_reason: string | null; completed: boolean | null }>(`SELECT id,plan->>'task' AS task,closed_reason,(result->>'completed')::boolean AS completed,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
        FROM sessions WHERE child_id=$1 AND result IS NOT NULL
        ${boundary ? 'AND (created_at,id)<($2::timestamptz,$3::uuid)' : ''}
        ORDER BY created_at DESC,id DESC LIMIT ${TEEN_STRATEGY_PAGE_SIZE + 1}`,
      boundary ? [childId,boundary.at,boundary.id] : [childId])).rows;
      const page = rows.slice(0, TEEN_STRATEGY_PAGE_SIZE), last = page.at(-1);
      const nextCursor = rows.length > TEEN_STRATEGY_PAGE_SIZE && last
        ? Buffer.from(JSON.stringify({ v: 1, childId, kind: 'teen-strategy', at: last.created_at, id: last.id })).toString('base64url') : null;
      return { version: 'teen-strategy-history-1', childId, pageSize: TEEN_STRATEGY_PAGE_SIZE,
        items: page.map(row => ({ id: row.id, task: row.task, createdAt: row.created_at,
          status: row.closed_reason === 'device_handover' ? 'previous-device' : row.completed ? 'completed' : 'stopped' })), nextCursor };
    },
    async weekly(p: Principal, childId: string, raw: unknown = {}) {
      parent(p); const input = weeklyQuerySchema.parse(raw), at = now();
      return db.transaction(async tx => {
        // Every collection mutation locks this profile; a report sees one coherent snapshot.
        await child(tx, p, childId, true);
        const family = await one<Family>(tx, 'SELECT timezone FROM families WHERE id=$1', [p.family_id]);
        let range;
        try { range = weekRange(family!.timezone, at, input.weekStart); }
        catch { fail(400, 'INVALID_REPORT_WEEK', '请选择最近 52 周内的周一日期，不能选择未来的一周。'); }
        const bounds = reportQueryBounds(range);
        const sessions = await tx.query<ReportSession>("SELECT id,plan,state,result,created_at,completed_at,closed_reason,continuation_grant->'body'->'windowPolicy' AS window_policy FROM sessions WHERE child_id=$1 AND coalesce(completed_at,created_at)>=$2 AND coalesce(completed_at,created_at)<$3 AND coalesce(completed_at,created_at)<=$4 ORDER BY coalesce(completed_at,created_at),id LIMIT 5001", [childId, bounds.from, bounds.until, new Date(at).toISOString()]);
        const observations = await tx.query<ReportObservation>('SELECT id,task,context,prompts,child_choice,created_at FROM observations WHERE child_id=$1 AND created_at>=$2 AND created_at<$3 AND created_at<=$4 ORDER BY created_at,id LIMIT 5001', [childId, bounds.from, bounds.until, new Date(at).toISOString()]);
        if (sessions.rows.length > 5000 || observations.rows.length > 5000) fail(413, 'REPORT_RANGE_TOO_LARGE', '这个时间段的记录量超过同步回顾上限，请先导出资料查看。');
        return buildWeeklyReport(childId, family!.timezone, at, range, sessions.rows, observations.rows);
      });
    },
    async observe(p: Principal, childId: string, raw: unknown, key: string) {
      parent(p); const input = observationSchema.parse(raw);
      if (!key || key.length < 16 || key.length > 128) fail(400, 'INVALID_IDEMPOTENCY_KEY', '需要有效的请求标识。');
      const requestHash = digest(canonical(input));
      return db.transaction(async tx => {
        const c = await child(tx, p, childId, true);
        if (!collecting(c)) fail(403, 'CONSENT_REVOKED', '此档案已停止采集。');
        const existing = await one<{ id: string; request_hash: string }>(tx, 'SELECT id,request_hash FROM observations WHERE child_id=$1 AND request_key=$2', [childId, key]);
        if (existing) {
          if (existing.request_hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', '重复请求的内容不同。');
          return { id: existing.id };
        }
        const id = randomUUID(); await tx.query('INSERT INTO observations(id,child_id,task,context,prompts,child_choice,created_at,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, childId, input.task, input.context, input.prompts, input.childChoice, new Date(now()).toISOString(), key, requestHash]); return { id };
      });
    },
    async withdraw(p: Principal, childId: string) {
      recentParent(p, now()); await db.transaction(async tx => {
        await child(tx, p, childId, true);
        await tx.query('UPDATE children SET consent_active=false WHERE id=$1', [childId]);
        await life.withdraw(tx, childId);
        await tx.query("UPDATE sessions SET state='revoked',used_ms=budget_ms WHERE child_id=$1 AND state='active'", [childId]);
        await tx.query('DELETE FROM auth_sessions WHERE child_id=$1', [childId]);
        await tx.query('UPDATE local_confirmations SET withdrawn_at=$2 WHERE child_id=$1 AND withdrawn_at IS NULL', [childId, new Date(now()).toISOString()]);
        await tx.query('UPDATE guardian_consents SET withdrawn_at=$2 WHERE child_id=$1 AND withdrawn_at IS NULL', [childId, new Date(now()).toISOString()]);
      }); return { withdrawn: true };
    },
    async deleteChild(p: Principal, childId: string) {
      recentParent(p, now()); await child(db, p, childId);
      await db.query('DELETE FROM children WHERE id=$1 AND family_id=$2', [childId, p.family_id]); return { deleted: true };
    },
    async exportChild(p: Principal, childId: string) {
      recentParent(p, now());
      return db.transaction(async tx => {
        const c = await child(tx, p, childId, true);
        const sessions = await tx.query(`SELECT id,plan,state,result,created_at,completed_at,closed_reason,daily_limit_snapshot,release_scope_identity,
          (SELECT jsonb_build_object('reason','device_handover','actorScope','parent','closedAt',h.created_at) FROM session_handovers h WHERE h.session_id=sessions.id) AS handover,
          CASE WHEN continuation_grant IS NULL THEN NULL ELSE jsonb_build_object(
            'version',continuation_grant->'body'->'version','windowPolicy',continuation_grant->'body'->'windowPolicy',
            'issuedAt',continuation_grant->'body'->'issuedAt','recordUntil',continuation_grant->'body'->'recordUntil',
            'uploadUntil',continuation_grant->'body'->'uploadUntil','maxActiveMs',continuation_grant->'body'->'maxActiveMs',
            'maxEvents',continuation_grant->'body'->'maxEvents','planHash',continuation_grant->'body'->'planHash') END AS authorization
          FROM sessions WHERE child_id=$1 ORDER BY created_at,id`, [childId]);
        const events = await tx.query('SELECT e.session_id AS "sessionId",e.body AS event FROM events e JOIN sessions s ON s.id=e.session_id WHERE s.child_id=$1 ORDER BY s.created_at,s.id,e.seq', [childId]);
        const observations = await tx.query('SELECT id,task,context,prompts,child_choice,created_at FROM observations WHERE child_id=$1 ORDER BY created_at,id', [childId]);
        const confirmations = await tx.query('SELECT purpose,version,acknowledged_at,withdrawn_at FROM local_confirmations WHERE child_id=$1 ORDER BY acknowledged_at', [childId]);
        const verifiedConsents = await tx.query('SELECT provider,country,age_band,locale,purpose,notice_version,notice_sha256,release_scope_identity,verified_at,granted_at,expires_at,withdrawn_at FROM guardian_consents WHERE child_id=$1 ORDER BY granted_at', [childId]);
        const { generatedAt: _generatedAt, ...practiceLimits } = await operations.practiceLimits(p, childId);
        return { schemaVersion: 2, exportedAt: new Date(now()).toISOString(), child: publicChild(c), practiceLimits, sessions: sessions.rows, events: events.rows, observations: observations.rows, confirmations: confirmations.rows, verifiedConsents: verifiedConsents.rows, life: await life.export(tx, childId) };
      });
    },
  };
  // Public authentication methods establish their narrower context above. Every
  // other operation receives a server-authenticated Principal, never body fields.
  const selfScopedMethods = new Set(['setup', 'login', 'join', 'authenticate', 'sessionAuthorities', 'changePassword', 'logoutAll', 'deleteFamily', 'grantGuardianConsent']);
  const ownerMethods = new Set(['billingStatus','addChild','withdraw','deleteChild','exportChild','setPracticeLimit','handover','lifeSpace','lifeHistory','createLifeGoal','actLifeGoal','inviteMember','cancelInvitation','actMember','requestAgeReview','applyAgeReview']);
  const pendingMethods = new Set(['me','logout','accountSecurity','familyMembers']);
  return Object.fromEntries(Object.entries(operations).map(([name, action]) => [name,
    selfScopedMethods.has(name) ? action : (p: Principal, ...args: unknown[]) => authenticated(p, current => {
      if(current.scope==='parent' && current.member_role!=='owner' && ownerMethods.has(name))fail(403,'OWNER_REQUIRED','这项操作需要家庭创建者确认。');
      if(name==='familyMembers')parent(current);
      return Reflect.apply(action, undefined, [current, ...args]);
    },pendingMethods.has(name)),
  ])) as typeof operations;
}
export type FocusService = ReturnType<typeof service>;
