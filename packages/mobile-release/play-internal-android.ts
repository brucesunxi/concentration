import { mobileApiOrigin } from '../contracts/mobile-api-origin.ts';
import { HOSTED_TEST_SERVICE_MARKER } from '../session-runtime/mobile-preview-copy.ts';

export const PLAY_INTERNAL_DISTRIBUTION = 'play-internal';
export const PLAY_INTERNAL_APP_NAME = 'Focus Island Preview';
export const LOCAL_ANDROID_APP_NAME = 'Focus Island Dev';
export const PLAY_INTERNAL_MIN_VERSION_CODE = 18;
export const HOSTED_SERVICE_MARKER = HOSTED_TEST_SERVICE_MARKER;
export const PLAY_INTERNAL_API_AUDIENCE = 'play-internal';
export const PLAY_INTERNAL_UPLOAD_KEY_ALIAS = 'focus-island-upload';
/** Public upload certificate fingerprint. Not a private key. */
export const PLAY_INTERNAL_UPLOAD_CERT_SHA256 = '8471406ac196ee358f777ee2574c86a94d6be86eea0d50fd4e1c242f8f4894fa';
export const PROTECTED_PREVIEW_HOST = 'concentration-two.vercel.app';

const REPO_SIGNING_SETTINGS = [
  'FOCUS_PLAY_UPLOAD_KEYSTORE_BASE64',
  'FOCUS_PLAY_UPLOAD_STORE_PASSWORD',
  'FOCUS_PLAY_UPLOAD_KEY_ALIAS',
  'FOCUS_PLAY_UPLOAD_KEY_PASSWORD',
] as const;

export function playInternalApiOrigin(raw: string | undefined): string {
  const parsed = mobileApiOrigin(raw);
  if (parsed.local || !parsed.origin.startsWith('https://')) throw new Error('PLAY_INTERNAL_HTTPS_API_REQUIRED');
  if (new URL(parsed.origin).hostname === PROTECTED_PREVIEW_HOST) throw new Error('PLAY_INTERNAL_PROTECTED_PREVIEW_FORBIDDEN');
  return parsed.origin;
}

export function playInternalCertificateSha256(raw: string | undefined): string {
  const value = (raw ?? '').trim().toLowerCase().replace(/:/g, '');
  if (!value) return PLAY_INTERNAL_UPLOAD_CERT_SHA256;
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('PLAY_INTERNAL_CERT_SHA256_INVALID');
  if (value !== PLAY_INTERNAL_UPLOAD_CERT_SHA256) throw new Error('PLAY_INTERNAL_CERT_SHA256_MISMATCH');
  return value;
}

function signingMaterial(env: Record<string, string | undefined>, names: readonly string[]): void {
  const missing = names.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`PLAY_INTERNAL_SIGNING_CONFIG_MISSING:${missing.join(',')}`);
  if (env.FOCUS_PLAY_UPLOAD_KEY_ALIAS !== PLAY_INTERNAL_UPLOAD_KEY_ALIAS) throw new Error('PLAY_INTERNAL_KEY_ALIAS_UNEXPECTED');
  if (/[\r\n]/.test(env.FOCUS_PLAY_UPLOAD_STORE_PASSWORD ?? '') || /[\r\n]/.test(env.FOCUS_PLAY_UPLOAD_KEY_PASSWORD ?? '')) {
    throw new Error('PLAY_INTERNAL_SIGNING_SECRET_INVALID');
  }
}

/** Repository settings required before a Play internal workflow may build. Values are never returned. */
export function playInternalPrerequisites(env: Record<string, string | undefined>): { origin: string; certificateSha256: string } {
  if (env.FOCUS_ANDROID_DISTRIBUTION !== PLAY_INTERNAL_DISTRIBUTION) throw new Error('PLAY_INTERNAL_DISTRIBUTION_REQUIRED');
  const origin = playInternalApiOrigin(env.EXPO_PUBLIC_FOCUS_API_ORIGIN);
  const certificateSha256 = playInternalCertificateSha256(env.FOCUS_PLAY_UPLOAD_CERT_SHA256);
  signingMaterial(env, REPO_SIGNING_SETTINGS);
  return { origin, certificateSha256 };
}

