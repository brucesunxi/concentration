import { createContext, useContext } from 'react';
import { Star, Moon, Circle, Diamond, Triangle, Square } from 'lucide-react';
import type { Item, Locale } from '../../../packages/task-engine/index.ts';
import { itemLabel } from './content.ts';
import characters from '../../../packages/visuals/runtime/characters-sheet.webp';
import objects from '../../../packages/visuals/runtime/objects-sheet.webp';

// Null is the decorative home preview. A practice provider must supply the
// artwork from its frozen plan, including when that plan uses an older version.
export const StimulusAssets = createContext<Record<string, string> | null>(null);
export function Stimulus({ item, locale, teen = false }: { item: Item; locale: Locale; teen?: boolean }) {
  const assets = useContext(StimulusAssets);
  const Icon = item === 'star' ? Star : item === 'moon' ? Moon : teen ? { rabbit: Circle, fox: Diamond, bear: Triangle, cat: Square }[item as 'rabbit'] : undefined;
  const label = itemLabel(item, locale, teen);
  if (Icon) return <span className="stimulus-symbol" role="img" aria-label={label}><Icon strokeWidth={2.5} fill={item === 'star' || item === 'moon' ? 'currentColor' : 'none'} /></span>;
  const list = ['rabbit', 'fox', 'bear', 'cat']; const isCharacter = list.includes(item);
  const index = (isCharacter ? list : ['apple', 'leaf', 'flower', 'berry']).indexOf(item);
  const source = assets === null ? isCharacter ? characters : objects : assets[isCharacter ? 'characters' : 'objects'];
  if (index < 0 || !source) throw new Error('Missing prepared stimulus artwork');
  return <span className="stimulus-sprite" role="img" aria-label={label} style={{ backgroundImage: `url(${source})`, backgroundPosition: `${index % 2 ? 100 : 0}% ${index > 1 ? 100 : 0}%` }} />;
}
