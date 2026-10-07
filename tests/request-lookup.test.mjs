import test from 'node:test';
import assert from 'node:assert/strict';
import { findRequestObservation } from '../scripts/find-request-observation.mjs';

const requestId = 'd021e8ca-452c-4a2d-8ce0-000000000001';
const privateValue = 'synthetic-child-secret-and-query';
const event = (changes = {}) => ({
  event: 'FAMILY_HTTP_REQUEST', schemaVersion: 1, timestamp: '2026-10-07T08:51:01.801Z',
  requestId, source: 'vercel', version: '0.46.0', method: 'GET', route: '/api/ready',
  transport: 'web', status: 200, outcome: 'ok', durationMs: 160, runtimeWaitMs: 0,
  code: null, ...changes,
});
const lines = values => (async function* () { for (const value of values) yield JSON.stringify(value); })();

test('operator lookup returns only validated application fields from a platform wrapper', async () => {
  const wrapped = { requestPath: `/api/children/${privateValue}?token=${privateValue}`,
    logs: [{ message: JSON.stringify({ ...event(), rawBody: privateValue }) }], message: privateValue };
  const result = await findRequestObservation(lines([wrapped, wrapped]), requestId, 10);
  assert.deepEqual(result, {
    found: true, sourceLimitReached: false,
    observation: { timestamp: event().timestamp, requestId, source: 'vercel', version: '0.46.0',
      method: 'GET', route: '/api/ready', transport: 'web', status: 200, outcome: 'ok',
      durationMs: 160, runtimeWaitMs: 0, code: null },
  });
  assert.equal(JSON.stringify(result).includes(privateValue), false);
});

test('lookup refuses a matching event with unsafe route or arbitrary error code', async () => {
  await assert.rejects(findRequestObservation(lines([event({route:`/api/children/${privateValue}`})]), requestId),
    {message:'INVALID_OBSERVATION'});
  await assert.rejects(findRequestObservation(lines([event({status:503,outcome:'error',code:privateValue})]), requestId),
    {message:'INVALID_OBSERVATION'});
});

test('lookup refuses conflicting events and reports source-limit uncertainty', async () => {
  await assert.rejects(findRequestObservation(lines([event(), event({durationMs: 170})]), requestId),
    {message:'CONFLICTING_OBSERVATIONS'});
  assert.deepEqual(await findRequestObservation(lines([{message:'unrelated'}]), requestId, 1),
    {found:false,sourceLimitReached:true,observation:null});
  await assert.rejects(findRequestObservation(lines([]), privateValue), {message:'INVALID_ARGUMENTS'});
});
