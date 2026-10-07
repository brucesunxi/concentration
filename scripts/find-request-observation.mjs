import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseRequestObservation } from './summarize-request-observations.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Return only the validated application event, never Vercel's path or message wrapper. */
export async function findRequestObservation(lines, requestId, sourceLimit = null) {
  if (typeof requestId !== 'string' || !UUID.test(requestId) ||
      (sourceLimit !== null && (!Number.isInteger(sourceLimit) || sourceLimit < 1))) throw new Error('INVALID_ARGUMENTS');
  let inputLines = 0, found = null;
  for await (const line of lines) {
    inputLines++;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const messages = Array.isArray(record?.logs) ? record.logs.map(log => log?.message) : [record?.message ?? record];
    for (const message of messages) {
      let value = message;
      if (typeof value === 'string') try { value = JSON.parse(value); } catch { continue; }
      if (typeof value?.requestId !== 'string' || value.requestId.toLowerCase() !== requestId.toLowerCase() ||
          value.event !== 'FAMILY_HTTP_REQUEST') continue;
      const observation = parseRequestObservation(value);
      if (!observation) throw new Error('INVALID_OBSERVATION');
      if (found && JSON.stringify(found) !== JSON.stringify(observation)) throw new Error('CONFLICTING_OBSERVATIONS');
      found = observation;
    }
  }
  return { found: !!found, sourceLimitReached: sourceLimit !== null && inputLines >= sourceLimit, observation: found };
}

async function main() {
  const args = process.argv.slice(2);
  if (![2, 4].includes(args.length) || args[0] !== '--request-id' || !UUID.test(args[1]) ||
      (args.length === 4 && (args[2] !== '--source-limit' || !/^\d+$/.test(args[3])))) throw new Error('INVALID_ARGUMENTS');
  const sourceLimit = args.length === 4 ? Number(args[3]) : null;
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  console.log(JSON.stringify(await findRequestObservation(lines, args[1], sourceLimit)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  const known = new Set(['INVALID_ARGUMENTS', 'INVALID_OBSERVATION', 'CONFLICTING_OBSERVATIONS']);
  console.error(error instanceof Error && known.has(error.message) ? error.message : 'REQUEST_LOOKUP_FAILED');
  process.exitCode = 1;
});
