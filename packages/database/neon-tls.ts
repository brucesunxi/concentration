// Preserve a verified TLS connection when a Neon URL is reused with newer pg
// versions. pg-connection-string 2 treats sslmode=require as verify-full, but
// its next major version will follow weaker libpq semantics for that value.
export function verifiedPostgresUrl(connectionString: string): string {
  let url: URL;
  try { url = new URL(connectionString); }
  catch { return connectionString; }
  if (!url.hostname.replace(/\.$/, '').endsWith('.neon.tech')) return connectionString;
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('NEON_POSTGRES_URL_REQUIRED');
  const mode = url.searchParams.get('sslmode');
  if (mode === 'disable' || mode === 'no-verify') throw new Error('NEON_TLS_VERIFICATION_REQUIRED');
  if (mode === 'verify-full' && url.searchParams.getAll('sslmode').length === 1) return connectionString;
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}
