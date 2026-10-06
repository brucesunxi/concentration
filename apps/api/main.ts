import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import { openDatabase, migrate } from './database.ts';
import { service, ApiError } from './service.ts';
import { ProtocolError } from '../../packages/task-engine/index.ts';
import { createLocalContent } from './content.ts';
import { ContentError } from '../../packages/content/index.ts';
import { emptyActionSchema } from '../../packages/contracts/index.ts';
import { createSessionAuthority } from './session-authority.ts';
import { startStudioServer } from './studio-http.ts';
import { createWebReleaseReader } from '../../packages/web-release/index.ts';
import { verifyRuntimeRole } from './family-isolation.ts';
import { databaseReady } from './readiness.ts';
import { localReleaseScope } from './release-scope.ts';
import { authClientFingerprint, authClientIp, authRateKind, takeAuthSlot } from './auth-rate-limit.ts';
import { databaseEntitlementReader } from './billing-access.ts';
import { requestQuery } from './request-query.ts';
import { observeFamilyRequest, familyRequestLoggingEnabled } from './request-observation.ts';
import { deliverChildExportFile } from './export-file.ts';

export async function createFamilyServer(options: { serverless?: boolean } = {}) {
if (process.env.APP_MODE === 'production') throw new Error('Production release remains gated: verified guardian consent, OIDC, regional review, and operational validation are not yet complete.');
if (options.serverless && (!process.env.DATABASE_URL || !process.env.FOCUS_SESSION_SIGNING_JWK || process.env.VERCEL !== '1')) throw new Error('VERCEL_RUNTIME_CONFIG_REQUIRED');
const root = resolve(import.meta.dirname, '../..');
const sourceVersion = (JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as { version: string }).version;
const readWeb = createWebReleaseReader(resolve(process.env.FOCUS_WEB_RELEASE_DIR || resolve(root, 'dist/web-releases')), resolve(root, 'dist/web'));
const dataDir = process.env.FOCUS_DATA_DIR || resolve(root, '.focus-data');
const postgres = !!process.env.DATABASE_URL;
const db = await openDatabase(resolve(dataDir, 'postgres'), process.env.DATABASE_URL);
if (postgres) await verifyRuntimeRole(db, 'family'); else await migrate(db);
const content = await createLocalContent(db, { dataDir, readOnly: postgres });
const authority = await createSessionAuthority(db, { dataDir: options.serverless ? undefined : dataDir, readOnly: postgres });
const authRateSecret = process.env.FOCUS_SESSION_SIGNING_JWK || await readFile(resolve(dataDir, 'session-signing.jwk.json'), 'utf8');
const api = service(db, Date.now, content, authority, localReleaseScope, undefined, databaseEntitlementReader());
const port = Number(process.env.API_PORT || 4181);
const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:4180', 'http://localhost:4180']);
const vercelHosts = options.serverless ? [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter((host): host is string => !!host) : [];
for (const host of vercelHosts) allowedOrigins.add(`https://${host}`);
const allowedHosts = options.serverless ? vercelHosts : ['127.0.0.1', 'localhost'];
async function body(req: http.IncomingMessage) {
  const chunks: Buffer[] = []; let length = 0;
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED', '请使用 JSON 请求。');
  for await (const chunk of req) { length += chunk.length; if (length > 262144) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求过大。'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'INVALID_JSON', '请求格式不正确。'); }
}
function cookie(value: string, child = false) { return `focus_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${child ? 86400 : 28800}${options.serverless ? '; Secure' : ''}`; }
const equal = (a: string, b: string) => { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
const server = http.createServer(async (req, res) => {
  const observation = observeFamilyRequest(req, res, { enabled: familyRequestLoggingEnabled(!!options.serverless), errorsOnly: !options.serverless && process.env.FOCUS_HTTP_LOGS !== '0', source: options.serverless ? 'vercel' : 'standalone' });
  observation.setVersion(sourceVersion);
  const requestId = observation.requestId;
  res.setHeader('X-Request-ID', requestId); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
  const json = (data: unknown, status = 200) => { if (status >= 400) observation.setFailure((data as { code?: unknown })?.code); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`), method = req.method || 'GET';
    const hostname = (req.headers.host || '').split(':')[0];
    if (!allowedHosts.includes(hostname)) throw new ApiError(403, 'HOST_REJECTED', '不允许此主机。');
    if (!url.pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') throw new ApiError(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
      if (url.pathname.startsWith('/content-assets/')) {
        const asset = await content.readMedia(url.pathname,true);
        if (!asset) throw new ApiError(404, 'NOT_FOUND', '未找到素材。');
        res.writeHead(200, { 'Content-Type': asset.mime, 'Cache-Control': 'no-store' }); res.end(method === 'HEAD' ? undefined : asset.body); return;
      }
      const media = url.pathname.match(/^\/media\/([a-z0-9-]+\.mp3)$/);
      let asset;
      try { asset = media ? { bytes: await readFile(resolve(root, 'src/audio', media[1])), mime: 'audio/mpeg', cacheControl: 'no-store', release: undefined } : await readWeb(url.pathname); }
      catch { throw new ApiError(503, 'WEB_RELEASE_UNAVAILABLE', '页面文件暂时不可用，已保存的记录仍会保留。'); }
      if (!asset) throw new ApiError(404, 'NOT_FOUND', '未找到页面。');
      if (asset.release) res.setHeader('X-Focus-Web-Release', asset.release);
      res.writeHead(200, { 'Content-Type': asset.mime, 'Cache-Control': asset.cacheControl, 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" }); res.end(method === 'HEAD' ? undefined : asset.bytes); return;
    }
    if (method === 'GET' && url.pathname === '/api/health') { json({ status: 'ok', mode: 'local-development', version: sourceVersion, releaseScopeVersion: localReleaseScope.version }); return; }
    if (method === 'GET' && url.pathname === '/api/ready') {
      if (!await databaseReady(db)) { json({ status: 'unavailable', code: 'DATABASE_NOT_READY', requestId }, 503); return; }
      json({ status: 'ok', mode: 'local-development', version: sourceVersion, releaseScopeVersion: localReleaseScope.version }); return;
    }
    const native = req.headers['x-focus-client'] === 'native-local-v1';
    if (native && (req.headers.origin || req.headers.cookie)) throw new ApiError(403, 'NATIVE_REQUEST_REJECTED', '原生请求不能混用浏览器身份。');
    if (!native && req.headers.authorization) throw new ApiError(403, 'TRANSPORT_REJECTED', '此身份只能通过其原有客户端使用。');
    if (method !== 'GET' && !native) {
      const origin = req.headers.origin;
      if (!origin || !allowedOrigins.has(origin)) throw new ApiError(403, 'ORIGIN_REJECTED', '请求来源未获允许。');
    }
    const authKind = authRateKind(url.pathname);
    if (authKind && method === 'POST') {
      const fingerprint = authClientFingerprint(authRateSecret, authClientIp(req, !!options.serverless));
      if (!await takeAuthSlot(db, authKind, fingerprint)) throw new ApiError(429, 'RATE_LIMITED', '尝试过于频繁，请稍后再试。');
      const raw = await body(req), transport = native ? 'native' : 'web';
      const auth = url.pathname.endsWith('setup') ? await api.setup(raw, transport) : url.pathname.endsWith('join') ? await api.join(raw, transport) : await api.login(raw, transport);
      if (native) json({ accessToken: auth.value, tokenType: 'Bearer', mode: 'local-development' });
      else { res.setHeader('Set-Cookie', cookie(auth.value)); json({ csrf: auth.csrf }); }
      return;
    }
    const rawCookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('focus_session='))?.slice(14);
    const bearer = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const principal = await api.authenticate(native ? bearer : rawCookie, native ? 'native' : 'web');
    if (!principal) throw new ApiError(401, 'UNAUTHENTICATED', '请登录家庭空间。');
    if (method !== 'GET' && !native && !equal(String(req.headers['x-csrf-token'] || ''), principal.csrf)) throw new ApiError(403, 'CSRF_REJECTED', '验证已过期，请刷新后再试。');
    if (url.pathname === '/api/me' && method === 'GET') { json(await api.me(principal)); return; }
    if (url.pathname === '/api/family/billing' && method === 'GET') { json(await api.billingStatus(principal)); return; }
    if (url.pathname === '/api/family/members' && method === 'GET') { json(await api.familyMembers(principal)); return; }
    if (url.pathname === '/api/family/invitations' && method === 'POST') { json(await api.inviteMember(principal, await body(req), String(req.headers['idempotency-key'] || '')),201); return; }
    const memberRoute=url.pathname.match(/^\/api\/family\/(members|invitations)\/([a-f0-9-]{36})$/);
    if(memberRoute && method==='POST') {
      json(memberRoute[1]==='members' ? await api.actMember(principal,memberRoute[2],await body(req),req.headers['if-match']) : await api.cancelInvitation(principal,memberRoute[2],await body(req)));return;
    }
    if (url.pathname === '/api/account/security' && method === 'GET') { json(await api.accountSecurity(principal)); return; }
    if (['/api/auth/change-password', '/api/auth/logout-all'].includes(url.pathname) && method === 'POST') {
      const result = url.pathname.endsWith('change-password') ? await api.changePassword(principal, await body(req)) : await api.logoutAll(principal, await body(req));
      if (!native) res.setHeader('Set-Cookie', cookie('', false).replace(/Max-Age=\d+/, 'Max-Age=0'));
      json(result); return;
    }
    if (url.pathname === '/api/family' && method === 'DELETE') {
      const result = await api.deleteFamily(principal, await body(req));
      if (!native) res.setHeader('Set-Cookie', cookie('', false).replace(/Max-Age=\d+/, 'Max-Age=0'));
      json(result); return;
    }
    if (url.pathname === '/api/session-authorities' && method === 'GET') { json({ mode: 'local-development', keys: await api.sessionAuthorities() }); return; }
    const statusRoute = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})\/status$/);
    if (statusRoute && method === 'GET') { json(await api.sessionStatus(principal, statusRoute[1])); return; }
    if (url.pathname === '/api/content/trust' && method === 'GET') { json({ mode: 'local-development', keys: await content.trust() }); return; }
    const contentRoute = url.pathname.match(/^\/api\/content\/releases\/([a-f0-9]{64})$/);
    if (contentRoute && method === 'GET') { json(await content.get(contentRoute[1])); return; }
    if (url.pathname === '/api/auth/logout' && method === 'POST') { await api.logout(principal); if (!native) res.setHeader('Set-Cookie', cookie('', false).replace(/Max-Age=\d+/, 'Max-Age=0')); json({ ok: true }); return; }
    if (url.pathname === '/api/children' && method === 'POST') { json(await api.addChild(principal, await body(req)), 201); return; }
    if (url.pathname === '/api/sessions/active' && method === 'GET') { json(await api.active(principal)); return; }
    const recoveryRoute = url.pathname.match(/^\/api\/children\/([a-f0-9-]{36})\/recovery(?:\/([a-f0-9-]{36})\/(handover|resume))?$/);
    if (recoveryRoute && method === 'POST') {
      const [,childId,id,action] = recoveryRoute;
      if (!id) { json(await api.recoverySpace(principal,childId,await body(req))); return; }
      if (action === 'handover') { json(await api.handover(principal,childId,id,await body(req),req.headers['if-match'],String(req.headers['idempotency-key'] ?? ''))); return; }
      const r=await api.recover(principal,childId,id,await body(req));
      if (native) json({...r.session,accessToken:r.auth.value}); else { res.setHeader('Set-Cookie',cookie(r.auth.value,true)); json({...r.session,csrf:r.auth.csrf}); }
      return;
    }
    const guideRoute = url.pathname.match(/^\/api\/children\/([a-f0-9-]{36})\/parent-guide$/);
    if (guideRoute && method === 'GET') { json(await api.parentGuide(principal, guideRoute[1])); return; }
    const limitRoute = url.pathname.match(/^\/api\/children\/([a-f0-9-]{36})\/practice-limits$/);
    if (limitRoute && method === 'GET') { json(await api.practiceLimits(principal, limitRoute[1])); return; }
    if (limitRoute && method === 'PATCH') { json(await api.setPracticeLimit(principal, limitRoute[1], await body(req), req.headers['if-match'])); return; }
    const pauseTodayRoute = url.pathname.match(/^\/api\/children\/([a-f0-9-]{36})\/practice-limits\/pause-today$/);
    if (pauseTodayRoute && method === 'POST') { json(await api.pausePracticeToday(principal, pauseTodayRoute[1], await body(req), req.headers['if-match'])); return; }
    const ageReviewRoute = url.pathname.match(/^\/api\/children\/([a-f0-9-]{36})\/age-review(?:\/(apply))?$/);
    if (ageReviewRoute) {
      const [,id,action]=ageReviewRoute;
      if(!action && method==='GET'){json(await api.ageReviewSpace(principal,id));return;}
      if(!action && method==='POST'){json(await api.requestAgeReview(principal,id,await body(req),req.headers['if-match'],String(req.headers['idempotency-key']??'')));return;}
      if(action==='apply' && method==='POST'){json(await api.applyAgeReview(principal,id,await body(req),req.headers['if-match']));return;}
    }
    const goalHistoryRoute = url.pathname.match(/^\/api\/children\/([a-f0-9-]{36})\/life-goals\/history$/);
    if (goalHistoryRoute && method === 'GET') {
      json(await api.lifeHistory(principal, goalHistoryRoute[1], requestQuery(url, options.serverless))); return;
    }
    const goalRoute = url.pathname.match(/^\/api\/children\/([a-f0-9-]{36})\/life-goals(?:\/([a-f0-9-]{36}))?$/);
    if (goalRoute) {
      const [, childId, goalId] = goalRoute;
      if (!goalId && method === 'GET') { json(await api.lifeSpace(principal, childId)); return; }
      if (!goalId && method === 'POST') { json(await api.createLifeGoal(principal, childId, await body(req), String(req.headers['idempotency-key'] ?? '')), 201); return; }
      if (goalId && method === 'PATCH') { json(await api.actLifeGoal(principal, childId, goalId, await body(req), req.headers['if-match'], String(req.headers['idempotency-key'] ?? ''))); return; }
    }
    const childRoute = url.pathname.match(/^\/api\/children\/([a-f0-9-]{36})(?:\/(enter|sessions|report|strategy-history|weekly|observations|withdraw|export))?$/);
    if (childRoute) {
      const [, id, operation] = childRoute;
      if (operation === 'enter' && method === 'POST') {
        emptyActionSchema.parse(await body(req)); const r = await api.enterChild(principal, id);
        if (native) json({ child: r.child, accessToken: r.auth.value }); else { res.setHeader('Set-Cookie', cookie(r.auth.value, true)); json({ child: r.child, csrf: r.auth.csrf }); } return;
      }
      if (operation === 'sessions' && method === 'POST') { const r = await api.start(principal, id, await body(req), String(req.headers['idempotency-key'] || '')); if (native) json({ ...r.session, accessToken: r.auth.value }, 201); else { res.setHeader('Set-Cookie', cookie(r.auth.value, true)); json({ ...r.session, csrf: r.auth.csrf }, 201); } return; }
      if (operation === 'report' && method === 'GET') {
        json(await api.report(principal, id, requestQuery(url, options.serverless))); return;
      }
      if (operation === 'strategy-history' && method === 'GET') {
        json(await api.teenStrategyHistory(principal, id, requestQuery(url, options.serverless))); return;
      }
      if (operation === 'weekly' && method === 'GET') {
        json(await api.weekly(principal, id, requestQuery(url, options.serverless))); return;
      }
      if (operation === 'observations' && method === 'POST') { json(await api.observe(principal, id, await body(req), String(req.headers['idempotency-key'] ?? '')), 201); return; }
      if (operation === 'withdraw' && method === 'POST') { json(await api.withdraw(principal, id)); return; }
      if (operation === 'export' && method === 'GET') { await deliverChildExportFile(res, write => api.exportChildToSink(principal, id, write)); return; }
      if (!operation && method === 'DELETE') { json(await api.deleteChild(principal, id)); return; }
    }
    const eventRoute = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})\/(events|finalize)$/);
    if (eventRoute && method === 'POST') { json(eventRoute[2] === 'events' ? await api.append(principal, eventRoute[1], await body(req)) : await api.finalize(principal, eventRoute[1], await body(req))); return; }
    throw new ApiError(404, 'NOT_FOUND', '未找到接口。');
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    if (error instanceof ApiError) json({ code: error.code, message: error.message, details: error.details, requestId }, error.status);
    else if (error instanceof ZodError) json({ code: 'INVALID_REQUEST', message: '请检查填写内容和字段格式。', requestId }, 400);
    else if (error instanceof ProtocolError) json({ code: error.code, message: error.message, requestId }, 422);
    else if (error instanceof ContentError) json({ code: error.code, message: '这份练习内容暂时不可用，已停止继续使用。请回到家庭空间。', requestId }, 409);
    else if ((error as { code?: string }).code === 'ENOENT') json({ code: 'NOT_BUILT', message: '请先构建应用，或使用本地开发地址。', requestId }, 404);
    else json({ code: 'INTERNAL_ERROR', message: '暂时无法完成，请重试。', requestId }, 500);
  }
});
server.requestTimeout = 15000; server.headersTimeout = 10000;
const studioPort=options.serverless ? 0 : Number(process.env.STUDIO_PORT??(postgres?0:port+3));
if(postgres && studioPort && !process.env.FOCUS_STUDIO_DATABASE_URL) throw new Error('DATABASE_STUDIO_ROLE_REQUIRED');
const studioDb = postgres && studioPort ? await openDatabase('memory://', process.env.FOCUS_STUDIO_DATABASE_URL) : db;
if(postgres && studioPort) await verifyRuntimeRole(studioDb,'studio');
const studioContent = postgres && studioPort ? await createLocalContent(studioDb,{readOnly:true,delegatedRecall:true}) : content;
const studioServer=studioPort?await startStudioServer(studioDb,studioContent,dataDir,studioPort):null;
if (!options.serverless) server.listen(port, '127.0.0.1', () => console.log(`专注岛家庭服务 http://127.0.0.1:${port} · 本地开发模式`));
let stopping=false;
async function shutdown() { if(stopping)return;stopping=true;await Promise.all([server,studioServer].filter(Boolean).map(s=>new Promise<void>(resolve=>s!.close(()=>resolve()))));if(studioDb!==db)await studioDb.close();await db.close();process.exit(0); }
if (!options.serverless) { process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown); }
return { server, shutdown };
}
if (import.meta.main) await createFamilyServer();
