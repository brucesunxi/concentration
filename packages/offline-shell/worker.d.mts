export function workerSource(manifest: { version: string; assets: Array<{ url: string; bytes: number; sha256: string }>; [key: string]: unknown }): string;
export function workerVersion(assets: Array<{ url: string; bytes: number; sha256: string }>): string;
