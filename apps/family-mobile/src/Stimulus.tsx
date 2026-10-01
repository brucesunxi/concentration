import { Image, View } from 'react-native';
import Svg, { Circle, Path, Polygon, Rect } from 'react-native-svg';
import { itemLabel } from '../../../packages/content/copy.ts';
import type { Item, Locale } from '../../../packages/task-engine/index.ts';

export function Stimulus({ item, locale, teen, assets, size = 72, onError }: { item: Item; locale: Locale; teen: boolean; assets: Record<string, string>; size?: number; onError?(): void }) {
  const symbolic = item === 'star' || item === 'moon' || (teen && ['rabbit', 'fox', 'bear', 'cat'].includes(item));
  const label = itemLabel(item, locale, teen);
  if (symbolic) return <View accessible accessibilityRole="image" accessibilityLabel={label}><Svg width={size} height={size} viewBox="0 0 80 80" fill="none" stroke="#286650" strokeWidth={5}>
    {item === 'star' ? <Polygon points="40,7 49,29 73,31 55,47 60,71 40,58 20,71 25,47 7,31 31,29" fill="#286650" /> : item === 'moon' ? <Path d="M55 11C29 8 9 30 19 53C29 76 60 71 70 49C45 63 22 32 55 11Z" fill="#286650" /> : item === 'rabbit' ? <Circle cx={40} cy={40} r={27} /> : item === 'fox' ? <Polygon points="40,9 71,40 40,71 9,40" /> : item === 'bear' ? <Polygon points="40,11 71,67 9,67" /> : <Rect x={14} y={14} width={52} height={52} />}
  </Svg></View>;
  const characters = ['rabbit', 'fox', 'bear', 'cat'], character = characters.includes(item);
  const index = (character ? characters : ['apple', 'leaf', 'flower', 'berry']).indexOf(item);
  const uri = assets[character ? 'characters' : 'objects'];
  if (index < 0 || !uri) throw new Error('Missing verified stimulus');
  return <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size, overflow: 'hidden' }}><Image source={{ uri }} accessible={false} fadeDuration={0} onError={onError} style={{ width: size * 2, height: size * 2, position: 'absolute', left: index % 2 ? -size : 0, top: index > 1 ? -size : 0 }} /></View>;
}
