import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeDatabaseDirectoryUri } from '../../packages/session-runtime/native-database-path.ts';

test('Android SQLite directory is converted to the file URI used by File.exists', () => {
  assert.equal(nativeDatabaseDirectoryUri('/data/user/0/dev.focusisland.family/files/SQLite'), 'file:///data/user/0/dev.focusisland.family/files/SQLite');
});

test('iOS absolute paths are converted, file URIs are preserved, and unknown paths are rejected', () => {
  assert.equal(nativeDatabaseDirectoryUri('/var/mobile/Containers/Data/SQLite'), 'file:///var/mobile/Containers/Data/SQLite');
  assert.equal(nativeDatabaseDirectoryUri('file:///var/mobile/Containers/Data/SQLite'), 'file:///var/mobile/Containers/Data/SQLite');
  assert.throws(() => nativeDatabaseDirectoryUri('relative/SQLite'));
});
