import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CONTENT_NARRATIONS, contentNarration } from '../packages/content/voice-catalogue.ts';
import { taskContent } from '../packages/content/copy.ts';
import { measureNarrationQuality } from '../scripts/voice-engineering-quality.mjs';

const folder = resolve(import.meta.dirname, '../assets/content-rule-candidates');

test('unreviewed stop-rule recordings match every age and language, current instructions and actual audio bytes', async () => {
  const manifest = JSON.parse(await readFile(resolve(folder, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 'content-rule-candidates-1');
  assert.equal(manifest.status, 'unreviewed');
  assert.equal(manifest.entries.length, 4);
  const expected = new Set(['6-8:zh-CN', '6-8:en', '9-11:zh-CN', '9-11:en', '12-14:zh-CN', '12-14:en', '15-17:zh-CN', '15-17:en']);
  const covered = new Set();
  const files = new Set();
  for (const entry of manifest.entries) {
    assert.equal(entry.task, 'stop'); assert.equal(entry.copyKey, 'rule');
    assert.match(entry.file, /^stop-rule-(child|teen)-(zh|en)\.mp3$/);
    assert.equal(files.has(entry.file), false); files.add(entry.file);
    const catalogue = CONTENT_NARRATIONS.find(item => item.task === 'stop' && item.cohort === entry.cohort && item.locale === entry.locale);
    assert.ok(catalogue);
    assert.equal(entry.voice, catalogue.voice); assert.equal(entry.rate, catalogue.rate); assert.equal(entry.pitch, catalogue.pitch);
    for (const age of entry.ageBands) {
      const key = `${age}:${entry.locale}`;
      assert.ok(expected.has(key)); assert.equal(covered.has(key), false); covered.add(key);
      assert.equal(entry.transcript, taskContent('stop', entry.locale, age).rule);
      assert.equal(contentNarration('stop', age, entry.locale).copyKey, 'strategy', 'unreviewed audio must not be silently attached');
    }
    const path = resolve(folder, entry.file), bytes = await readFile(path);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path], { encoding: 'utf8' }));
    const durationMs = Math.round(Number(probe.format.duration) * 1000);
    assert.equal(durationMs, entry.durationMs);
    await measureNarrationQuality(path, durationMs);
  }
  assert.deepEqual(covered, expected);
  assert.deepEqual((await readdir(folder)).filter(name => name.endsWith('.mp3')).sort(), [...files].sort());
});
