import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const methods = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS']);
const responseCodes = new Set([
  'UNAUTHENTICATED', 'PARENT_REQUIRED', 'OWNER_REQUIRED', 'MEMBER_PENDING', 'LOGIN_FAILED', 'ACCOUNT_LOCKED',
  'RATE_LIMITED', 'HOST_REJECTED', 'ORIGIN_REJECTED', 'CSRF_REJECTED', 'TRANSPORT_REJECTED', 'NATIVE_REQUEST_REJECTED',
  'JSON_REQUIRED', 'INVALID_JSON', 'INVALID_REQUEST', 'PAYLOAD_TOO_LARGE', 'METHOD_NOT_ALLOWED', 'NOT_FOUND', 'INVALID_EVENT',
  'MARKET_NOT_OPEN', 'MARKET_SCOPE_CHANGED', 'CONSENT_REVOKED', 'AGE_REVIEW_REQUIRED', 'SESSION_CONFLICT',
  'PRACTICE_PLAN_CHANGED', 'PRACTICE_REVIEW_REQUIRED', 'PRACTICE_PAUSED', 'DAILY_LIMIT', 'LIMIT_VERSION_CONFLICT', 'LIMIT_DAY_CHANGED',
  'ENTITLEMENT_REQUIRED', 'ENTITLEMENT_UNAVAILABLE', 'DATABASE_NOT_READY', 'WEB_RELEASE_UNAVAILABLE', 'NOT_BUILT',
  'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE',
]);
const directRoutes = new Set([
  '/api/health', '/api/ready', '/api/me', '/api/auth/setup', '/api/auth/login', '/api/auth/join', '/api/auth/logout',
  '/api/auth/change-password', '/api/auth/logout-all', '/api/account/security', '/api/family', '/api/family/billing',
  '/api/family/members', '/api/family/invitations', '/api/session-authorities', '/api/content/trust', '/api/children', '/api/sessions/active',
]);
const childOperations = new Set(['enter', 'sessions', 'report', 'strategy-history', 'weekly', 'observations', 'withdraw', 'export', 'parent-guide', 'practice-limits', 'age-review', 'recovery', 'life-goals']);
const safeCategories = new Set([
  ...directRoutes, ...[...childOperations].map(operation => '/api/children/:childId/' + operation),
  '/api/children/:childId', '/api/children/:childId/age-review/apply', '/api/children/:childId/life-goals/history',
  '/api/children/:childId/life-goals/:goalId', '/api/children/:childId/recovery/:sessionId/handover',
  '/api/children/:childId/recovery/:sessionId/resume', '/api/family/members/:id', '/api/family/invitations/:id',
  '/api/sessions/:sessionId/status', '/api/sessions/:sessionId/events', '/api/sessions/:sessionId/finalize',
  '/api/content/releases/:sha256', 'unknown-api', 'content-asset', 'media', 'web', 'malformed',
]);
export function isFamilyRouteCategory(value: unknown): value is string {
  return typeof value === 'string' && safeCategories.has(value);
}

/** Only fixed route categories can reach a log, including unknown or malformed URLs. */
export function familyRouteCategory(rawUrl: string | undefined): string {
  let path: string;
  try { path = new URL(rawUrl || '/', 'http://request.invalid').pathname; } catch { return 'malformed'; }
  if (directRoutes.has(path)) return path;
  const child = path.match(/^\/api\/children\/[a-f0-9-]{36}(?:\/([a-z-]+))?$/);
  if (child && (!child[1] || childOperations.has(child[1]))) return '/api/children/:childId' + (child[1] ? '/' + child[1] : '');
  if (/^\/api\/children\/[a-f0-9-]{36}\/age-review\/apply$/.test(path)) return '/api/children/:childId/age-review/apply';
  if (/^\/api\/children\/[a-f0-9-]{36}\/life-goals\/history$/.test(path)) return '/api/children/:childId/life-goals/history';
  if (/^\/api\/children\/[a-f0-9-]{36}\/life-goals\/[a-f0-9-]{36}$/.test(path)) return '/api/children/:childId/life-goals/:goalId';
  const recovery = path.match(/^\/api\/children\/[a-f0-9-]{36}\/recovery\/[a-f0-9-]{36}\/(handover|resume)$/);
  if (recovery) return '/api/children/:childId/recovery/:sessionId/' + recovery[1];
  const member = path.match(/^\/api\/family\/(members|invitations)\/[a-f0-9-]{36}$/);
  if (member) return '/api/family/' + member[1] + '/:id';
  const session = path.match(/^\/api\/sessions\/[a-f0-9-]{36}\/(status|events|finalize)$/);
  if (session) return '/api/sessions/:sessionId/' + session[1];
  if (/^\/api\/content\/releases\/[a-f0-9]{64}$/.test(path)) return '/api/content/releases/:sha256';
  if (path.startsWith('/api/')) return 'unknown-api';
  if (path.startsWith('/content-assets/')) return 'content-asset';
  if (path.startsWith('/media/')) return 'media';
  return 'web';
}

