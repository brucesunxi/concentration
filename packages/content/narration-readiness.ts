import type {ContentPack} from './index.ts';

/** File/text linkage only. No claim about hearing, suitability or human approval. */
export function assessNarration(pack:ContentPack){
  const asset=pack.assets.find(item=>item.id===pack.audio?.assetId);
  const attached=!!(pack.audio&&asset?.mime==='audio/mpeg'&&asset.locale===pack.locale&&asset.transcript===pack.copy[pack.audio.copyKey]);
  return {
    asset:attached?asset:undefined,
    attached,
    ruleAttached:attached&&pack.audio?.copyKey==='rule',
    copyKey:attached?pack.audio!.copyKey:null,
    voiceIdentified:attached&&!!asset?.voice,
  };
}
