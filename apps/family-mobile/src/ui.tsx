import { Component, useEffect } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, Pressable, TextInput, ScrollView } from 'react-native';
import type { TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const colors = { ink: '#243D37', muted: '#536B63', background: '#F6F4ED', card: '#FFFFFF', accent: '#286650', line: '#D6DFD7', soft: '#E8F0E7', danger: '#953C39' };
export function Page({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  useEffect(() => {
    let current = true;
    void AccessibilityInfo.isScreenReaderEnabled().then(enabled => {
      if (current && enabled) AccessibilityInfo.announceForAccessibility(title);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [title]);
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled"><Text style={s.brand}>FOCUS ISLAND</Text><Text accessibilityRole="header" style={s.title}>{title}</Text>{subtitle && <Text style={s.muted}>{subtitle}</Text>}{children}</ScrollView></SafeAreaView>;
}
export function Button({ title, accessibilityContext, onPress, disabled = false, quiet = false, danger = false }: { title: string; accessibilityContext?: string; onPress(): void; disabled?: boolean; quiet?: boolean; danger?: boolean }) {
  return <Pressable accessible accessibilityRole="button" accessibilityLabel={accessibilityContext ? `${accessibilityContext} · ${title}` : title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, quiet && s.quiet, danger && { backgroundColor: colors.danger }, (pressed || disabled) && { opacity: disabled ? 0.45 : 0.75 }]}><Text style={[s.buttonText, quiet && !danger && { color: colors.ink }]}>{title}</Text></Pressable>;
}
export function Field(props: TextInputProps & { label: string }) {
  return <View style={s.field}><Text accessible={false} style={s.label}>{props.label}</Text><TextInput {...props} accessibilityLabel={props.label} style={s.input} placeholderTextColor={colors.muted} /></View>;
}
export function Notice({ children }: { children?: ReactNode }) { return children ? <View accessibilityLiveRegion="polite" style={s.notice}><Text style={s.noticeText}>{children}</Text></View> : null; }
export function Choice({ label, selected, onPress, disabled = false }: { label: string; selected: boolean; onPress(): void; disabled?: boolean }) {
  return <Pressable accessible accessibilityLabel={label} onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} style={[s.chip, selected && s.selected, disabled && { opacity: 0.5 }]}><Text style={[s.chipText, selected && { color: colors.accent, fontWeight: '700' }]}>{label}</Text></Pressable>;
}
export function CheckBox({ label, value, onChange, disabled = false }: { label: string; value: boolean; onChange(value: boolean): void; disabled?: boolean }) {
  return <Pressable accessible accessibilityLabel={label} disabled={disabled} onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value, disabled }} style={s.check}><Text accessible={false} maxFontSizeMultiplier={1} style={[s.label, { flex: 0, width: 28 }]}>{value ? '☑' : '☐'}</Text><Text style={[s.muted, { flex: 1 }]}>{label}</Text></Pressable>;
}
export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, page: { padding: 24, paddingBottom: 48, gap: 16, width: '100%', maxWidth: 760, alignSelf: 'center' },
  brand: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 3, marginTop: 8 }, title: { color: colors.ink, fontSize: 30, lineHeight: 40, fontWeight: '700' },
  heading: { color: colors.ink, fontSize: 22, fontWeight: '700', lineHeight: 30 }, body: { color: colors.ink, fontSize: 18, lineHeight: 28 }, muted: { color: colors.muted, fontSize: 15, lineHeight: 24 },
  card: { padding: 22, gap: 14, borderRadius: 24, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  button: { minHeight: 56, backgroundColor: colors.accent, paddingVertical: 15, paddingHorizontal: 20, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  quiet: { backgroundColor: colors.soft }, buttonText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  field: { gap: 8 }, label: { color: colors.ink, fontSize: 16, fontWeight: '600' }, input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, minHeight: 54, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, color: colors.ink, fontSize: 18 },
  notice: { padding: 16, borderRadius: 16, backgroundColor: '#F9E8DF' }, noticeText: { color: '#72362B', fontSize: 15, lineHeight: 24 },
  chip: { borderWidth: 1, borderColor: colors.line, minHeight: 48, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, justifyContent: 'center' }, selected: { backgroundColor: colors.soft, borderColor: colors.accent }, chipText: { color: colors.muted, fontSize: 16 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, minHeight: 48 }, center: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 24 },
});
export class MobileBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Page title="暂时停一下 / Practice paused"><Notice>请关闭后重新打开 App。已保存的练习记录会保留。Please reopen the app. Saved records are preserved.</Notice></Page> : this.props.children; }
}
