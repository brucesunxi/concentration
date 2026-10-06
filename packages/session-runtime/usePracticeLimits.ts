import { useCallback, useEffect, useRef, useState } from 'react';
import { PracticeLimitClient } from './practice-limit-client.ts';
import type { LimitState } from './practice-limit-client.ts';
import { practiceLimitsRefreshDelay } from './practice-limit-refresh.ts';
const alwaysActive = () => true;
export function usePracticeLimits(childId: string, parent: boolean, request: ConstructorParameters<typeof PracticeLimitClient>[2], isActive: () => boolean = alwaysActive) {
  const client = useRef<PracticeLimitClient | null>(null);
  const [state, setState] = useState<LimitState>({ data: null, busy: true, refreshing: false, stale: false, error: '', saved: false, needsParent: false });
  useEffect(() => { const next = new PracticeLimitClient(childId, parent, request, setState); client.current = next; setState(next.state); void next.load(); return () => { next.dispose(); if (client.current === next) client.current = null; }; }, [childId, parent, request]);
  const reload = useCallback(() => client.current?.refresh(), []);
  const refresh = useCallback(() => client.current?.refresh(), []);
  const save = useCallback((minutes: number) => client.current?.save(minutes), []);
  const pauseToday = useCallback(() => client.current?.pauseToday(), []);
  useEffect(() => {
    if (state.busy || state.needsParent) return;
    const timer = setTimeout(() => { if (isActive()) void refresh(); }, practiceLimitsRefreshDelay(state.stale ? null : state.data));
    return () => clearTimeout(timer);
  }, [state.busy, state.needsParent, state.stale, state.data, isActive, refresh]);
  return { state, reload, refresh, save, pauseToday };
}
