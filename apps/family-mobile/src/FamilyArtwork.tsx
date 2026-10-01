import { useState } from 'react';
import { Image, View } from 'react-native';

const sources = {
  island: require('../../../packages/visuals/runtime/hero-island.png'),
  bridge: require('../../../packages/visuals/runtime/bridge-scene.png'),
};

/** Decorative artwork is bundled and never used as a substitute for task media. */
export function FamilyArtwork({ kind, compact = false }: { kind: keyof typeof sources; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ alignItems: 'center', height: compact ? 104 : kind === 'bridge' ? 132 : 168 }}>
    <Image source={sources[kind]} accessible={false} resizeMode="contain" fadeDuration={0} onError={() => setFailed(true)} style={{ height: '100%', width: '100%', maxWidth: kind === 'bridge' ? 320 : 240 }} />
  </View>;
}
