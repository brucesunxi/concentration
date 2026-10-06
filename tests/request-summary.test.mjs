import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRequestObservations } from '../scripts/summarize-request-observations.mjs';

const from = '2026-10-06T00:00:00.000Z', to = '2026-10-06T00:30:00.000Z';
const privateValue = 'synthetic-child-name-and-token';
const requestId = index => `d021e8ca-452c-4a2d-8ce0-${index.toString(16).padStart(12, '0')}`;
const event = (index, changes = {}) => ({
  event: 'FAMILY_HTTP_REQUEST', schemaVersion: 1, timestamp: '2026-10-06T00:10:00.000Z',
  requestId: requestId(index), source: 'vercel', version: '0.46.0', method: 'POST',
  route: '/api/children/:childId/sessions', transport: 'web', status: 200,
  outcome: 'ok', durationMs: 10, runtimeWaitMs: 2, code: null, ...changes,
});
const lines = values => (async function* () { for (const value of values) yield JSON.stringify(value); })();

test('summary separates probes and request outcomes without counting duplicated Vercel messages', async () => {
  const traffic = Array.from({ length: 25 }, (_, index) => event(index, index >= 20
    ? { status: 503, outcome: 'error', durationMs: 100, code: 'DATABASE_NOT_READY' } : {}));
  const wrapped = traffic.map(item => ({
    message: JSON.stringify(item), requestPath: `/api/children/${privateValue}?token=${privateValue}`,
    logs: [{ message: JSON.stringify(item) }],
  }));
  const result = await summarizeRequestObservations(lines([
    ...wrapped, wrapped[0], event(99, { route: '/api/ready', method: 'GET' }),
  ]), { from, to });
  assert.equal(result.integrity.candidates, 27);
  assert.equal(result.integrity.duplicate, 1);
  assert.equal(result.integrity.completeInput, true);
  assert.equal(result.traffic.requests, 25);
  assert.equal(result.traffic.error, 5);
  assert.equal(result.traffic.serverErrorRate, 0.2);
  assert.equal(result.traffic.p95Ms, 100);
  assert.equal(result.traffic.p99Ms, null);
  assert.equal(result.traffic.runtimeWaitP95Ms, 2);
  assert.equal(result.probes.requests, 1);
  assert.equal(result.probes.serverErrorRate, null);
  assert.equal(result.routes[0].route, '/api/children/:childId/sessions');
  assert.equal(JSON.stringify(result).includes(privateValue), false);
  assert.equal(JSON.stringify(result).includes(requestId(0)), false);
});

test('conflicting records and unsafe routes never enter a low-sample metric', async () => {
  const valid = event(1);
  const result = await summarizeRequestObservations(lines([
    valid, { ...valid, status: 503, outcome: 'error', code: 'SERVICE_UNAVAILABLE' },
    event(2, { route: `/api/children/${privateValue}` }),
    event(3, { timestamp: '2026-10-05T23:00:00.000Z' }),
    event(4, { durationMs: -1 }),
    event(5, { status: 409, outcome: 'rejected', code: 'PRACTICE_PLAN_CHANGED' }),
  ]), { from, to });
  assert.deepEqual({ invalid: result.integrity.invalid, outsideWindow: result.integrity.outsideWindow,
    conflictingDuplicate: result.integrity.conflictingDuplicate }, { invalid: 2, outsideWindow: 1, conflictingDuplicate: 1 });
  assert.equal(result.traffic.requests, 1);
  assert.equal(result.traffic.rejected, 1);
  assert.equal(result.traffic.error, 0);
  assert.equal(result.traffic.serverErrorRate, null);
  assert.equal(result.traffic.p95Ms, null);
  assert.equal(result.integrity.completeInput, false);
  assert.equal(JSON.stringify(result).includes(privateValue), false);
});

test('hitting the platform result cap suppresses rates and latency claims', async () => {
  const records = Array.from({ length: 25 }, (_, index) => event(index));
  const result = await summarizeRequestObservations(lines(records), { from, to, sourceLimit: 25 });
  assert.equal(result.integrity.sourceLimitReached, true);
  assert.equal(result.integrity.completeInput, false);
  assert.equal(result.traffic.requests, 25);
  assert.equal(result.traffic.serverErrorRate, null);
  assert.equal(result.traffic.p95Ms, null);
});

test('an empty source cannot certify a complete observation window', async () => {
  const result = await summarizeRequestObservations(lines([]), { from, to, sourceLimit: 100 });
  assert.equal(result.integrity.inputLines, 0);
  assert.equal(result.integrity.completeInput, false);
  assert.equal(result.traffic.requests, 0);
});

test('P99 requires enough completed requests to distinguish a tail', async () => {
  const records = Array.from({ length: 100 }, (_, index) => event(index, { durationMs: index + 1, runtimeWaitMs: 0 }));
  const result = await summarizeRequestObservations(lines(records), { from, to, sourceLimit: 101 });
  assert.equal(result.traffic.p95Ms, 95);
  assert.equal(result.traffic.p99Ms, 99);
});
