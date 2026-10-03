import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler from '../../api/index.ts';

test('a real Vercel initialization failure returns the same generated request ID as its single safe log and can retry', async () => {
  const mode = process.env.APP_MODE, logging = process.env.FOCUS_HTTP_LOGS, write = console.log, writeError = console.error;
  const lines: string[] = [], secret = 'synthetic-private-startup-query';
  class Response extends EventEmitter {
    headers = new Map<string, string>(); headersSent = false; writableFinished = false; statusCode = 200; body = '';
    setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); }
    writeHead(status: number, headers: Record<string, string>) { this.statusCode = status; this.headersSent = true; Object.entries(headers).forEach(([key,value]) => this.setHeader(key,value)); }
    end(body: string) { this.body = body; this.writableFinished = true; this.emit('finish'); this.emit('close'); }
  }
  try {
    process.env.APP_MODE = 'production'; process.env.FOCUS_HTTP_LOGS = '1'; console.error = (line: string) => { lines.push(line); }; console.log = () => { throw new Error('Startup errors must use the error log level'); };
    const responses: Response[] = [];
    for (let i = 0; i < 2; i++) {
      const response = new Response(); responses.push(response);
      await handler({ url: '/api/ready?private=' + secret, method: 'GET', headers: { 'x-request-id': secret } } as unknown as IncomingMessage, response as unknown as ServerResponse);
      const body = JSON.parse(response.body), event = JSON.parse(lines[i]);
      assert.equal(response.statusCode, 503); assert.equal(body.code, 'SERVICE_UNAVAILABLE');
      assert.equal(body.requestId, response.headers.get('x-request-id')); assert.equal(event.requestId, body.requestId);
      assert.equal(event.code, body.code); assert.equal(event.source, 'vercel'); assert.equal(event.route, '/api/ready'); assert.equal(event.outcome, 'error');
      assert.equal(event.version, null); assert.equal(event.runtimeWaitMs, null); assert.equal(lines[i].includes(secret), false);
      assert.match(response.headers.get('cache-control')!, /no-store/);
    }
    assert.equal(lines.length, 2); assert.notEqual(responses[0].headers.get('x-request-id'), responses[1].headers.get('x-request-id'));
    assert.equal(JSON.stringify(lines).includes('Production release remains gated'), false);
  } finally { console.log = write; console.error = writeError; if (mode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = mode; if (logging === undefined) delete process.env.FOCUS_HTTP_LOGS; else process.env.FOCUS_HTTP_LOGS = logging; }
});
