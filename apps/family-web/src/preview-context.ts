/** The development API may run locally or behind a protected hosted preview. */
export function isHostedPreview(hostname = typeof window === 'undefined' ? 'localhost' : window.location.hostname) {
  return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1';
}
