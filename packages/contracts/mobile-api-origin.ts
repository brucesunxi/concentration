import { parseMobileApiOrigin } from './parse-mobile-api-origin.ts';

const LOCAL_ORIGIN = 'http://localhost:4181';

export function mobileApiOrigin(raw: string | undefined): { origin: string; local: boolean } {
  return parseMobileApiOrigin(raw === undefined ? LOCAL_ORIGIN : raw);
}
