import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Android narration QA accepts both system log formats and rejects stale or still-playing evidence', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'scripts.qa.test_android_audio_observations'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
