import test from 'node:test';
import assert from 'node:assert/strict';
import { childCardSubtitle } from '../../packages/content/child-card.ts';
import { pageBrand } from '../../packages/content/brand.ts';
import { countCopy } from '../../packages/content/plural.ts';
import { checkboxA11y } from '../../packages/session-runtime/checkbox-a11y.ts';
import { invitationMoment, membersCopy } from '../../packages/session-runtime/family-members-copy.ts';
import { weeklyDayLayout } from '../../packages/session-runtime/weekly-day-layout.ts';
import { limitCopy } from '../../packages/session-runtime/practice-limit-copy.ts';

test('an accepted invitation uses the acceptance time, not the code expiry', () => {
  const expiresAt = '2026-11-11T00:00:00.000Z';
  const acceptedAt = '2026-11-09T04:37:00.000Z';
  assert.equal(invitationMoment({ state: 'accepted', expiresAt, acceptedAt }), acceptedAt);
  assert.equal(invitationMoment({ state: 'accepted', expiresAt, acceptedAt: null }), null);
  assert.equal(invitationMoment({ state: 'open', expiresAt, acceptedAt: null }), expiresAt);
  assert.equal(invitationMoment({ state: 'expired', expiresAt, acceptedAt: null }), expiresAt);
});

test('child cards name the course world and omit the product name', () => {
  const base = { ageBand: '9-11' as const, locale: 'en' as const, course: { task: 'search' as const, complete: false } };
  assert.equal(childCardSubtitle(base), '9-11 · English · Forest search');
  assert.equal(childCardSubtitle({ ...base, locale: 'zh-CN', course: { task: 'sustain', complete: false } }), '9-11 · 简体中文 · 星星瞭望台');
  assert.equal(childCardSubtitle({ ...base, ageBand: '12-14', course: { task: 'memory', complete: false } }), '12-14 · English · Sequence studio');
  assert.equal(childCardSubtitle({ ...base, course: { task: 'search', complete: true } }), '9-11 · English');
  for (const line of [childCardSubtitle(base), childCardSubtitle({ ...base, course: { task: 'search', complete: true } })]) {
    assert.equal(line.includes('FOCUS ISLAND'), false);
    assert.equal(line.includes('FOCUS STUDIO'), false);
  }
});

test('the mobile eyebrow follows the selected language', () => {
  assert.equal(pageBrand('zh-CN'), '专注岛');
  assert.equal(pageBrand('en'), 'FOCUS ISLAND');
  assert.equal(pageBrand(), 'FOCUS ISLAND');
});

test('accept-invitation hints sit with the username and the password', () => {
  for (const locale of ['zh-CN', 'en'] as const) {
    const copy = membersCopy(locale);
    assert.equal(copy.passwordHint.includes(locale === 'zh-CN' ? '登录名' : 'Username'), false);
    assert.match(copy.loginRule, locale === 'zh-CN' ? /3–32/ : /3–32/);
    assert.match(copy.passwordHint, locale === 'zh-CN' ? /至少 15 个字符/ : /at least 15 characters/i);
  }
});

test('English counts are singular at 1 and Chinese keeps one classifier', () => {
  assert.equal(countCopy('en', 1, 'completed practice', 'completed practices', '次完整练习'), '1 completed practice');
  assert.equal(countCopy('en', 0, 'completed practice', 'completed practices', '次完整练习'), '0 completed practices');
  assert.equal(countCopy('en', 2, 'child', 'children', '个孩子'), '2 children');
  assert.equal(countCopy('en', 1, 'minute', 'minutes', '分钟'), '1 minute');
  assert.equal(countCopy('en', 1, 'day', 'days', '天'), '1 day');
  assert.equal(countCopy('en', 1, 'session', 'sessions', '次会话'), '1 session');
  assert.equal(countCopy('zh-CN', 1, 'completed practice', 'completed practices', '次'), '1 次');
  assert.equal(countCopy('zh-CN', 2, 'completed practice', 'completed practices', '次'), '2 次');
  assert.equal(countCopy('zh-CN', 1, 'minute', 'minutes', '分钟').endsWith('s'), false);
  assert.match(limitCopy('en').ceiling(1), /1 minute/);
  assert.equal(limitCopy('en').ceiling(1).includes('1 minutes'), false);
  assert.match(limitCopy('zh-CN').ceiling(1), /1 分钟/);
});

test('glyph checkboxes expose checked state to native and web assistive technology', () => {
  assert.deepEqual(checkboxA11y(true, false), {
    accessibilityRole: 'checkbox',
    accessibilityState: { checked: true, disabled: false },
    role: 'checkbox',
    'aria-checked': true,
    'aria-disabled': false,
  });
  assert.equal(checkboxA11y(false, true).accessibilityState.checked, false);
  assert.equal(checkboxA11y(false, true)['aria-checked'], false);
});

test('weekly day tiles grow to fill the card row', () => {
  assert.equal(weeklyDayLayout.row.width, '100%');
  assert.equal(weeklyDayLayout.tile.flexGrow, 1);
  assert.equal(weeklyDayLayout.tile.flexShrink, 1);
  assert.equal(weeklyDayLayout.tile.flexBasis, '46%');
});
