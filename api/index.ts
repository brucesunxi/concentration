import type http from 'node:http';
import { createFamilyServer } from '../apps/api/main.ts';

const server = createFamilyServer({ serverless: true }).then(result => result.server);

export default async function handler(request: http.IncomingMessage, response: http.ServerResponse) {
  (await server).emit('request', request, response);
}
