import { parseMobileApiOrigin } from './parse-mobile-api-origin.ts';

/** Play internal bundles import this module instead of the local development fallback. */
export function mobileApiOrigin(raw: string | undefined): { origin: string; local: boolean } {
  if (raw === undefined) throw new Error('MOBILE_API_ORIGIN_REQUIRED');
  const parsed = parseMobileApiOrigin(raw);
  if (parsed.local) throw new Error('MOBILE_API_ORIGIN_HTTPS_REQUIRED');
  return parsed;
}
