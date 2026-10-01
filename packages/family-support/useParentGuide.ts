import { useEffect, useRef, useState } from 'react';
import { ParentGuideClient } from './parent-guide-client.ts';
import type { GuideState } from './parent-guide-client.ts';
import type { LifeRequest } from './client.ts';

export function useParentGuide(childId: string, request: LifeRequest) {
  const current = useRef<ParentGuideClient | null>(null);
  const [state, setState] = useState<GuideState>({ data: null, busy: true, error: '' });
  useEffect(() => {
    const client = new ParentGuideClient(childId, request, setState); current.current = client;
    setState(client.state); void client.load();
    const interval = setInterval(() => void client.load(), 15000);
    return () => { clearInterval(interval); client.dispose(); if (current.current === client) current.current = null; };
  }, [childId, request]);
  return { state, reload: () => current.current?.load() };
}
