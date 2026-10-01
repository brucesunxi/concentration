import { useEffect, useRef, useState } from 'react';
import { LifeClient, initialLifeState } from './client.ts';
import type { LifeClientState, LifeRequest } from './client.ts';
import type { GoalInput, GoalAction, LifeGoal } from './model.ts';

export function useLifeSpace(childId: string, role: 'parent' | 'child', request: LifeRequest, id: () => string) {
  const current = useRef<LifeClient | null>(null);
  const [state, setState] = useState<LifeClientState>(()=>({...initialLifeState(),busy:true}));
  useEffect(() => {
    const client = new LifeClient(childId, role, request, id, setState); current.current = client;
    setState(client.state); void client.load();
    // Refresh an open online view after another device changes a sharing choice.
    // Platform scheduling is not an immediate cross-device erasure guarantee.
    const refresh=setInterval(()=>void client.refreshBackground(),15000);
    return () => { clearInterval(refresh);client.dispose(); if (current.current === client) current.current = null; };
  }, [childId, role, request, id]);
  return { state, reload: () => current.current?.load(true), move: (direction:'older'|'newer')=>current.current?.move(direction), create: (input: Omit<GoalInput, 'intent'|'contentHash'>) => current.current?.create(input), act: (goal: LifeGoal, action: GoalAction) => current.current?.act(goal, action) };
}
