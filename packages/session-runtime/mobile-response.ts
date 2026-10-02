import { NetworkUnavailable } from './offline-session.ts';

// A request can time out after response headers arrive but before JSON finishes.
// Only the controller's own abort is an offline signal; malformed JSON is not.
export async function readMobileResponseJson<T>(response: { json(): Promise<unknown> }, signal: AbortSignal): Promise<T> {
  try { return await response.json() as T; }
  catch (error) {
    if (signal.aborted) throw new NetworkUnavailable();
    throw error;
  }
}
