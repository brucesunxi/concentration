import { File, Directory, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { Image } from 'react-native';
import { verifyRelease, verifyAsset } from '../../../packages/content/index.ts';
import type { ContentPack, Release, TrustedKey } from '../../../packages/content/index.ts';
import { nativeVerifier } from '../../../packages/content/native-verifier.ts';
import type { Plan } from '../../../packages/task-engine/index.ts';
import type { ContentProof } from '../../../packages/session-runtime/offline-session.ts';
import { API_ORIGIN, MobileClient } from './client';
export interface MobileContent { pack: ContentPack; assets: Record<string, string>; proof:ContentProof }
export async function prepareContent(plan: Plan, client: MobileClient, signal: AbortSignal, offline?: ContentProof): Promise<MobileContent> {
  if (!plan.content || !['ios', 'android'].includes(plan.environment?.platform ?? '')) throw new Error('Native plan required');
  const [release, trust] = offline ? [offline.release, {mode:'local-development',keys:offline.keys}] : await Promise.all([client.request<Release>(`/content/releases/${plan.content.sha256}`), client.request<{ mode: string; keys: TrustedKey[] }>('/content/trust')]);
  if (trust.mode !== 'local-development') throw new Error('Approved production trust configuration required');
  const pack = await verifyRelease(release, trust.keys, { mode: 'local', market: 'LOCAL', verifier: nativeVerifier });
  if (release.body.packHash !== plan.content.sha256 || pack.id !== plan.content.id || pack.version !== plan.content.version || pack.engineVersion !== plan.version || pack.policyVersion !== plan.policyVersion || pack.task !== plan.task || pack.ageBand !== plan.ageBand || pack.locale !== plan.locale) throw new Error('Content does not match the plan');
  const directory = new Directory(Paths.cache, 'focus-public-content-v1'); directory.create({ idempotent: true, intermediates: true });
  const assets: Record<string, string> = Object.create(null);
  for (const asset of pack.assets) {
    signal.throwIfAborted();
    const file = new File(directory, asset.path.split('/').at(-1)!);
    let valid = false;
    if (file.exists && file.size === asset.bytes) {
      try { await verifyAsset(asset, new Uint8Array(await file.bytes()), nativeVerifier); valid = true; } catch { valid = false; }
    }
    if (!valid) {
      if(offline)throw new Error('OFFLINE_ASSET_UNAVAILABLE');
      signal.throwIfAborted();
      const controller = new AbortController(), abort = () => controller.abort();
      const timer = setTimeout(abort, 20000); signal.addEventListener('abort', abort, { once: true });
      try {
        const response = await fetch(API_ORIGIN + asset.path, { credentials: 'omit', signal: controller.signal });
        if (!response.ok || !response.body) throw new Error('Asset download failed');
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.byteLength; if (size > asset.bytes) { await reader.cancel(); throw new Error('Asset larger than its manifest'); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let cursor = 0;
        for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
        await verifyAsset(asset, bytes, nativeVerifier); signal.throwIfAborted();
        file.write(bytes);
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    }
    if (asset.mime === 'image/png') await Image.getSize(file.uri);
    signal.throwIfAborted(); assets[asset.id] = file.uri;
  }
  return { pack, assets, proof:{release,keys:trust.keys} };
}
