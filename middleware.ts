import { next } from '@vercel/functions';

// Vercel compiles this file alone to middleware.js. A .ts import is not placed in that bundle.
const CONTENT_ASSET_PATH = /^\/content-assets\/[a-f0-9]{64}\.(png|mp3)$/;

export function playInternalEdgeDecision(input: { enabled: string | undefined; environment: string | undefined; pathname: string }): { action: 'continue' | 'deny'; apiOnly: boolean; status?: 404; code?: 'PLAY_INTERNAL_API_ONLY' } {
  const apiOnly = input.enabled === '1' && input.environment !== 'production';
  if (!apiOnly) return { action: 'continue', apiOnly: false };
  const path = input.pathname.toLowerCase();
  const asset = CONTENT_ASSET_PATH.test(input.pathname);
  const api = path.startsWith('/api/') && !path.startsWith('/api/studio') && !path.startsWith('/api/admin') && !path.startsWith('/api/support');
  const allowed = input.pathname.startsWith('/') && !input.pathname.includes('\\') && !input.pathname.includes('\0') && (path === '/api/health' || path === '/api/ready' || api || asset);
  if (allowed) return { action: 'continue', apiOnly: true };
  return { action: 'deny', apiOnly: true, status: 404, code: 'PLAY_INTERNAL_API_ONLY' };
}

export default function middleware(request: Request) {
  const decision = playInternalEdgeDecision({
    enabled: process.env.FOCUS_PLAY_INTERNAL_API,
    environment: process.env.VERCEL_ENV,
    pathname: new URL(request.url).pathname,
  });
  if (decision.action === 'deny') {
    return new Response(JSON.stringify({ code: decision.code }), {
      status: decision.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-robots-tag': 'noindex',
      },
    });
  }
  if (decision.apiOnly) return next({ headers: { 'x-robots-tag': 'noindex' } });
  return next();
}
