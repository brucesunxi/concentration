import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VOICE_ASSETS, GENERATED_VOICE_ASSETS } from '../src/audio/manifest.js';

const required = ['home-welcome', 'search-rule', 'stop-rule', 'memory-rule', 'memory-recall', 'search-success', 'stop-success', 'memory-success'];

test('voice manifest covers the fixed child-facing prompts', () => {
  for (const id of required) {
    assert.ok(VOICE_ASSETS[id], `missing voice asset ${id}`);
    assert.ok(VOICE_ASSETS[id].text.length > 2);
    assert.match(VOICE_ASSETS[id].path, new RegExp(`/src/audio/${id}\\.mp3$`));
  }
  assert.equal(new Set(Object.values(VOICE_ASSETS).map(asset => asset.path)).size, Object.keys(VOICE_ASSETS).length);
  assert.equal(typeof GENERATED_VOICE_ASSETS, 'boolean');
});

test('runtime app contains no realtime voice API call', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /fetch\(['"]\/api\/voice/);
});
