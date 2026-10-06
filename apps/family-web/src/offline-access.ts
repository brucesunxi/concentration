const marker = 'focus-offline-access-blocked';
let blockedHere = false;

function cookieBlocked() {
  try { return document.cookie.split(';').some(part => part.trim() === `${marker}=1`); }
  catch { return true; }
}

export function offlineRecoveryBlocked() {
  if (blockedHere || cookieBlocked()) return true;
  try { return localStorage.getItem(marker) === '1'; }
  catch { return true; }
}

/** A successful or uncertain sign-out must not reopen an old offline child grant. */
export function blockOfflineRecovery() {
  blockedHere = true;
  try { localStorage.setItem(marker, '1'); } catch { /* The cookie is a second durable guard. */ }
  try { document.cookie = `${marker}=1; Path=/; Max-Age=2592000; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { /* Keep the in-page guard. */ }
}

/** Call only after server identity and this browser's journal have been reconciled. */
export function allowOfflineRecovery() {
  try { localStorage.removeItem(marker); } catch { return false; }
  try { document.cookie = `${marker}=; Path=/; Max-Age=0; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { return false; }
  if (cookieBlocked()) return false;
  blockedHere = false;
  return true;
}
