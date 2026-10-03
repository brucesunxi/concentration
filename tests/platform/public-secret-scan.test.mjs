import test from 'node:test';
import assert from 'node:assert/strict';
import { sensitiveMaterial } from '../../packages/release-safety/public-secret-scan.mjs';

test('blocks release credentials without returning their values', () => {
  const password = 'npg_' + 'SyntheticExample1234567890';
  const azure = 'SyntheticAzureKey' + '1234567890';
  assert.equal(sensitiveMaterial('README.md', Buffer.from(`Please use ${password}`), {}), 'NEON_PASSWORD');
  assert.equal(sensitiveMaterial('assets/app.js', Buffer.from(`const value = "${azure}"`), { AZURE_SPEECH_KEY: azure }), 'ENV_AZURE_SPEECH_KEY');
  assert.equal(sensitiveMaterial('config/.env.production', Buffer.alloc(0), {}), 'PRIVATE_FILENAME');
  assert.equal(sensitiveMaterial('secrets/release.p12', Buffer.alloc(0), {}), 'PRIVATE_FILENAME');
  assert.equal(sensitiveMaterial('assets/app.js', Buffer.from('AZURE_SPEECH_KEY=' + 'A'.repeat(80)), {}), 'AZURE_SPEECH_KEY');
});

test('allows ordinary public examples and media', () => {
  assert.equal(sensitiveMaterial('tests/example.ts', Buffer.from('postgresql://runtime:secret@ep-sample.neon.tech/db'), {}), null);
  assert.equal(sensitiveMaterial('docs/.env.example', Buffer.from('DATABASE_URL=replace-me'), {}), null);
  assert.equal(sensitiveMaterial('media/lesson.mp3', Buffer.from([0x49, 0x44, 0x33, 0x00, 0x11]), {}), null);
});
