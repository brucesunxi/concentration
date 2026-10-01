export type AudioState = 'idle' | 'playing' | 'failed';
/** One playback owner, including stale promise and event cancellation. No speech synthesis or runtime TTS. */
export class AssetPlayer {
  private generation = 0;
  private current: HTMLAudioElement | null = null;
  private listener: (state: AudioState) => void;
  constructor(listener: (state: AudioState) => void) { this.listener = listener; }
  stop() {
    this.generation++;
    if (this.current) { this.current.onended = null; this.current.onerror = null; this.current.pause(); this.current = null; }
    this.listener('idle');
  }
  async play(assetId: string) {
    if (!/^[a-z-]+$/.test(assetId)) return;
    return this.playSource(`/media/${assetId}.mp3`);
  }
  async playSource(source: string) {
    this.stop(); const generation = this.generation;
    if (!source.startsWith('blob:' + location.origin + '/') && !/^\/media\/[a-z-]+\.mp3$/.test(source)) { this.listener('failed'); return; }
    const audio = new Audio(source); this.current = audio;
    let settled = false;
    const settle = (state: AudioState) => {
      if (settled || generation !== this.generation) return;
      settled = true; this.current = null; audio.onended = null; audio.onerror = null; this.listener(state);
    };
    audio.onended = () => settle('idle'); audio.onerror = () => settle('failed');
    this.listener('playing');
    try { await audio.play(); } catch { settle('failed'); }
  }
}
