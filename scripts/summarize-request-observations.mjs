import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { isFamilyRouteCategory } from '../apps/api/request-observation.ts';

const SAMPLE_FLOOR = 20;
const P99_SAMPLE_FLOOR = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS', 'OTHER']);
const OUTCOMES = new Set(['ok', 'rejected', 'error', 'aborted']);

function eventFrom(value) {
  if (!value || value.event !== 'FAMILY_HTTP_REQUEST') return null;
  const { schemaVersion, timestamp, requestId, source, version, method, route, transport, status, outcome, durationMs, runtimeWaitMs } = value;
  if (schemaVersion !== 1 || typeof timestamp !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp)) || !UUID.test(requestId) || !['standalone', 'vercel'].includes(source) ||
      !(version === null || (typeof version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version))) ||
      !METHODS.has(method) || !isFamilyRouteCategory(route) || !['web', 'native'].includes(transport) ||
      !OUTCOMES.has(outcome) || !Number.isInteger(durationMs) || durationMs < 0 || durationMs > 86400000 ||
      !(runtimeWaitMs === null || (Number.isInteger(runtimeWaitMs) && runtimeWaitMs >= 0 && runtimeWaitMs <= durationMs)) ||
      !(status === null || (Number.isInteger(status) && status >= 100 && status <= 599)) ||
      (outcome === 'aborted' ? status !== null && status < 100 : status === null) ||
      (outcome === 'ok' && status >= 400) || (outcome === 'rejected' && (status < 400 || status >= 500)) ||
      (outcome === 'error' && status < 500)) return false;
  return { timestamp, requestId, source, version, method, route, transport, status, outcome, durationMs, runtimeWaitMs };
}

function percentile(values, fraction, minimum = SAMPLE_FLOOR) {
  if (values.length < minimum) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function measures(events, completeInput) {
  const completed = events.filter(event => event.outcome !== 'aborted');
  const counts = { requests: events.length, completed: completed.length, ok: 0, rejected: 0, error: 0, aborted: 0 };
  for (const event of events) counts[event.outcome]++;
  const durations = completed.map(event => event.durationMs);
  const waits = completed.flatMap(event => event.runtimeWaitMs === null ? [] : [event.runtimeWaitMs]);
  return {
    ...counts,
    serverErrorRate: completeInput && completed.length >= SAMPLE_FLOOR ? Number((counts.error / completed.length).toFixed(4)) : null,
    abortedRate: completeInput && events.length >= SAMPLE_FLOOR ? Number((counts.aborted / events.length).toFixed(4)) : null,
    p95Ms: completeInput ? percentile(durations, 0.95) : null,
    p99Ms: completeInput ? percentile(durations, 0.99, P99_SAMPLE_FLOOR) : null,
    runtimeWaitSamples: waits.length, runtimeWaitP95Ms: completeInput ? percentile(waits, 0.95) : null,
  };
}

/** Reads platform JSONL or direct application JSONL and emits only fixed operational fields. */
export async function summarizeRequestObservations(lines, { from, to, sourceLimit = null }) {
  const start = Date.parse(from), end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('INVALID_WINDOW');
  if (sourceLimit !== null && (!Number.isInteger(sourceLimit) || sourceLimit < 1)) throw new Error('INVALID_SOURCE_LIMIT');
  const byId = new Map(), conflicting = new Set();
  const integrity = { inputLines: 0, candidates: 0, invalid: 0, outsideWindow: 0, duplicate: 0, conflictingDuplicate: 0 };
  for await (const line of lines) {
    integrity.inputLines++;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    // Vercel repeats message at the top level; read logs[] only when present.
    const messages = Array.isArray(record?.logs) ? record.logs.map(log => log?.message) : [record];
    for (const message of messages) {
      let value = message;
      if (typeof value === 'string') try { value = JSON.parse(value); } catch { continue; }
      if (value?.event !== 'FAMILY_HTTP_REQUEST') continue;
      integrity.candidates++;
      const event = eventFrom(value);
      if (!event) { integrity.invalid++; continue; }
      const at = Date.parse(event.timestamp);
      if (at < start || at > end) { integrity.outsideWindow++; continue; }
      if (conflicting.has(event.requestId)) continue;
      const previous = byId.get(event.requestId);
      if (previous) {
        if (JSON.stringify(previous) === JSON.stringify(event)) integrity.duplicate++;
        else { byId.delete(event.requestId); conflicting.add(event.requestId); integrity.conflictingDuplicate++; }
      } else byId.set(event.requestId, event);
    }
  }
  const events = [...byId.values()];
  integrity.sourceLimitReached = sourceLimit !== null && integrity.inputLines >= sourceLimit;
  integrity.completeInput = integrity.candidates > 0 && !integrity.sourceLimitReached && integrity.invalid === 0 && integrity.conflictingDuplicate === 0;
  const traffic = events.filter(event => !['/api/health', '/api/ready'].includes(event.route));
  const probes = events.filter(event => ['/api/health', '/api/ready'].includes(event.route));
  const groups = new Map();
  for (const event of traffic) {
    const key = JSON.stringify([event.method, event.route, event.transport]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return {
    schemaVersion: 1, window: { from: new Date(start).toISOString(), to: new Date(end).toISOString() },
    minimumSamples: { ratesAndP95: SAMPLE_FLOOR, p99: P99_SAMPLE_FLOOR }, integrity,
    traffic: measures(traffic, integrity.completeInput), probes: measures(probes, integrity.completeInput),
    routes: [...groups.entries()].map(([key, rows]) => {
      const [method, route, transport] = JSON.parse(key);
      return { method, route, transport, ...measures(rows, integrity.completeInput) };
    }).sort((a, b) => b.requests - a.requests || a.route.localeCompare(b.route) || a.method.localeCompare(b.method)),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (![2, 4].includes(args.length) || args[0] !== '--minutes' || !/^\d+$/.test(args[1]) ||
      (args.length === 4 && (args[2] !== '--source-limit' || !/^\d+$/.test(args[3])))) throw new Error('INVALID_ARGUMENTS');
  const minutes = Number(args[1]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('INVALID_WINDOW');
  const sourceLimit = args.length === 4 ? Number(args[3]) : null;
  const to = new Date(), from = new Date(to.getTime() - minutes * 60000);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  console.log(JSON.stringify(await summarizeRequestObservations(lines, { from: from.toISOString(), to: to.toISOString(), sourceLimit })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error instanceof Error && error.message === 'INVALID_WINDOW' ? 'INVALID_WINDOW' : 'REQUEST_SUMMARY_FAILED');
  process.exitCode = 1;
});
