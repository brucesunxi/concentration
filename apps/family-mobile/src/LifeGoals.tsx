import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { Locale } from '../../../packages/task-engine/index.ts';
import type { GoalInput, LifeGoal, Reflection, Support } from '../../../packages/family-support/model.ts';
import { openGoal,sharedReflection,reflectionAction,usableGoalContent } from '../../../packages/family-support/model.ts';
import { lifeError, reflectionLabels, reflectionQuestions, reflectionLines, stateLabels, supportLabels,sharingLabels } from '../../../packages/family-support/catalogue.ts';
import { contentLabel } from '../../../packages/family-support/publication-copy.ts';
import { guideCopy } from '../../../packages/family-support/parent-guide-copy.ts';
import { useLifeSpace } from '../../../packages/family-support/useLifeSpace.ts';
import { lifeHistoryCopy } from '../../../packages/family-support/history-copy.ts';
import type { LifeRequest } from '../../../packages/family-support/client.ts';
import { translate } from '../../../packages/content/copy.ts';
import { Page, Button, Choice, Notice, s } from './ui';
import type { MobileClient } from './client';

interface Props {
  childId: string; role: 'parent' | 'child'; locale: Locale; client: MobileClient;
  entering: boolean; error: string; initialTemplate?: GoalInput['templateId']; onEnterChild(): void; onBack(): void;
}
export function LifeGoals({ childId, role, locale, client, entering, error, onEnterChild, onBack, initialTemplate }: Props) {
  const request = useMemo<LifeRequest>(() => (path, method, data, headers) => client.request(path, method, data, headers), [client]);
  const { state, create, act, reload, move } = useLifeSpace(childId, role, request, randomUUID), t = translate(locale), historyCopy=lifeHistoryCopy(locale);
  const [selected, setSelected] = useState<GoalInput['templateId'] | null>(initialTemplate ?? null), [support, setSupport] = useState<Support>('ask-first');
  const [reviewing, setReviewing] = useState(false), [reflection, setReflection] = useState<Partial<Reflection>>({}),[share,setShare]=useState(false);
  const data = state.data, goal = data?.goals.find(openGoal), busy = state.busy || entering;
  useEffect(() => { setSelected(goal ? null : initialTemplate ?? null); setSupport(goal?.support ?? 'ask-first'); setReviewing(false); setReflection({});setShare(false); }, [goal?.id, goal?.version, data?.content.hash, data?.content.state, goal?.contentHash?data?.releases[goal.contentHash]?.state:null, initialTemplate]);
  const helpChoices = () => <View style={s.field}>
    <Text style={s.label}>{t('怎样帮助比较合适？', 'What kind of help would suit you?')}</Text>
    {(Object.keys(supportLabels) as Support[]).map(value => <Choice key={value} label={supportLabels[value][locale]} selected={support === value} disabled={busy} onPress={() => setSupport(value)} />)}
  </View>;
  return <Page title={t('生活小目标', 'Everyday goals')} subtitle={t('先在这里商量，离开屏幕后再去做。一个小目标，随时可以停。', 'Talk it through here, then try it away from the screen. One small goal; stop at any time.')}>
    <Button quiet title={t('返回家庭空间', 'Back to family space')} disabled={entering} onPress={onBack} />
    <Notice>{role === 'parent' ? t('目标、帮助约定和回顾是否结束，家长可以看见。具体答案由孩子选择是否分享；未分享的答案不会保存。', 'You can see goals, agreed support and whether a reflection has finished. Children choose whether to share their answers. Unshared answers are not saved.') : t('目标、帮助约定和回顾是否结束，家长可以看见。每次答案由你选择是否分享；未分享的答案不会保存。', 'Parents can see the goal, agreed support and whether a reflection has finished. You choose whether to share the answers. Unshared answers are not saved.')}</Notice>
    <Notice>{error || (state.error && lifeError(state.error, locale))}</Notice>
    {state.saved && <Notice>{t('已保存到家庭空间。', 'Saved to your family space.')}</Notice>}
    {busy && <Text accessibilityLiveRegion="polite" style={s.muted}>{t('正在读取或保存…', 'Loading or saving…')}</Text>}
    <Button quiet title={historyCopy.refresh} disabled={busy} onPress={() => void reload()} />
    {data && <Notice>{contentLabel(data.content,locale)}</Notice>}
    {data && !data.collectionActive && <Notice>{t('此档案已停止采集，已有记录可以查看。', 'Collection has stopped. Existing records can be read.')}</Notice>}
    {data?.collectionActive && role === 'parent' && <View style={s.card}>
      <Text accessibilityRole="header" style={s.heading}>{t('先邀请，再听孩子的选择', 'Invite, then listen to their choice')}</Text>
      <Text style={s.body}>{t('建议不会自动记为孩子同意。把设备交给孩子后，可以一起看规则，也可以选择不做。', 'A suggestion is not recorded as agreement. Hand over the device, read it together if helpful, and allow a choice not to do it.')}</Text>
      <Button disabled={busy} title={t('交给孩子，进入孩子空间', 'Hand over and open the child space')} onPress={onEnterChild} />
    </View>}
    {data?.collectionActive && !goal && data.content.state==='available' && <View style={s.card}>{initialTemplate && <Notice>{guideCopy.selectedSuggestion[locale]}</Notice>}
      <Text accessibilityRole="header" style={s.heading}>{role === 'parent' ? t('提出一个小建议', 'Suggest one small activity') : t('选一个你愿意尝试的', 'Choose something you want to try')}</Text>
      <Text style={s.muted}>{t('一次只选一个就够了。', 'One at a time is enough.')}</Text>
      {data.templates.map(template => <Choice key={template.id} selected={selected === template.id} disabled={busy} label={`${template.title[locale]}\n${template.steps[0][locale]}`} onPress={() => setSelected(template.id)} />)}
      {selected && <Steps steps={data.templates.find(item => item.id === selected)!.steps.map(step => step[locale])} />}
      {helpChoices()}
      <Button disabled={busy || !selected} title={role === 'parent' ? t('保存建议，等待商量', 'Save a suggestion to discuss') : t('我愿意试一小步', 'I want to try a small step')} onPress={() => { if (selected) void create({ templateId: selected, support }); }} />
      <Text style={s.muted}>{t('不想选也没关系，可以返回家庭空间。没有倒计时，也不需要连续打卡。', 'You can leave without choosing. There is no countdown or daily streak to keep.')}</Text>
    </View>}
    {goal && <View style={s.card}>
      <Text style={s.label}>{stateLabels[goal.state][locale]}</Text>
      <Text accessibilityRole="header" style={s.heading}>{goal.template.title[locale]}</Text>
      {data&&usableGoalContent(goal,data)?<><Steps steps={goal.template.steps.map(step => step[locale])} />
      <Text style={s.label}>{t('家人可以这样帮忙', 'A way for family to help')}</Text>
      <Text style={s.body}>{goal.template.parentTip[locale]}</Text></>:<Notice>{t('这份目标的内容已停用。可以结束目标，已有记录会保留。','This activity is unavailable. You can stop the goal; existing records remain.')}</Notice>}
      <Text style={s.body}>{goal.state === 'proposed' ? t('建议的帮助：', 'Suggested help: ') : t('约定的帮助：', 'Agreed help: ')}{supportLabels[goal.support][locale]}</Text>
      {data?.collectionActive && usableGoalContent(goal,data) && role === 'child' && goal.state === 'proposed' && <>
        {helpChoices()}
        <Button disabled={busy} title={t('我愿意这样试', 'I want to try this')} onPress={() => void act(goal, { action: 'accept', support })} />
        <Button quiet disabled={busy} title={t('这次不选它', 'Not this one')} onPress={() => void act(goal, { action: 'decline' })} />
      </>}
      {data?.collectionActive && usableGoalContent(goal,data) && role === 'child' && goal.state === 'active' && <>
        {!reviewing ? <Button disabled={busy} title={t('回来后，记一下自己的想法', 'When you return, add your reflection')} onPress={() => setReviewing(true)} /> : <View style={s.field}>
          <Text accessibilityRole="header" style={s.heading}>{t('你想怎样记录这一次？', 'How would you describe this time?')}</Text>
          <Text style={s.body}>{t('没有正确答案，也可以跳过问题。正在选择的答案会显示在这台设备上。', 'There are no right answers. You can skip questions. Your choices are visible on this device while you reflect.')}</Text>
          {(Object.keys(reflectionLabels) as (keyof Reflection)[]).map(key => <View key={key} style={s.field}>
            <Text style={s.label}>{reflectionQuestions[key][locale]}</Text>
            {Object.entries(reflectionLabels[key]).map(([value, label]) => <Choice key={value} disabled={busy} label={label[locale]} selected={reflection[key] === value} onPress={() => setReflection(current => ({ ...current, [key]: value }))} />)}
          </View>)}
          <Text style={s.label}>{t('这次答案要分享给家长吗？','Share these answers with your family?')}</Text>
          <Choice disabled={busy} selected={!share} label={t('不分享，只记回顾结束','Do not share; only record that I finished reflecting')} onPress={()=>setShare(false)}/>
          <Choice disabled={busy} selected={share} label={t('分享这次的三个答案','Share these three answers')} onPress={()=>setShare(true)}/>
          <Text style={s.body}>{share?t('确认后，家长可以在记录和导出文件中看到这三个答案。以后可撤回分享。','After confirmation, parents can see these answers in records and exports. You can remove the shared answers later.'):t('不上传或保存这些答案。离开回顾后，答案不会保留，也不能找回。','These answers will not be uploaded or saved. They will be cleared when you leave the reflection and cannot be recovered.')}</Text>
          <Button disabled={busy || (share&&(!reflection.outcome || !reflection.helpful || !reflection.next))} title={share?t('确认分享这三个答案','Confirm and share these answers'):t('只记回顾结束，不保存答案','Finish reflecting without saving answers')} onPress={() => void act(goal,reflectionAction(share,reflection as Reflection))} />
        </View>}
      </>}
      {data?.collectionActive && <Button quiet disabled={busy} title={t('先停下这个目标', 'Stop this goal for now')} onPress={() => void act(goal, { action: 'stop' })} />}
    </View>}
    {data && <View style={s.field}>
      <Text accessibilityRole="header" style={s.heading}>{t('以前的小尝试', 'Earlier small attempts')}</Text>
      <Text style={s.muted}>{historyCopy.explanation(data.total)}</Text>
      <Text accessibilityLiveRegion="polite" style={s.label}>{historyCopy.page(state.historyPage,data.goals.filter(item=>!openGoal(item)).length)}</Text>
      <Button quiet disabled={busy||state.historyPage===1} title={historyCopy.newer} onPress={()=>void move('newer')}/>
      <Button quiet disabled={busy||!data.history.nextCursor} title={historyCopy.older} onPress={()=>void move('older')}/>
      {state.paging&&<Text accessibilityLiveRegion="polite" style={s.muted}>{historyCopy.loading}</Text>}
      <Notice>{state.historyError&&lifeError(state.historyError,locale)}</Notice>
      {!data.history.nextCursor&&<Text style={s.muted}>{historyCopy.end}</Text>}
      {data.goals.filter(item => !openGoal(item)).map(item => <History key={item.id} goal={item} locale={locale} busy={busy} onRemove={()=>void act(item,{action:'unshare'})} />)}
      {!data.goals.some(item=>!openGoal(item)) && <Text style={s.body}>{historyCopy.empty}</Text>}
    </View>}
  </Page>;
}
function Steps({ steps }: { steps: string[] }) { return <View style={s.field}>{steps.map((step, index) => <Text key={index} style={s.body}>{index + 1}. {step}</Text>)}</View>; }
function History({ goal, locale,busy,onRemove }: { goal: LifeGoal; locale: Locale;busy:boolean;onRemove():void }) {
  const [expanded, setExpanded] = useState(false),[confirm,setConfirm]=useState(false), t = translate(locale);
  useEffect(()=>setConfirm(false),[goal.version]);
  return <View style={s.card}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={s.label}>{goal.template.title[locale]} · {stateLabels[goal.state][locale]}</Text>
      <Text style={s.muted}>{t('创建于 ','Created ')}{new Date(goal.createdAt).toLocaleDateString(locale)}</Text>
      <Text style={s.muted}>{expanded ? t('收起记录', 'Hide record') : t('展开记录', 'Read record')}</Text>
    </Pressable>
    {expanded && <>
      <Text style={s.body}>{supportLabels[goal.support][locale]}</Text>
      {goal.state==='reflected'&&<Text style={s.label}>{sharingLabels[goal.reflectionSharing][locale]}</Text>}
      {goal.reflection && reflectionLines(goal.reflection, locale).map((line, index) => <Text key={index} style={s.body}>{line}</Text>)}
      {sharedReflection(goal)&&(!confirm?<Button quiet disabled={busy} title={t('撤回分享的答案','Remove shared answers')} onPress={()=>setConfirm(true)}/>:<View style={s.field}><Text style={s.body}>{t('移除后，这里和以后导出的记录不再包含答案，无法恢复。已经看过或另存的内容无法收回。目标和回顾结束记录会保留。','The answers will be removed from these records and future exports and cannot be restored. Previously viewed or saved copies cannot be taken back. The goal and finished reflection remain.')}</Text><Button quiet disabled={busy} title={t('先保留','Keep for now')} onPress={()=>setConfirm(false)}/><Button disabled={busy} title={t('确认移除答案','Confirm removal')} onPress={onRemove}/></View>)}
      <Text style={s.muted}>{goal.createdBy === 'parent' ? t('由家长空间提出', 'Suggested in the parent space') : t('从孩子空间选择', 'Chosen in the child space')} · {new Date(goal.updatedAt).toLocaleDateString(locale)}</Text>
      {goal.closedReason === 'withdrawn' && <Text style={s.muted}>{t('因停止采集而关闭。', 'Closed when collection stopped.')}</Text>}
    </>}
  </View>;
}
