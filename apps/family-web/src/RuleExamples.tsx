import type { Locale, TaskId } from '../../../packages/task-engine/index.ts';
import { ruleExamples } from '../../../packages/content/rule-examples.ts';
import { itemLabel } from '../../../packages/content/copy.ts';
import { Stimulus } from './Stimulus.tsx';
import './rule-examples.css';

export function RuleExamples({ task, locale, teen }: { task: TaskId; locale: Locale; teen: boolean }) {
  const examples = ruleExamples(task, locale);
  if (!examples) return null;
  return <div className="rule-examples" role="group" aria-label={locale === 'en' ? 'Examples for this rule' : '这条规则的示例'}>
    <div className="rule-example rule-example-target">
      <strong>{examples.targetAction}</strong>
      <Stimulus item={examples.target} locale={locale} teen={teen} />
      <span>{itemLabel(examples.target, locale, teen)}</span>
    </div>
    <div className="rule-example rule-example-other">
      <strong>{examples.otherAction}</strong>
      <div className="rule-example-items">{examples.others.map(item => <span className="rule-example-item" key={item}><Stimulus item={item} locale={locale} teen={teen} /><span>{itemLabel(item, locale, teen)}</span></span>)}</div>
    </div>
  </div>;
}
