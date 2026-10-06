import { StyleSheet, Text, View } from 'react-native';
import type { Locale, TaskId } from '../../../packages/task-engine/index.ts';
import { itemLabel } from '../../../packages/content/copy.ts';
import { ruleExamples } from '../../../packages/content/rule-examples.ts';
import { Stimulus } from './Stimulus';

export function RuleExamples({ task, locale, teen, assets }: { task: TaskId; locale: Locale; teen: boolean; assets: Record<string, string> }) {
  const examples = ruleExamples(task, locale);
  if (!examples) return null;
  return <View style={styles.row}>
    <View style={[styles.card, styles.target]}>
      <Text style={styles.action}>{examples.targetAction}</Text>
      <Stimulus item={examples.target} locale={locale} teen={teen} assets={assets} size={48} />
      <Text style={styles.label}>{itemLabel(examples.target, locale, teen)}</Text>
    </View>
    <View style={[styles.card, styles.other]}>
      <Text style={styles.action}>{examples.otherAction}</Text>
      <View style={styles.items}>{examples.others.map(item => <View key={item} style={styles.item}>
        <Stimulus item={item} locale={locale} teen={teen} assets={assets} size={36} />
        <Text style={styles.label}>{itemLabel(item, locale, teen)}</Text>
      </View>)}</View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, width: '100%' },
  card: { flex: 1, minWidth: 0, minHeight: 120, borderWidth: 1, borderRadius: 16, padding: 9, alignItems: 'center', justifyContent: 'center', gap: 6 },
  target: { backgroundColor: '#F4F8ED', borderColor: '#DBE7D3' },
  other: { backgroundColor: '#FAF7EF', borderColor: '#EADFCE' },
  action: { color: '#263A30', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  label: { color: '#53614E', fontSize: 11, textAlign: 'center' },
  items: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 5 },
  item: { alignItems: 'center', gap: 2 },
});
