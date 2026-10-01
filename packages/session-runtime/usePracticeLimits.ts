import { useEffect, useRef, useState } from 'react';
import { PracticeLimitClient } from './practice-limit-client.ts';
import type { LimitState } from './practice-limit-client.ts';
export function usePracticeLimits(childId: string, parent: boolean, request: ConstructorParameters<typeof PracticeLimitClient>[2]) {
  const client = useRef<PracticeLimitClient | null>(null);
  const [state, setState] = useState<LimitState>({ data: null, busy: true, error: '', saved: false, needsParent: false });
  useEffect(() => { const next = new PracticeLimitClient(childId, parent, request, setState); client.current = next; setState(next.state); void next.load(); return () => { next.dispose(); if (client.current === next) client.current = null; }; }, [childId, parent, request]);
  return { state, reload: () => client.current?.load(), save: (minutes: number) => client.current?.save(minutes) };
}
