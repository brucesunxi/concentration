import { next } from '@vercel/functions';
import { playInternalEdgeDecision } from './packages/mobile-release/play-internal-android.ts';

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
