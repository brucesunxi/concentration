/** Arming readiness: avoid false "display not ready" pauses from a single zero-delta RAF pair. */
export const PRESENTATION_ARM_ATTEMPTS = 8;

export function isPositiveFrameDelta(frameDeltaMs: number): boolean {
  return Number.isFinite(frameDeltaMs) && frameDeltaMs > 0;
}

export function shouldRetryPresentationArm(input: {
  attempt: number;
  frameDeltaMs: number;
  assetsReady: boolean;
  maxAttempts?: number;
}): boolean {
  const max = input.maxAttempts ?? PRESENTATION_ARM_ATTEMPTS;
  if (input.attempt >= max) return false;
  if (!input.assetsReady) return true;
  return !isPositiveFrameDelta(input.frameDeltaMs);
}
