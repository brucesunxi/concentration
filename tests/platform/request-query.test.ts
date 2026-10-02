import assert from 'node:assert/strict';
import test from 'node:test';
import { requestQuery } from '../../apps/api/request-query.ts';

test('Vercel rewrite capture does not pollute a strict report query', () => {
  const url = new URL('https://example.test/api/children/abc/report?path=children%2Fabc%2Freport&sessionsCursor=next');
  assert.deepEqual(requestQuery(url, true), { sessionsCursor: 'next' });
  assert.deepEqual(requestQuery(url, false), { path: 'children/abc/report', sessionsCursor: 'next' });
});

test('only the matching single rewrite capture is ignored', () => {
  const pathname = 'https://example.test/api/children/abc/report';
  assert.deepEqual(requestQuery(new URL(pathname + '?path=elsewhere'), true), { path: 'elsewhere' });
  assert.deepEqual(requestQuery(new URL(pathname + '?path=children%2Fabc%2Freport&path=elsewhere'), true), {
    path: ['children/abc/report', 'elsewhere'],
  });
  assert.deepEqual(requestQuery(new URL(pathname + '?sessionsCursor=one&sessionsCursor=two'), true), {
    sessionsCursor: ['one', 'two'],
  });
});