export function androidAppIdentity(env: Record<string, string | undefined>): {
  distribution: 'local' | 'play-internal';
  name: string;
  origin: string;
  local: boolean;
} {
  if (env.APP_MODE === 'production') throw new Error('Mobile production release requires approved identity, markets and content.');
  const raw = env.FOCUS_ANDROID_DISTRIBUTION;
  if (raw === undefined || raw === '' || raw === 'local') {
    const api = mobileApiOrigin(env.EXPO_PUBLIC_FOCUS_API_ORIGIN);
    return { distribution: 'local', name: LOCAL_ANDROID_APP_NAME, origin: api.origin, local: api.local };
  }
  if (raw !== PLAY_INTERNAL_DISTRIBUTION) throw new Error('ANDROID_DISTRIBUTION_UNKNOWN');
  const origin = playInternalApiOrigin(env.EXPO_PUBLIC_FOCUS_API_ORIGIN);
  signingMaterial(env, REPO_SIGNING_SETTINGS);
  if (!env.FOCUS_UPLOAD_STORE_FILE?.trim() || /[\r\n]/.test(env.FOCUS_UPLOAD_STORE_FILE)) throw new Error('PLAY_INTERNAL_SIGNING_CONFIG_MISSING:FOCUS_UPLOAD_STORE_FILE');
  return { distribution: 'play-internal', name: PLAY_INTERNAL_APP_NAME, origin, local: false };
}

function previewHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!host || /[\s/?#@\\]/.test(host) || host.includes('://')) throw new Error('PLAY_INTERNAL_PREVIEW_HOST_INVALID');
  return host.split(':')[0];
}