export interface RequestObservation {
  readonly requestId: string;
  setVersion(version: string): void;
  setFailure(code: unknown): void;
  runtimeReady(): void;
}
export interface RequestObservationOptions {
  enabled: boolean; errorsOnly?: boolean; source: 'standalone' | 'vercel'; now?: () => number; write?: (line: string) => void;
}
const observations = new WeakMap<ServerResponse, RequestObservation>();
export function familyRequestLoggingEnabled(serverless: boolean) {
  return serverless ? process.env.FOCUS_HTTP_LOGS !== '0' : process.env.FOCUS_HTTP_LOGS === '1';
}

/** No body, identity, raw URL, query, headers, exception text or stack is retained. */
export function observeFamilyRequest(req: IncomingMessage, res: ServerResponse, options: RequestObservationOptions): RequestObservation {
  const existing = observations.get(res); if (existing) return existing;
  const requestId = randomUUID(), now = options.now ?? (() => performance.now()), started = now();
  const route = familyRouteCategory(req.url), method = methods.has(req.method || '') ? req.method! : 'OTHER';
  const transport = req.headers['x-focus-client'] === 'native-local-v1' ? 'native' : 'web';
  let done = false, version: string | null = null, errorCode: string | null = null, runtimeWaitMs: number | null = null;
  const elapsed = () => { const n = now() - started; return Number.isFinite(n) ? Math.round(Math.min(86400000, Math.max(0, n))) : 0; };
  const observation: RequestObservation = {
    requestId,
    setVersion(value) { version = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) ? value : null; },
    setFailure(code) { errorCode = typeof code === 'string' && responseCodes.has(code) ? code : null; },
    runtimeReady() { if (runtimeWaitMs === null) runtimeWaitMs = elapsed(); },
  };
  observations.set(res, observation);
  res.setHeader('X-Request-ID', requestId);
  function complete(aborted: boolean) {
    if (done) return; done = true;
    res.removeListener('finish', finished); res.removeListener('close', closed);
    const status = res.headersSent ? res.statusCode : null;
    const outcome = aborted ? 'aborted' : (status ?? 500) >= 500 ? 'error' : (status ?? 500) >= 400 ? 'rejected' : 'ok';
    if ((!options.enabled && !(options.errorsOnly && ['error', 'aborted'].includes(outcome))) || (!aborted && ['web', 'content-asset', 'media'].includes(route) && status !== null && status < 400)) return;
    const event = {
      event: 'FAMILY_HTTP_REQUEST', schemaVersion: 1, timestamp: new Date().toISOString(), requestId, source: options.source,
      version, method, route, transport, status, outcome, durationMs: elapsed(), runtimeWaitMs,
      code: outcome === 'aborted' ? 'REQUEST_ABORTED' : outcome === 'ok' ? null : errorCode ?? (outcome === 'error' ? 'REQUEST_FAILED' : 'REQUEST_REJECTED'),
    };
    // Logging failure cannot change an already completed family operation.
    try { (options.write ?? (outcome === 'error' ? console.error : console.log))(JSON.stringify(event)); } catch { /* Operational sink unavailable. */ }
  }
  function finished() { complete(false); }
  function closed() { complete(!res.writableFinished); }
  res.once('finish', finished); res.once('close', closed);
  return observation;
}
