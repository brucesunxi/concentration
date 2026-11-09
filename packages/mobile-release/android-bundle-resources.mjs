import { execFileSync } from 'node:child_process';
import { LOCAL_ANDROID_APP_NAME, PLAY_INTERNAL_APP_NAME, bundleHasText } from './play-internal-android.ts';

/** `unzip -p` inflates the entry. Gradle stores `resources.pb` with method 8, so the label is not visible in the raw archive bytes. */
export function readArchiveEntries(archive, pattern, unzip = '/usr/bin/unzip') {
  const listing = execFileSync(unzip, ['-Z1', archive], { encoding: 'utf8' }).split('\n').map(line => line.trim()).filter(Boolean);
  const names = listing.filter(name => pattern.test(name));
  for (const name of names) {
    if (name.startsWith('-') || /[\r\n\0]/.test(name)) throw new Error('PLAY_INTERNAL_ARCHIVE_ENTRY_INVALID');
  }
  return Buffer.concat(names.map(name => execFileSync(unzip, ['-p', archive, name], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })));
}

export function assertPlayInternalAppLabel(bytes) {
  if (bundleHasText(bytes, LOCAL_ANDROID_APP_NAME)) throw new Error('Local development app name is still packaged');
  if (!bundleHasText(bytes, PLAY_INTERNAL_APP_NAME)) throw new Error('Play internal app name was not packaged');
}
