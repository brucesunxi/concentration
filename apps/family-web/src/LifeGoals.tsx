import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../../../packages/task-engine/index.ts';
import type { GoalInput, LifeGoal, Reflection, Support } from '../../../packages/family-support/model.ts';
import { openGoal,sharedReflection,reflectionAction,usableGoalContent } from '../../../packages/family-support/model.ts';
import { lifeError, reflectionLabels, reflectionQuestions, reflectionLines, stateLabels, supportLabels,sharingLabels } from '../../../packages/family-support/catalogue.ts';
import { contentLabel } from '../../../packages/family-support/publication-copy.ts';
import { guideCopy } from '../../../packages/family-support/parent-guide-copy.ts';
import { useLifeSpace } from '../../../packages/family-support/useLifeSpace.ts';
import { lifeHistoryCopy } from '../../../packages/family-support/history-copy.ts';
import { translate } from './content.ts';
import { request } from './api.ts';
import './life.css';

const id = () => crypto.randomUUID();
export default function LifeGoals({ childId, role, locale, entering, onEnterChild, initialTemplate }: { childId: string; role: 'parent' | 'child'; locale: Locale; initialTemplate?: GoalInput['templateId']; entering: boolean; onEnterChild(): void }) {
  const t = translate(locale), { state, create, act, reload, move } = useLifeSpace(childId, role, request, id), historyCopy=lifeHistoryCopy(locale);
  const historyHeading=useRef<HTMLHeadingElement>(null);
  const turnPage=async(direction:'older'|'newer')=>{if(await move(direction)){historyHeading.current?.focus();historyHeading.current?.scrollIntoView({block:'start'});}};
  const [selected, setSelected] = useState<GoalInput['templateId'] | null>(initialTemplate ?? null), [support, setSupport] = useState<Support>('ask-first');
  const [reviewing, setReviewing] = useState(false), [reflection, setReflection] = useState<Partial<Reflection>>({}), [share,setShare]=useState(false);
  const data = state.data, goal = data?.goals.find(openGoal), busy = state.busy || entering;
  useEffect(() => { setSupport(goal?.support ?? 'ask-first'); setReflection({}); setShare(false);setReviewing(false); setSelected(goal ? null : initialTemplate ?? null); }, [goal?.id, goal?.version, data?.content.hash, data?.content.state, goal?.contentHash?data?.releases[goal.contentHash]?.state:null, initialTemplate]);
  const helpChoices = () => <fieldset className="life-choices" disabled={busy}><legend>{t('怎样帮助比较合适？', 'What kind of help would suit you?')}</legend>{(Object.keys(supportLabels) as Support[]).map(value => <label key={value}><input type="radio" name="life-support" checked={support === value} onChange={() => setSupport(value)} />{supportLabels[value][locale]}</label>)}</fieldset>;

  return <section className="life-space" aria-busy={busy}>
    <header><h2>{t('一个小目标，随时可以停', 'One small goal. You can stop at any time.')}</h2><p>{role === 'parent' ? t('目标、帮助约定和回顾是否结束，家长可以看见。具体答案由孩子选择是否分享；未分享的答案不会保存。', 'You can see goals, agreed support and whether a reflection has finished. Children choose whether to share their answers. Unshared answers are not saved.') : t('目标、帮助约定和回顾是否结束，家长可以看见。每次回顾的具体答案，由你选择是否分享；未分享的答案不会保存。', 'Parents can see the goal, agreed support and whether a reflection has finished. You choose whether to share each reflection’s answers. Unshared answers are not saved.')}</p></header>
    {state.error && <p className="notice error" role="alert">{lifeError(state.error, locale)}</p>}
    {state.saved && <p className="notice" role="status">{t('已保存到家庭空间。', 'Saved to your family space.')}</p>}
    {busy && <p role="status">{t('正在读取或保存…', 'Loading or saving…')}</p>}
    <button className="quiet" disabled={busy} onClick={() => void reload()}>{historyCopy.refresh}</button>
    {data && <p className="notice">{contentLabel(data.content,locale)}</p>}
    {data && !data.collectionActive && <p className="notice">{t('此档案已停止采集，已有记录可以查看。', 'Collection has stopped. Existing records can be read.')}</p>}
    {data && role === 'parent' && data.collectionActive && <aside className="life-parent-note"><h3>{t('先邀请，再听孩子的选择', 'Invite, then listen to their choice')}</h3><p>{t('建议不会自动记为孩子同意。把设备交给孩子后，可以一起看规则，也可以选择不做。', 'A suggestion is not recorded as agreement. Hand over the device, read it together if helpful, and allow a choice not to do it.')}</p><button className="primary" disabled={busy} onClick={onEnterChild}>{t('交给孩子，进入孩子空间', 'Hand over and open the child space')}</button></aside>}
    {data && !goal && data.collectionActive && data.content.state==='available' && <div className="life-card-panel">{initialTemplate && <p className="notice">{guideCopy.selectedSuggestion[locale]}</p>}<h3>{role === 'parent' ? t('提出一个小建议', 'Suggest one small activity') : t('选一个你愿意尝试的', 'Choose something you want to try')}</h3><fieldset disabled={busy} className="life-template-grid"><legend>{t('一次只选一个就够了', 'One at a time is enough')}</legend>{data.templates.map(template => <label key={template.id} className={selected === template.id ? 'chosen' : ''}><input type="radio" name="life-template" checked={selected === template.id} onChange={() => setSelected(template.id)} /><span><strong>{template.title[locale]}</strong><span>{template.steps[0][locale]}</span></span></label>)}</fieldset>{selected && <ol className="life-steps">{data.templates.find(t => t.id === selected)?.steps.map((step, index) => <li key={index}>{step[locale]}</li>)}</ol>}{helpChoices()}<button className="primary" disabled={busy || !selected} onClick={() => selected && void create({ templateId: selected, support })}>{role === 'parent' ? t('保存建议，等待商量', 'Save a suggestion to discuss') : t('我愿意试一小步', 'I want to try a small step')}</button><p className="subtle">{t('不想选也没关系，可以返回家庭空间。没有倒计时，也不需要连续打卡。', 'You can leave without choosing. There is no countdown or daily streak to keep.')}</p></div>}
    {goal && <article className="life-card-panel"><span className="pill">{stateLabels[goal.state][locale]}</span><h3>{goal.template.title[locale]}</h3>{data&&usableGoalContent(goal,data)?<><ol className="life-steps">{goal.template.steps.map((step, index) => <li key={index}>{step[locale]}</li>)}</ol><aside className="life-parent-tip"><strong>{t('家人可以这样帮忙', 'A way for family to help')}</strong><p>{goal.template.parentTip[locale]}</p></aside></>:<p className="notice">{t('这份目标的内容已停用。可以结束目标，已有记录会保留。','This activity is unavailable. You can stop the goal; existing records remain.')}</p>}<p>{goal.state === 'proposed' ? t('建议的帮助：', 'Suggested help: ') : t('约定的帮助：', 'Agreed help: ')}{supportLabels[goal.support][locale]}</p>
      {data?.collectionActive && usableGoalContent(goal,data) && role === 'child' && goal.state === 'proposed' && <>{helpChoices()}<div className="button-row"><button className="primary" disabled={busy} onClick={() => void act(goal, { action: 'accept', support })}>{t('我愿意这样试', 'I want to try this')}</button><button className="quiet" disabled={busy} onClick={() => void act(goal, { action: 'decline' })}>{t('这次不选它', 'Not this one')}</button></div></>}
      {data?.collectionActive && usableGoalContent(goal,data) && role === 'child' && goal.state === 'active' && <>{!reviewing ? <button className="primary" disabled={busy} onClick={() => setReviewing(true)}>{t('回来后，记一下自己的想法', 'When you return, add your reflection')}</button> : <div className="life-reflection"><h4>{t('你想怎样记录这一次？', 'How would you describe this time?')}</h4><p>{t('没有正确答案，也可以跳过问题。正在选择的答案会显示在这台设备上。', 'There are no right answers. You can skip questions. Your choices are visible on this device while you reflect.')}</p>{(Object.keys(reflectionLabels) as (keyof Reflection)[]).map(key => <fieldset key={key} disabled={busy} className="life-choices"><legend>{reflectionQuestions[key][locale]}</legend>{Object.entries(reflectionLabels[key]).map(([value, label]) => <label key={value}><input type="radio" name={`reflection-${key}`} checked={reflection[key] === value} onChange={() => setReflection(current => ({ ...current, [key]: value }))} />{label[locale]}</label>)}</fieldset>)}<fieldset className="life-choices life-sharing" disabled={busy}><legend>{t('这次答案要分享给家长吗？','Share these answers with your family?')}</legend><label><input type="radio" name="reflection-sharing" checked={!share} onChange={()=>setShare(false)}/>{t('不分享，只记回顾结束','Do not share; only record that I finished reflecting')}</label><label><input type="radio" name="reflection-sharing" checked={share} onChange={()=>setShare(true)}/>{t('分享这次的三个答案','Share these three answers')}</label></fieldset><p className="subtle">{share?t('确认后，家长可以在记录和导出文件中看到这三个答案。以后可撤回分享。','After confirmation, parents can see these three answers in records and exports. You can remove the shared answers later.'):t('不上传或保存这些答案。离开回顾后，答案不会保留，也不能找回。','These answers will not be uploaded or saved. They will be cleared when you leave the reflection and cannot be recovered.')}</p><button className="primary" disabled={busy || (share&&(!reflection.outcome || !reflection.helpful || !reflection.next))} onClick={() => void act(goal,reflectionAction(share,reflection as Reflection))}>{share?t('确认分享这三个答案','Confirm and share these answers'):t('只记回顾结束，不保存答案','Finish reflecting without saving answers')}</button></div>}</>}
      {data?.collectionActive && <button className="text-button" disabled={busy} onClick={() => void act(goal, { action: 'stop' })}>{t('先停下这个目标', 'Stop this goal for now')}</button>}
    </article>}
    {data && <section className="life-history-section"><h3 ref={historyHeading} tabIndex={-1}>{t('以前的小尝试', 'Earlier small attempts')}</h3><p className="subtle">{historyCopy.explanation(data.total)}</p>
      <nav className="life-history-pages" aria-label={historyCopy.navigation}>
        <p role="status">{historyCopy.page(state.historyPage,data.goals.filter(g=>!openGoal(g)).length)}</p>
        <div className="button-row"><button className="quiet" disabled={busy||state.historyPage===1} onClick={()=>void turnPage('newer')}>{historyCopy.newer}</button><button className="quiet" disabled={busy||!data.history.nextCursor} onClick={()=>void turnPage('older')}>{historyCopy.older}</button></div>
        {state.paging&&<p role="status">{historyCopy.loading}</p>}{state.historyError&&<p className="notice error" role="alert">{lifeError(state.historyError,locale)}</p>}
        {!data.history.nextCursor&&<p className="subtle">{historyCopy.end}</p>}
      </nav>
      {data.goals.filter(g => !openGoal(g)).map(item=><History key={item.id} item={item} locale={locale} busy={busy} onRemove={()=>void act(item,{action:'unshare'})}/>)}
      {!data.goals.some(g=>!openGoal(g)) && <p>{historyCopy.empty}</p>}
    </section>}
  </section>;
}

