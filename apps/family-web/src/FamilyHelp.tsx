import type { Locale } from '../../../packages/task-engine/index.ts';
import { familyHelpCopy } from '../../../packages/family-support/family-help.ts';
import type { FamilyHelpAction } from '../../../packages/family-support/family-help.ts';
import './family-help.css';

export default function FamilyHelp({ locale, role, hasChild, onAction }: { locale: Locale; role: 'parent' | 'child'; hasChild: boolean; onAction(action: FamilyHelpAction): void }) {
  const copy = familyHelpCopy(locale, role);
  return <section className="family-help" aria-label={copy.title}>
    <p className="lead">{copy.introduction}</p>
    <div className="family-help-grid">{copy.cards.map(card => <article className="family-help-card" key={card.title}>
      <h2>{card.title}</h2><p>{card.body}</p>
      {card.action && hasChild && <button className="quiet" onClick={() => onAction(card.action)}>{card.actionLabel}</button>}
    </article>)}</div>
    <p className="family-help-closing">{copy.closing}</p>
  </section>;
}
