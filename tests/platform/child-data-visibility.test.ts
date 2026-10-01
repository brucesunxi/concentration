import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childDataVisibilityCopy } from '../../packages/contracts/child-data-visibility.ts';
import type { AgeBand, Locale } from '../../packages/task-engine/index.ts';

test('every age group can read the actual family data boundary in both languages', () => {
  const ages: AgeBand[] = ['6-8', '9-11', '12-14', '15-17'];
  const locales: Locale[] = ['zh-CN', 'en'];
  for (const locale of locales) {
    for (const age of ages) {
      const copy = childDataVisibilityCopy(age, locale);
      for (const field of Object.values(copy)) assert.ok(field.trim().length > 0, `${age}/${locale} has an empty explanation`);
      const explanation = [copy.practice, copy.reflection, copy.control, copy.device].join(' ');
      if (locale === 'en') {
        assert.match(copy.practice, /export/);
        assert.match(copy.reflection, /not saved/);
        assert.match(copy.control, /cannot be taken back/);
        assert.match(copy.device, /shared device/);
      } else {
        assert.match(copy.practice, /导出/);
        assert.match(copy.reflection, /不保存|不会保存/);
        assert.match(copy.control, /无法收回/);
        assert.match(copy.device, /设备/);
      }
      assert.doesNotMatch(explanation, /完全保密|绝对保密|completely secret|only you can see/i);
    }
    assert.equal(new Set(ages.map(age => childDataVisibilityCopy(age, locale).introduction)).size, ages.length);
  }
});
