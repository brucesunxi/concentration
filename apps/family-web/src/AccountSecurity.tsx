import { useState } from 'react';
import type { FormEvent } from 'react';
import { ShieldCheck, KeyRound, LogOut } from 'lucide-react';
import type { Locale } from '../../../packages/task-engine/index.ts';
import type { AccountAction } from '../../../packages/contracts/account-security.ts';
import { newPasswordSchema } from '../../../packages/contracts/account-security.ts';
import { useAccountSecurity } from '../../../packages/session-runtime/useAccountSecurity.ts';
import { securityCopy } from '../../../packages/session-runtime/account-security-copy.ts';
import { request } from './api.ts';
import './account-security.css';

export default function AccountSecurity({ familyId, locale, onSignIn }: { familyId: string; locale: Locale; onSignIn(): void }) {
  const { state, reload, submit } = useAccountSecurity(familyId, request), c = securityCopy(locale,state.data?.memberRole ?? 'owner');
  const [action, setAction] = useState<AccountAction | null>(null), [current, setCurrent] = useState(''), [next, setNext] = useState(''), [repeat, setRepeat] = useState(''), [ack, setAck] = useState(false);
  function reset() { setCurrent(''); setNext(''); setRepeat(''); setAck(false); }
  async function confirm(event: FormEvent) {
    event.preventDefault(); if (!action || !current || !ack || state.busy || (action === 'password' && (!newPasswordSchema.safeParse(next).success || next !== repeat))) return;
    const input = { currentPassword: current, ...(action === 'password' ? { newPassword: next } : {}), acknowledged: true as const }; reset();
    await submit(action, input);
  }
  return <section className="family-card account-security" aria-labelledby="security-heading">
    <div className="section-title"><h2 id="security-heading"><ShieldCheck size={22} />{c.title}</h2></div><p className="subtle">{c.intro}</p>
    {state.outcome ? <><p role="status" className="notice">{state.outcome === 'password' ? c.changed : state.outcome === 'signout' ? c.signedOut : state.outcome === 'uncertain' ? c.uncertain : c.ended}</p><button className="primary" onClick={onSignIn}>{c.signin}</button></> : <>
      {state.error && <p role="alert" className="notice error">{c.error(state.error)}</p>}
      {!state.data ? <>{state.busy ? <p role="status">{c.loading}</p> : <button className="quiet" onClick={() => void reload()}>{c.retry}</button>}</> : <>
        <h3>{c.sessions}</h3><dl className="security-counts"><div><dt>{c.parents}</dt><dd>{c.browsers} {state.data.active.parent.web} · {c.apps} {state.data.active.parent.native}</dd></div><div><dt>{c.children}</dt><dd>{c.browsers} {state.data.active.child.web} · {c.apps} {state.data.active.child.native}</dd></div></dl><p className="subtle">{c.counts}</p>
        {!action ? <div className="security-choices"><button className="quiet" onClick={() => { reset(); setAction('password'); }}><KeyRound size={19} />{c.password}</button><button className="quiet" onClick={() => { reset(); setAction('signout'); }}><LogOut size={19} />{c.signout}</button></div> : <form className="stack-form" onSubmit={event => void confirm(event)}>
          <h3>{action === 'password' ? c.password : c.signout}</h3><p id="security-effect">{c.consequence}</p>
          <label>{c.current}<input autoFocus type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required maxLength={128} disabled={state.busy} /></label>
          {action === 'password' && <><label>{c.next}<input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required maxLength={128} aria-describedby="security-password-hint" disabled={state.busy} /></label><p id="security-password-hint" className="subtle">{c.hint}</p><label>{c.repeat}<input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} required maxLength={128} disabled={state.busy} /></label>{repeat && next !== repeat && <p role="status">{c.mismatch}</p>}</>}
          <label className="check-label"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} disabled={state.busy} aria-describedby="security-effect" />{c.acknowledge}</label>
          <div className="security-choices"><button className="primary" disabled={state.busy || !current || !ack || (action === 'password' && (!newPasswordSchema.safeParse(next).success || next !== repeat))}>{state.busy ? c.busy : action === 'password' ? c.save : c.confirmSignout}</button><button className="quiet" type="button" disabled={state.busy} onClick={() => { reset(); setAction(null); }}>{c.cancel}</button></div>
        </form>}
      </>}
    </>}
  </section>;
}