/** Hosts this preview deployment may answer. The protected production alias is never one of them. */
export function playInternalPreviewHosts(values: Array<string | undefined>, productionHost?: string): string[] {
  const production = productionHost?.trim() ? previewHost(productionHost) : undefined;
  const hosts: string[] = [];
  for (const value of values) {
    if (!value?.trim()) continue;
    const host = previewHost(value);
    if (host === PROTECTED_PREVIEW_HOST || (production && host === production)) throw new Error('PLAY_INTERNAL_API_PROTECTED_HOST_FORBIDDEN');
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

export function assertPlayInternalServiceSeparation(input: {
  enabled: string | undefined;
  vercel?: boolean;
  environment?: string;
  servingHosts: Array<string | undefined>;
  productionHost?: string;
}): string[] {
  if (input.enabled !== '1') return [];
  if (input.vercel && input.environment !== 'preview') throw new Error('PLAY_INTERNAL_API_PREVIEW_REQUIRED');
  const hosts = playInternalPreviewHosts(input.servingHosts, input.productionHost);
  if (input.vercel && hosts.length === 0) throw new Error('PLAY_INTERNAL_API_HOST_REQUIRED');
  return hosts;
}

export function playInternalLocalBuildInputs(env: Record<string, string | undefined>): { origin: string; certificateSha256: string; storeFile: string } {
  if (env.FOCUS_ANDROID_DISTRIBUTION !== PLAY_INTERNAL_DISTRIBUTION) throw new Error('PLAY_INTERNAL_DISTRIBUTION_REQUIRED');
  const origin = playInternalApiOrigin(env.EXPO_PUBLIC_FOCUS_API_ORIGIN);
  const certificateSha256 = playInternalCertificateSha256(env.FOCUS_PLAY_UPLOAD_CERT_SHA256);
  const storeFile = env.FOCUS_UPLOAD_STORE_FILE ?? '';
  if (!storeFile.trim() || /[\r\n]/.test(storeFile)) throw new Error('PLAY_INTERNAL_SIGNING_CONFIG_MISSING:FOCUS_UPLOAD_STORE_FILE');
  if (env.FOCUS_PLAY_UPLOAD_KEY_ALIAS !== PLAY_INTERNAL_UPLOAD_KEY_ALIAS) throw new Error('PLAY_INTERNAL_KEY_ALIAS_UNEXPECTED');
  for (const name of ['FOCUS_PLAY_UPLOAD_STORE_PASSWORD', 'FOCUS_PLAY_UPLOAD_KEY_PASSWORD'] as const) {
    const value = env[name] ?? '';
    if (!value.trim()) throw new Error(`PLAY_INTERNAL_SIGNING_CONFIG_MISSING:${name}`);
    if (/[\r\n]/.test(value)) throw new Error('PLAY_INTERNAL_SIGNING_SECRET_INVALID');
  }
  return { origin, certificateSha256, storeFile };
}

const CONTENT_ASSET_PATH = /^\/content-assets\/[a-f0-9]{64}\.(png|mp3)$/;

/** Routes a Play internal preview may answer. Everything else is the website, studio, or admin surface. */
export function playInternalPreviewPath(pathname: string): 'allow' | 'deny' {
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')) return 'deny';
  const path = pathname.toLowerCase();
  if (path === '/api/health' || path === '/api/ready') return 'allow';
  if (path.startsWith('/api/studio') || path.startsWith('/api/admin') || path.startsWith('/api/support')) return 'deny';
  if (path.startsWith('/api/')) return 'allow';
  if (CONTENT_ASSET_PATH.test(pathname)) return 'allow';
  return 'deny';
}

export function playInternalEdgeDecision(input: { enabled: string | undefined; environment: string | undefined; pathname: string }): { action: 'continue' | 'deny'; apiOnly: boolean; status?: 404; code?: 'PLAY_INTERNAL_API_ONLY' } {
  const apiOnly = input.enabled === '1' && input.environment !== 'production';
  if (!apiOnly) return { action: 'continue', apiOnly: false };
  if (playInternalPreviewPath(input.pathname) === 'allow') return { action: 'continue', apiOnly: true };
  return { action: 'deny', apiOnly: true, status: 404, code: 'PLAY_INTERNAL_API_ONLY' };
}

/** One non-page file. Vercel rejects an empty output directory; this is not a website entry. */
export const PLAY_INTERNAL_OUTPUT_FILE = 'play-internal-api-only.json';
export const PLAY_INTERNAL_OUTPUT_BODY = '{"code":"PLAY_INTERNAL_API_ONLY"}\n';

export type DeploymentResponse =
  | { layer: 'middleware'; status: 404; code: 'PLAY_INTERNAL_API_ONLY'; contentType: 'application/json' }
  | { layer: 'filesystem'; file: string }
  | { layer: 'rewrite'; destination: string }
  | { layer: 'platform-missing'; destination: '/index.html' };

/** Vercel path patterns used by this repo: an exact path, or a prefix plus `/:path*`. */
export function vercelSourceMatches(source: string, pathname: string): boolean {
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.includes('//')) return false;
  if (source === pathname) return true;
  const wildcard = '/:path*';
  if (!source.endsWith(wildcard)) return false;
  const prefix = source.slice(0, source.length - wildcard.length);
  if (prefix === '') return true;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Vercel serves middleware, then an existing output file (including `index.html` for `/`), then the first rewrite.
 * A rewrite to a missing `/index.html` stops there; it does not chain into another rewrite.
 */
export function resolveDeploymentRequest(input: {
  pathname: string;
  apiOnly: boolean;
  outputFiles: readonly string[];
  rewrites: readonly { source: string; destination: string }[];
  middleware?: boolean;
}): DeploymentResponse {
  if (input.middleware !== false && input.apiOnly) {
    const decision = playInternalEdgeDecision({ enabled: '1', environment: 'preview', pathname: input.pathname });
    if (decision.action === 'deny') return { layer: 'middleware', status: 404, code: 'PLAY_INTERNAL_API_ONLY', contentType: 'application/json' };
  }
  const relative = input.pathname === '/' ? 'index.html' : input.pathname.slice(1);
  if (relative && !relative.split('/').includes('..') && input.outputFiles.includes(relative)) return { layer: 'filesystem', file: relative };
  for (const rule of input.rewrites) {
    if (!vercelSourceMatches(rule.source, input.pathname)) continue;
    if (rule.destination === '/index.html' && !input.outputFiles.includes('index.html')) return { layer: 'platform-missing', destination: '/index.html' };
    return { layer: 'rewrite', destination: rule.destination };
  }
  return { layer: 'platform-missing', destination: '/index.html' };
}

export function familyPreviewStatus(version: string, releaseScopeVersion: string, env: { FOCUS_PLAY_INTERNAL_API?: string } = {}): {
  status: 'ok'; mode: 'local-development'; version: string; releaseScopeVersion: string; audience?: typeof PLAY_INTERNAL_API_AUDIENCE;
} {
  const status = { status: 'ok' as const, mode: 'local-development' as const, version, releaseScopeVersion };
  if (env.FOCUS_PLAY_INTERNAL_API === '1') return { ...status, audience: PLAY_INTERNAL_API_AUDIENCE };
  return status;
}

export function assessPlayInternalHealth(input: { httpStatus: number; redirected: boolean; body: unknown }): { mode: 'local-development'; audience: typeof PLAY_INTERNAL_API_AUDIENCE } {
  if (input.redirected || input.httpStatus !== 200) throw new Error('PLAY_INTERNAL_API_UNREACHABLE');
  if (!input.body || typeof input.body !== 'object' || Array.isArray(input.body)) throw new Error('PLAY_INTERNAL_API_HEALTH_INVALID');
  const body = input.body as { status?: unknown; mode?: unknown; audience?: unknown };
  if (body.status !== 'ok' || body.mode !== 'local-development' || body.audience !== PLAY_INTERNAL_API_AUDIENCE) throw new Error('PLAY_INTERNAL_API_HEALTH_INVALID');
  return { mode: 'local-development', audience: PLAY_INTERNAL_API_AUDIENCE };
}

export function assertPlayInternalHealthReport(value: unknown, origin: string): { origin: string; httpStatus: 200; mode: 'local-development'; audience: typeof PLAY_INTERNAL_API_AUDIENCE; ready: true; redirected: false } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PLAY_INTERNAL_API_HEALTH_INVALID');
  const report = value as { origin?: unknown; httpStatus?: unknown; mode?: unknown; audience?: unknown; ready?: unknown; redirected?: unknown };
  if (report.origin !== origin || report.httpStatus !== 200 || report.mode !== 'local-development' || report.audience !== PLAY_INTERNAL_API_AUDIENCE || report.ready !== true || report.redirected !== false) {
    throw new Error('PLAY_INTERNAL_API_HEALTH_INVALID');
  }
  return { origin, httpStatus: 200, mode: 'local-development', audience: PLAY_INTERNAL_API_AUDIENCE, ready: true, redirected: false };
}

export function assertPlayInternalSigner(signer: string, certificateSha256: string, expectedCertificateSha256: string): void {
  if (signer.includes('CN=Android Debug') || signer.includes('CN=Android Debug,')) throw new Error('PLAY_INTERNAL_DEBUG_SIGNER_REJECTED');
  if (!/^[a-f0-9]{64}$/.test(certificateSha256) || certificateSha256 !== expectedCertificateSha256) throw new Error('PLAY_INTERNAL_CERT_MISMATCH');
}

function encoded(value: string, utf16: boolean): Uint8Array {
  if (!utf16) return new TextEncoder().encode(value);
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }
  return bytes;
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) { matched = false; break; }
    }
    if (matched) return true;
  }
  return false;
}

