import { useEffect, useRef, useState } from 'react';
import { CreditCard } from 'lucide-react';
import type { FamilyBillingStatus } from '../../../packages/contracts/family-billing.ts';
import type { Locale } from '../../../packages/task-engine/index.ts';
import { familyBillingCopy } from '../../../packages/session-runtime/family-billing-copy.ts';
import { familyBillingRefreshDelay } from '../../../packages/session-runtime/family-billing-refresh.ts';
import { request, RequestError } from './api.ts';
import './family-billing.css';

export default function FamilyBilling({ familyId, locale, onSignIn }: { familyId: string; locale: Locale; onSignIn(): void }) {
  const [status, setStatus] = useState<FamilyBillingStatus | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState(false);
  const sequence = useRef(0), active = useRef(true), signIn = useRef(onSignIn); signIn.current = onSignIn;
  async function reload() {
    const version = ++sequence.current;
    setBusy(true); setError(false);
    try {
      const next = await request<FamilyBillingStatus>('/family/billing');
      if (!active.current || version !== sequence.current) return;
      if (next.familyId !== familyId || next.version !== 'family-billing-1') throw new Error('BILLING_SCOPE_MISMATCH');
      setStatus(next);
    } catch (cause) {
      if (!active.current || version !== sequence.current) return;
      setStatus(null); setError(true);
      if (cause instanceof RequestError && (cause.status === 401 || cause.code === 'PARENT_REQUIRED' || cause.code === 'OWNER_REQUIRED')) signIn.current();
    } finally { if (active.current && version === sequence.current) setBusy(false); }
  }
  useEffect(() => {
    active.current = true; void reload();
    const visible = () => { if (!document.hidden) void reload(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active.current = false; sequence.current++; document.removeEventListener('visibilitychange', visible); };
  }, [familyId]);
  useEffect(() => {
    if (busy) return;
    const timer = window.setTimeout(() => { if (!document.hidden) void reload(); }, familyBillingRefreshDelay(status));
    return () => window.clearTimeout(timer);
  }, [busy, status, familyId]);
  const copy = familyBillingCopy(locale, status ?? undefined);
  return <section className="family-card family-billing" aria-labelledby="family-billing-heading">
    <div className="section-title"><h2 id="family-billing-heading"><CreditCard size={22} />{copy.title}</h2></div>
    {busy ? <p role="status">{locale === 'en' ? 'Checking family access…' : '正在确认家庭使用状态…'}</p> : <><h3>{copy.heading}</h3><p>{copy.detail}</p>{copy.until && <p>{copy.until}</p>}{copy.renewal && <p className="subtle">{copy.renewal}</p>}<p className="subtle">{copy.rights}</p></>}
    {error && <p role="alert" className="notice error">{locale === 'en' ? 'Access could not be confirmed. This does not remove saved records.' : '暂时无法确认使用状态；已有记录不会因此消失。'}</p>}
    <button className="quiet" disabled={busy} onClick={() => void reload()}>{locale === 'en' ? 'Refresh status' : '刷新状态'}</button>
  </section>;
}
