import type { AgeBand, Locale } from '../../packages/task-engine/index.ts';
import { createHash } from 'node:crypto';

export type ReleasePlatform = 'web' | 'ios' | 'android';
export type ResidenceCountry = string;
export interface ReleaseRule {
  country: ResidenceCountry;
  ageBand: AgeBand;
  locale: Locale;
  platform: ReleasePlatform;
  purpose: 'family-practice';
  access: 'open-pilot' | 'family-entitlement';
  consentNotice: { version: string; sha256: string };
  approvals: { product: string; legal: string; security: string };
}
export interface ReleaseManifest { version: string; rules: ReleaseRule[] }

const countries = /^[A-Z]{2}$/;
const ages = new Set<AgeBand>(['6-8', '9-11', '12-14', '15-17']);
const locales = new Set<Locale>(['zh-CN', 'en']);
const platforms = new Set<ReleasePlatform>(['web', 'ios', 'android']);
const ruleKey = (r: ReleaseRule) => [r.country, r.ageBand, r.locale, r.platform, r.purpose].join(':');

// A manifest is operational configuration, not a legal determination. An
// empty manifest is safe: no family may enroll or receive a new practice.
export function createReleaseScope(manifest: ReleaseManifest) {
  if (manifest.version.length > 80 || !/^\d{4}-\d{2}-\d{2}\.[a-z0-9-]+$/.test(manifest.version)) throw new Error('RELEASE_MANIFEST_VERSION_INVALID');
  const approved = new Set<string>();
  const access = new Map<string, ReleaseRule['access']>();
  const notices = new Map<string, ReleaseRule['consentNotice']>();
  for (const rule of manifest.rules) {
    if (!countries.test(rule.country) || rule.country === 'ZZ' || !ages.has(rule.ageBand) || !locales.has(rule.locale) || !platforms.has(rule.platform) || rule.purpose !== 'family-practice' || !['open-pilot', 'family-entitlement'].includes(rule.access)) throw new Error('RELEASE_RULE_INVALID');
    const signatures = Object.values(rule.approvals);
    if (signatures.length !== 3 || signatures.some(value => !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{3,119}$/.test(value)) || new Set(signatures).size !== 3) throw new Error('RELEASE_APPROVALS_REQUIRED');
    if (!rule.consentNotice || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,79}$/.test(rule.consentNotice.version) || !/^[a-f0-9]{64}$/.test(rule.consentNotice.sha256)) throw new Error('CONSENT_NOTICE_REQUIRED');
    const noticeKey = [rule.country, rule.ageBand, rule.locale].join(':');
    const earlier = notices.get(noticeKey);
    if (earlier && (earlier.version !== rule.consentNotice.version || earlier.sha256 !== rule.consentNotice.sha256)) throw new Error('CONSENT_NOTICE_CONFLICT');
    notices.set(noticeKey, rule.consentNotice);
    const key = ruleKey(rule);
    if (approved.has(key)) throw new Error('RELEASE_RULE_DUPLICATE');
    approved.add(key);
    access.set(key, rule.access);
  }
  return {
    version: manifest.version,
    // Bind every issued session to the exact rule set, including approvals.
    // Sorting prevents a harmless row reorder from changing this identity.
    identity: `${manifest.version}:${createHash('sha256').update(JSON.stringify([...manifest.rules].sort((a, b) => ruleKey(a).localeCompare(ruleKey(b))).map(rule => [ruleKey(rule), rule.access, rule.consentNotice.version, rule.consentNotice.sha256, rule.approvals.product, rule.approvals.legal, rule.approvals.security]))).digest('hex')}`,
    mode: 'approved' as const,
    consentNotice(country: string, ageBand: AgeBand, locale: Locale) { return notices.get([country, ageBand, locale].join(':')) ?? null; },
    permits(country: string, ageBand: AgeBand, locale: Locale, platform: ReleasePlatform) {
      return approved.has([country, ageBand, locale, platform, 'family-practice'].join(':'));
    },
    requiresEntitlement(country: string, ageBand: AgeBand, locale: Locale, platform: ReleasePlatform) {
      return access.get([country, ageBand, locale, platform, 'family-practice'].join(':')) === 'family-entitlement';
    },
    permitsRegistration(country: string, locale: Locale, platformsForTransport: readonly ReleasePlatform[]) {
      return [...ages].some(age => platformsForTransport.some(platform => approved.has([country, age, locale, platform, 'family-practice'].join(':'))));
    },
    permitsChild(country: string, ageBand: AgeBand, locale: Locale) {
      return [...platforms].some(platform => approved.has([country, ageBand, locale, platform, 'family-practice'].join(':')));
    },
  };
}

// Local development uses a synthetic country code. It cannot be included in
// an approved manifest, and cannot authorize a real country by accident.
export const localReleaseScope = {
  version: 'local-development',
  identity: 'local-development',
  mode: 'local-development' as const,
  consentNotice: (_country: string, _ageBand: AgeBand, _locale: Locale): null => null,
  permits: (country: string, _ageBand: AgeBand, _locale: Locale, _platform: ReleasePlatform) => country === 'ZZ',
  requiresEntitlement: (_country: string, _ageBand: AgeBand, _locale: Locale, _platform: ReleasePlatform) => false,
  permitsRegistration: (country: string, _locale: Locale, _platforms: readonly ReleasePlatform[]) => country === 'ZZ',
  permitsChild: (country: string, _ageBand: AgeBand, _locale: Locale) => country === 'ZZ',
};
export type ReleaseScope = ReturnType<typeof createReleaseScope> | typeof localReleaseScope;