export function bundleHasText(bundle: Uint8Array, value: string): boolean {
  return containsBytes(bundle, encoded(value, false)) || containsBytes(bundle, encoded(value, true));
}

/** Fail if a long signing value was copied into an artifact. The error never includes the value. */
export function assertSecretsNotPackaged(bytes: Uint8Array, secrets: Array<string | undefined>): void {
  for (const secret of secrets) {
    const value = secret?.trim();
    if (!value || value.length < 12) continue;
    if (containsBytes(bytes, encoded(value, false))) throw new Error('PLAY_INTERNAL_SECRET_PACKAGED');
  }
}

export function assertPlayInternalBundle(bundle: Uint8Array, origin: string): void {
  if (!bundleHasText(bundle, origin)) throw new Error('PLAY_INTERNAL_API_ORIGIN_NOT_PACKAGED');
  if (bundleHasText(bundle, 'http://localhost:4181')) throw new Error('PLAY_INTERNAL_LOCALHOST_PACKAGED');
  if (!bundleHasText(bundle, HOSTED_SERVICE_MARKER)) throw new Error('PLAY_INTERNAL_PREVIEW_COPY_MISSING');
  for (const marker of ['local-development', 'guardian-verification-required', 'You decide whether to begin', 'Not taking part now']) {
    if (!bundleHasText(bundle, marker)) throw new Error(`PLAY_INTERNAL_MARKER_MISSING:${marker}`);
  }
}

export function assertPlayInternalManifest(manifest: {
  debuggable: boolean;
  allowBackup: string | null;
  usesCleartextTraffic: string | null;
  versionCode: number;
  targetSdkVersion: number | null;
}): void {
  if (manifest.debuggable) throw new Error('PLAY_INTERNAL_DEBUGGABLE');
  if (manifest.allowBackup !== 'false') throw new Error('PLAY_INTERNAL_BACKUP_ENABLED');
  if (manifest.usesCleartextTraffic !== 'false') throw new Error('PLAY_INTERNAL_CLEARTEXT_ENABLED');
  if (!Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < PLAY_INTERNAL_MIN_VERSION_CODE) throw new Error('PLAY_INTERNAL_VERSION_CODE_TOO_LOW');
  if (manifest.targetSdkVersion === null || manifest.targetSdkVersion < 35) throw new Error('PLAY_INTERNAL_TARGET_SDK_TOO_LOW');
}
