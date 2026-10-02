import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNetworkFailure } from '../../packages/session-runtime/offline-session.ts';
import { readMobileResponseJson } from '../../packages/session-runtime/mobile-response.ts';

test('a timeout while reading response JSON allows the prepared offline practice to be offered', async () => {
  const controller = new AbortController();
  const response = { json: () => new Promise<unknown>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('response body interrupted')), { once: true });
  }) };
  const pending = readMobileResponseJson(response, controller.signal);
  controller.abort();
  await assert.rejects(pending, isNetworkFailure);
});

test('an invalid server response never enables offline fallback', async () => {
  const controller = new AbortController();
  const broken = new SyntaxError('invalid JSON');
  await assert.rejects(readMobileResponseJson({ json: () => Promise.reject(broken) }, controller.signal), error => error === broken);
});
