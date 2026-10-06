import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { familyRouteCategory, isFamilyRouteCategory, observeFamilyRequest, familyRequestLoggingEnabled } from '../../apps/api/request-observation.ts';

const id = '9cd90b81-e945-4809-87ce-8b5966c6a39b', privateValue = 'synthetic-private-child-name-and-secret';
class Response extends EventEmitter {
  headers = new Map<string, string>(); headersSent = false; writableFinished = false; statusCode = 200;
  setHeader(name: string, value: string) { this.headers.set(name, value); }
  finish(status: number) { this.statusCode = status; this.headersSent = true; this.writableFinished = true; this.emit('finish'); this.emit('close'); }
}
function fixture(url = `/api/children/${id}/sessions?private=${privateValue}`, method = 'POST') {
  let clock = 100; const lines: string[] = [], response = new Response();
  const request = { url, method, headers: { 'x-request-id': privateValue, cookie: privateValue, authorization: privateValue, 'user-agent': privateValue }, body: { childName: privateValue } } as unknown as IncomingMessage;
  const options = { enabled: true, errorsOnly: false, source: 'vercel' as const, now: () => clock, write: (line: string) => { lines.push(line); } };
  const observation = observeFamilyRequest(request, response as unknown as ServerResponse, options);
  return { request, response, options, observation, lines, clock: (value: number) => { clock = value; } };
}

test('route categories remove every object identifier, query and unknown path rather than logging a raw URL', () => {
  for (const [url, category] of [
    [`/api/me?secret=${privateValue}`, '/api/me'], [`/api/children/${id}`, '/api/children/:childId'],
    [`/api/children/${id}/sessions`, '/api/children/:childId/sessions'],
    [`/api/children/${id}/life-goals/${id}`, '/api/children/:childId/life-goals/:goalId'],
    [`/api/children/${id}/life-goals/history`, '/api/children/:childId/life-goals/history'],
    [`/api/children/${id}/recovery/${id}/resume`, '/api/children/:childId/recovery/:sessionId/resume'],
    [`/api/children/${id}/age-review/apply`, '/api/children/:childId/age-review/apply'],
    [`/api/sessions/${id}/events`, '/api/sessions/:sessionId/events'],
    [`/api/family/members/${id}`, '/api/family/members/:id'],
    [`/api/content/releases/${'a'.repeat(64)}`, '/api/content/releases/:sha256'],
    [`/api/children/${id}/${privateValue}`, 'unknown-api'], [`/api/${privateValue}`, 'unknown-api'],
    [`/content-assets/${privateValue}`, 'content-asset'], [`/media/${privateValue}.mp3`, 'media'],
    [`/${privateValue}`, 'web'], ['http://[invalid', 'malformed'],
  ]) {
    assert.equal(familyRouteCategory(url), category);
    assert.equal(isFamilyRouteCategory(category), true);
  }
  assert.equal(isFamilyRouteCategory(`/api/children/${id}?secret=${privateValue}`), false);
});

test('a Vercel request and its reused family handler produce one correlated, bounded event without private inputs', () => {
  const f = fixture(); f.observation.setVersion('0.46.0'); f.clock(125); f.observation.runtimeReady();
  const second = observeFamilyRequest(f.request, f.response as unknown as ServerResponse, { ...f.options, source: 'standalone' });
  assert.equal(second, f.observation); f.clock(130); second.runtimeReady();
  f.clock(200); f.response.finish(201);
  assert.equal(f.lines.length, 1); assert.notEqual(f.response.headers.get('X-Request-ID'), privateValue);
  const event = JSON.parse(f.lines[0]);
  assert.equal(event.requestId, f.response.headers.get('X-Request-ID')); assert.equal(event.route, '/api/children/:childId/sessions');
  assert.equal(event.source, 'vercel'); assert.equal(event.version, '0.46.0'); assert.equal(event.status, 201);
  assert.equal(event.outcome, 'ok'); assert.equal(event.durationMs, 100); assert.equal(event.runtimeWaitMs, 25); assert.equal(event.code, null);
  assert.deepEqual(Object.keys(event).sort(), ['event','schemaVersion','timestamp','requestId','source','version','method','route','transport','status','outcome','durationMs','runtimeWaitMs','code'].sort());
  assert.equal(f.lines[0].includes(privateValue), false); assert.equal(f.lines[0].includes(id), false);
});

test('abandoned and failed requests are distinct, recorded once, and unknown codes or invalid metadata cannot enter logs', () => {
  const abandoned = fixture(); abandoned.response.emit('close'); abandoned.response.emit('finish');
  const event = JSON.parse(abandoned.lines[0]); assert.equal(abandoned.lines.length, 1);
  assert.equal(event.outcome, 'aborted'); assert.equal(event.status, null); assert.equal(event.code, 'REQUEST_ABORTED');
  const failed = fixture('/api/ready', privateValue); failed.observation.setVersion(privateValue); failed.observation.setFailure(privateValue);
  failed.clock(-20); failed.response.finish(503);
  const failure = JSON.parse(failed.lines[0]); assert.equal(failure.version, null); assert.equal(failure.method, 'OTHER');
  assert.equal(failure.durationMs, 0); assert.equal(failure.code, 'REQUEST_FAILED'); assert.equal(failure.outcome, 'error');
  assert.equal(failed.lines[0].includes(privateValue), false);
  const rejected = fixture(); rejected.observation.setFailure('PRACTICE_PLAN_CHANGED'); rejected.response.finish(409);
  assert.equal(JSON.parse(rejected.lines[0]).code, 'PRACTICE_PLAN_CHANGED'); assert.equal(JSON.parse(rejected.lines[0]).outcome, 'rejected');
});

test('log failures and disabled collection never change the response, while successful static delivery stays quiet', () => {
  const f = fixture(); f.options.write = () => { throw new Error(privateValue); }; assert.doesNotThrow(() => f.response.finish(200));
  const disabled = fixture(); disabled.options.enabled = false; disabled.response.finish(200); assert.equal(disabled.lines.length, 0);
  const localError = fixture(); localError.options.enabled = false; localError.options.errorsOnly = true; localError.response.finish(500); assert.equal(JSON.parse(localError.lines[0]).outcome, 'error');
  const localRejection = fixture(); localRejection.options.enabled = false; localRejection.options.errorsOnly = true; localRejection.response.finish(401); assert.equal(localRejection.lines.length, 0);
  const asset = fixture(`/media/${privateValue}.mp3`); asset.response.finish(200); assert.equal(asset.lines.length, 0);
  const missing = fixture(`/media/${privateValue}.mp3`); missing.response.finish(404); assert.equal(JSON.parse(missing.lines[0]).route, 'media');
});

test('runtime logging is enabled for Vercel and opt-in for standalone without trusting a request header', () => {
  const previous = process.env.FOCUS_HTTP_LOGS;
  try {
    delete process.env.FOCUS_HTTP_LOGS; assert.equal(familyRequestLoggingEnabled(true), true); assert.equal(familyRequestLoggingEnabled(false), false);
    process.env.FOCUS_HTTP_LOGS = '1'; assert.equal(familyRequestLoggingEnabled(false), true);
    process.env.FOCUS_HTTP_LOGS = '0'; assert.equal(familyRequestLoggingEnabled(true), false);
  } finally { if (previous === undefined) delete process.env.FOCUS_HTTP_LOGS; else process.env.FOCUS_HTTP_LOGS = previous; }
});
