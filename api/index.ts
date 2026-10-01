import type http from 'node:http';
import { createFamilyServer } from '../apps/api/main.ts';

let server: Promise<http.Server> | undefined;

export default async function handler(request: http.IncomingMessage, response: http.ServerResponse) {
  try {
    const ready = server ??= createFamilyServer({ serverless: true }).then(result => result.server).catch(error => {
      server = undefined;
      throw error;
    });
    (await ready).emit('request', request, response);
  } catch (error) {
    console.error(JSON.stringify({ event: 'API_STARTUP_FAILED', code: error instanceof Error ? error.name : 'UnknownError' }));
    if (!response.headersSent) {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试。' }));
    }
  }
}
