import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedDeviceLocale } from '../../packages/contracts/device-locale.ts';

test('first launch follows the first supported device language', () => {
  assert.equal(supportedDeviceLocale(['fr-FR', 'zh-Hans-CN', 'en-US']), 'zh-CN');
  assert.equal(supportedDeviceLocale(['en-GB', 'zh-CN']), 'en');
});

test('Traditional Chinese is not silently presented as Simplified Chinese', () => {
  assert.equal(supportedDeviceLocale(['zh-Hant-TW', 'en-US']), 'en');
  assert.equal(supportedDeviceLocale(['zh-HK']), 'en');
  assert.equal(supportedDeviceLocale(['zh-SG']), 'zh-CN');
});
