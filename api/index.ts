import type http from 'node:http';
import { createFamilyServer } from '../apps/api/main.ts';
import { observeFamilyRequest, familyRequestLoggingEnabled } from '../apps/api/request-observation.ts';

let server: Promise<http.Server> | undefined;

export default async function handler(request: http.IncomingMessage, response: http.ServerResponse) {
  const observation = observeFamilyRequest(request, response, { enabled: familyRequestLoggingEnabled(true), source: 'vercel' });
  try {
    const ready = server ??= createFamilyServer({ serverless: true }).then(result => result.server).catch(error => {
      server = undefined;
      throw error;
    });
    const runtime = await ready;
    observation.runtimeReady();
    await new Promise<void>(resolve => {
      if (response.writableFinished || response.destroyed) { resolve(); return; }
      response.once('finish', resolve);
      response.once('close', resolve);
      runtime.emit('request', request, response);
    });
  } catch {
    observation.setFailure('SERVICE_UNAVAILABLE');
    if (!response.headersSent) {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试。', requestId: observation.requestId }));
    }
  }
}
