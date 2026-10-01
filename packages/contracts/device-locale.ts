import type { Locale } from '../task-engine/index.ts';

// A Traditional Chinese preference does not imply consent to Simplified Chinese.
// Try the next device preference before falling back to English.
export function supportedDeviceLocale(languageTags: readonly string[]): Locale {
  for (const tag of languageTags) {
    if (/^en(?:-|$)/i.test(tag)) return 'en';
    if (/^zh(?:$|-(?:hans|cn|sg)(?:-|$))/i.test(tag)) return 'zh-CN';
  }
  return 'en';
}
