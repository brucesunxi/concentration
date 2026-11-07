import test from 'node:test';
import assert from 'node:assert/strict';
import { lifeHistoryCopy } from '../../packages/family-support/history-copy.ts';

test('everyday goals history uses singular and plural English counts', () => {
  const en = lifeHistoryCopy('en');
  assert.equal(en.explanation(1).startsWith('1 goal in total.'), true);
  assert.equal(en.explanation(2).startsWith('2 goals in total.'), true);
  assert.match(en.page(1, 1), /Page 1 · 1 closed goal on this page/);
  assert.match(en.page(1, 2), /Page 1 · 2 closed goals on this page/);
  assert.match(en.page(1, 0), /Page 1 · 0 closed goals on this page/);
  const zh = lifeHistoryCopy('zh-CN');
  assert.match(zh.explanation(1), /共 1 个目标/);
  assert.match(zh.page(1, 1), /本页 1 个已结束目标/);
});
