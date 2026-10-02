// Vercel turns an unused /api/:path* rewrite capture into ?path=... when
// forwarding to /api/index. It is routing metadata, not a client query field.
export function requestQuery(url: URL, serverless = false): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (serverless && key === 'path' && values.length === 1 &&
      url.pathname.startsWith('/api/') && values[0] === url.pathname.slice('/api/'.length)) continue;
    query[key] = values.length === 1 ? values[0] : values;
  }
  return query;
}