function History({item,locale,busy,onRemove}:{item:LifeGoal;locale:Locale;busy:boolean;onRemove():void}){
  const t=translate(locale),[confirm,setConfirm]=useState(false);
  useEffect(()=>setConfirm(false),[item.version]);
  return <details className="life-history"><summary>{item.template.title[locale]} · {stateLabels[item.state][locale]}<span className="subtle life-created">{t('创建于 ','Created ')}<time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(locale)}</time></span></summary>
    <p>{supportLabels[item.support][locale]}</p>{item.state==='reflected'&&<p className="life-sharing-status">{sharingLabels[item.reflectionSharing][locale]}</p>}
    {item.reflection&&<ul>{reflectionLines(item.reflection,locale).map((text,index)=><li key={index}>{text}</li>)}</ul>}
    {sharedReflection(item)&&<>{!confirm?<button className="quiet" disabled={busy} onClick={()=>setConfirm(true)}>{t('撤回分享的答案','Remove shared answers')}</button>:<div className="life-remove" role="group" aria-label={t('确认移除答案','Confirm answer removal')}><p>{t('移除后，这里和以后导出的记录不再包含答案，无法恢复。已经看过或另存的内容无法收回。目标和回顾结束记录会保留。','The answers will be removed from these records and future exports and cannot be restored. Previously viewed or saved copies cannot be taken back. The goal and finished reflection remain.')}</p><div className="button-row"><button className="quiet" disabled={busy} onClick={()=>setConfirm(false)}>{t('先保留','Keep for now')}</button><button className="primary" disabled={busy} onClick={onRemove}>{t('确认移除答案','Confirm removal')}</button></div></div>}</>}
    <p className="subtle">{item.createdBy==='parent'?t('由家长空间提出','Suggested in the parent space'):t('从孩子空间选择','Chosen in the child space')} · {new Date(item.updatedAt).toLocaleDateString(locale)}</p>
    {item.closedReason==='withdrawn'&&<p>{t('因停止采集而关闭。','Closed when collection stopped.')}</p>}
  </details>;
}
