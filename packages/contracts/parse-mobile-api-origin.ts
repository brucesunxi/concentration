export function parseMobileApiOrigin(value: string): { origin: string; local: boolean } {
  if (!value || value.trim() !== value) throw new Error('MOBILE_API_ORIGIN_INVALID');
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('MOBILE_API_ORIGIN_INVALID'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('MOBILE_API_ORIGIN_INVALID');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('MOBILE_API_ORIGIN_HTTPS_REQUIRED');
  return { origin: url.origin, local };
}
