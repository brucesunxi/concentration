import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileApiOrigin } from '../../packages/contracts/mobile-api-origin.ts';

test('native API origin defaults to local simulator routing and accepts a public HTTPS endpoint', () => {
  assert.deepEqual(mobileApiOrigin(undefined), { origin: 'http://localhost:4181', local: true });
  assert.deepEqual(mobileApiOrigin('https://family.example.test/'), { origin: 'https://family.example.test', local: false });
  assert.deepEqual(mobileApiOrigin('http://127.0.0.1:4181'), { origin: 'http://127.0.0.1:4181', local: true });
});

test('native API origin rejects insecure remote routes and embedded request data', () => {
  for (const value of ['http://family.example.test', 'ftp://family.example.test', 'https://user:pass@family.example.test', 'https://family.example.test/api', 'https://family.example.test/?token=x', 'https://family.example.test/#x', ' https://family.example.test', '']) {
    assert.throws(() => mobileApiOrigin(value), /MOBILE_API_ORIGIN_/);
  }
});
