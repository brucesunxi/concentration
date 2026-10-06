import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request, RequestError } from '../../apps/family-web/src/api.ts';
import { familyErrorCopy } from '../../apps/family-web/src/error-copy.ts';
import { validRequestReference, withRequestReference } from '../../packages/contracts/request-reference.ts';

const reference = '123e4567-e89b-42d3-a456-426614174000';

test('only a server-shaped request ID can become a family support reference', () => {
  assert.equal(validRequestReference(reference.toUpperCase()), reference);
  assert.equal(validRequestReference('child-name-or-token'), null);
  assert.equal(validRequestReference(`${reference}\nprivate`), null);
  assert.equal(withRequestReference('Try again.', reference, 'en', 503, 'INTERNAL_ERROR'), `Try again. Reference: ${reference}`);
  assert.equal(withRequestReference('Try again.', 'child-name-or-token', 'en', 503, 'INTERNAL_ERROR'), 'Try again.');
  assert.equal(withRequestReference('Check the plan.', reference, 'en', 409, 'PRACTICE_PLAN_CHANGED'), 'Check the plan.');
  assert.equal(familyErrorCopy(new SyntaxError('private parser detail'), 'en'), 'Unable to complete. Please retry.');
});

test('an HTML outage or malformed success never exposes a parser error to a family', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [200, 503]) {
      globalThis.fetch = async () => new Response('<html>outage</html>', { status, headers: { 'X-Request-ID': reference } });
      await assert.rejects(request('/me'), error => {
        assert.ok(error instanceof RequestError);
        assert.equal(error.code, 'RESPONSE_UNREADABLE');
        assert.equal(error.requestId, reference);
        const copy = familyErrorCopy(error, 'en');
        assert.match(copy, /Refresh to check the latest state/);
        assert.match(copy, /Reference: 123e4567/);
        assert.doesNotMatch(copy, /html|JSON|SyntaxError/);
        return true;
      });
    }
  } finally { globalThis.fetch = original; }
});

test('server errors show their own reference, not unreviewed server detail', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'INTERNAL_ERROR', message: '敏感的服务端详情' }), { status: 503, headers: { 'X-Request-ID': reference } });
    await assert.rejects(request('/me'), error => {
      assert.ok(error instanceof RequestError);
      const copy = familyErrorCopy(error, 'zh-CN');
      assert.match(copy, /参考编号：123e4567/);
      assert.doesNotMatch(copy, /敏感的服务端详情/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});
