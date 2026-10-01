import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { workerSource } from '../offline-shell/worker.mjs';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const assetPattern = /^assets\/[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css|png|webp|svg|jpg|jpeg|woff2?)$/;
const roots = ['index.html', 'focus-sw.js', 'offline-shell.json', 'budget.json'];
const filePath = z.string().max(200).refine(value => roots.includes(value) || value === '.vite/manifest.json' || assetPattern.test(value));
const fileSchema = z.object({ path: filePath, bytes: z.number().int().positive().max(16 * 1024 * 1024), sha256: digest }).strict();
const manifestSchema = z.object({ schemaVersion: z.literal(1), version: z.string().min(1).max(50), files: z.array(fileSchema).min(5).max(512) }).strict();
const stateSchema = z.object({ schemaVersion: z.literal(1), current: digest, releases: z.array(digest).min(1).max(128), assets: z.record(z.string().regex(assetPattern), z.object({ release: digest, sha256: digest }).strict()) }).strict();
type Manifest = z.infer<typeof manifestSchema>;
type State = z.infer<typeof stateSchema>;
export class WebReleaseError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new WebReleaseError(code); }
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const defaultLimit = 512 * 1024 * 1024;

async function checkedFile(root: string, path: string): Promise<Buffer> {
  let current = resolve(root);
  const base = await lstat(current);
  if (!base.isDirectory() || base.isSymbolicLink()) fail('WEB_RELEASE_UNSAFE_PATH');
  const segments = path.split('/');
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (!segment || segment === '.' || segment === '..' || segment.includes('\\')) fail('WEB_RELEASE_UNSAFE_PATH');
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index < segments.length - 1 ? !info.isDirectory() : !info.isFile())) fail('WEB_RELEASE_UNSAFE_PATH');
    if (index === segments.length - 1 && info.size > 16 * 1024 * 1024) fail('WEB_RELEASE_FILE_TOO_LARGE');
  }
  return readFile(current);
}

export async function readWebReleaseState(store: string): Promise<State | null> {
  try {
    const state = stateSchema.parse(JSON.parse((await checkedFile(store, 'current.json')).toString()));
    if (new Set(state.releases).size !== state.releases.length || !state.releases.includes(state.current) || Object.values(state.assets).some(asset => !state.releases.includes(asset.release))) fail('WEB_RELEASE_BAD_STATE');
    return state;
  } catch (error) { if (absent(error)) return null; throw error; }
}

/** Only files named by the complete Vite graph and explicit public roots can be published. */
export async function inspectWebBuild(source: string, version: string) {
  const graph = z.record(z.string(), z.object({ file: z.string(), imports: z.array(z.string()).optional(), dynamicImports: z.array(z.string()).optional(), css: z.array(z.string()).optional(), assets: z.array(z.string()).optional(), isEntry: z.boolean().optional() }).passthrough()).parse(JSON.parse((await checkedFile(source, '.vite/manifest.json')).toString()));
  if (Object.values(graph).filter(entry => entry.isEntry).length !== 1) fail('WEB_RELEASE_ENTRY_REQUIRED');
  const paths = new Set([...roots, '.vite/manifest.json']);
  for (const entry of Object.values(graph)) {
    for (const dep of [...entry.imports ?? [], ...entry.dynamicImports ?? []]) if (!Object.hasOwn(graph, dep)) fail('WEB_RELEASE_MISSING_DEPENDENCY');
    for (const path of [entry.file, ...entry.css ?? [], ...entry.assets ?? []]) {
      if (!assetPattern.test(path)) fail('WEB_RELEASE_UNSAFE_PATH');
      paths.add(path);
    }
  }
  if (paths.size > 512) fail('WEB_RELEASE_TOO_MANY_FILES');
  const initial = new Set(['index.html']), visited = new Set<string>();
  function visit(key: string) {
    if (visited.has(key)) return; visited.add(key);
    const entry = graph[key];
    for (const path of [entry.file, ...entry.css ?? [], ...entry.assets ?? []]) initial.add(path);
    for (const dependency of entry.imports ?? []) visit(dependency);
  }
  const entryKey = Object.keys(graph).find(key => graph[key].isEntry)!;
  visit(entryKey);
  const buffers = new Map<string, Buffer>(), files = [];
  let total = 0;
  for (const path of [...paths].sort()) {
    const bytes = await checkedFile(source, path); total += bytes.length;
    if (total > 64 * 1024 * 1024) fail('WEB_RELEASE_TOO_LARGE');
    buffers.set(path, bytes); files.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const budget = JSON.parse(buffers.get('budget.json')!.toString());
  const initialBytes = files.filter(file => initial.has(file.path)).reduce((sum, file) => sum + file.bytes, 0);
  if (budget.passed !== true || initialBytes > 1500000 || budget.totalBytes !== initialBytes || budget.limitBytes !== 1500000) fail('WEB_RELEASE_BUDGET_FAILED');
  if (!Array.isArray(budget.assets) || budget.assets.length !== initial.size || new Set(budget.assets.map((file: { path: string }) => file.path)).size !== initial.size) fail('WEB_RELEASE_BUDGET_MISMATCH');
  for (const entry of budget.assets ?? []) {
    const file = files.find(file => file.path === entry.path);
    if (!file || !initial.has(file.path) || file.sha256 !== entry.sha256 || file.bytes !== entry.bytes) fail('WEB_RELEASE_BUDGET_MISMATCH');
  }
  const shell = JSON.parse(buffers.get('offline-shell.json')!.toString());
  if (shell.schemaVersion !== 1 || shell.totalBytes !== initialBytes || !Array.isArray(shell.assets) || shell.assets.length !== initial.size + 1 || new Set(shell.assets.map((asset: { url: string }) => asset.url)).size !== initial.size + 1) fail('WEB_RELEASE_SHELL_INVALID');
  for (const asset of shell.assets) {
    const file = files.find(file => file.path === (asset.url === '/' ? 'index.html' : asset.url?.slice(1)));
    if (!file || !initial.has(file.path) || !asset.url.startsWith('/') || file.sha256 !== asset.sha256 || file.bytes !== asset.bytes) fail('WEB_RELEASE_SHELL_MISMATCH');
  }
  if (hash(JSON.stringify(shell.assets)) !== shell.version || buffers.get('focus-sw.js')!.toString() !== workerSource(shell)) fail('WEB_RELEASE_SHELL_MISMATCH');
  if (!buffers.get('index.html')!.toString().includes(`src="/${graph[entryKey].file}"`)) fail('WEB_RELEASE_ENTRY_MISMATCH');
  const manifest = manifestSchema.parse({ schemaVersion: 1, version, files });
  return { id: hash(JSON.stringify(manifest)), manifest, buffers, total };
}

async function releaseManifest(store: string, id: string): Promise<Manifest> {
  digest.parse(id);
  const bytes = await checkedFile(store, `releases/${id}/manifest.json`);
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString()));
  if (hash(JSON.stringify(manifest)) !== id || new Set(manifest.files.map(file => file.path)).size !== manifest.files.length) fail('WEB_RELEASE_MANIFEST_CORRUPT');
  return manifest;
}
async function releaseFile(store: string, id: string, path: string): Promise<Buffer> {
  const manifest = await releaseManifest(store, id), entry = manifest.files.find(file => file.path === path);
  if (!entry) fail('WEB_RELEASE_FILE_MISSING');
  const bytes = await checkedFile(store, `releases/${id}/files/${path}`);
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) fail('WEB_RELEASE_FILE_CORRUPT');
  return bytes;
}
async function durableWrite(path: string, bytes: Buffer | string) {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, 'wx');
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}

/** Single-host publication: retain old assets and atomically replace only the current pointer. */
export async function publishWebRelease(source: string, store: string, options: { version: string; expected: string | null; maxBytes?: number }) {
  const candidate = await inspectWebBuild(source, options.version);
  await mkdir(store, { recursive: true });
  const lock = join(store, '.publish-lock');
  try { await mkdir(lock); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('WEB_RELEASE_BUSY'); throw error; }
  const temporary = join(store, `.incoming-${randomUUID()}`), pointer = join(store, `.current-${randomUUID()}.json`);
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const current = await readWebReleaseState(store);
    if ((current?.current ?? null) !== options.expected) fail('WEB_RELEASE_STALE_BUILD');
    const assets = { ...current?.assets }, releases = [...current?.releases ?? []];
    for (const file of candidate.manifest.files.filter(file => assetPattern.test(file.path))) {
      const prior = assets[file.path];
      if (prior && prior.sha256 !== file.sha256) fail('WEB_RELEASE_ASSET_COLLISION');
      assets[file.path] ??= { release: candidate.id, sha256: file.sha256 };
    }
    let existingBytes = 0;
    for (const id of releases) existingBytes += (await releaseManifest(store, id)).files.reduce((total, file) => total + file.bytes, 0);
    const newRelease = !releases.includes(candidate.id);
    if (releases.length + Number(newRelease) > 128 || existingBytes + (newRelease ? candidate.total : 0) > (options.maxBytes ?? defaultLimit)) fail('WEB_RELEASE_CAPACITY');
    const destination = join(store, 'releases', candidate.id);
    if (newRelease) {
      await mkdir(join(store, 'releases'), { recursive: true });
      await mkdir(temporary);
      for (const [path, bytes] of candidate.buffers) await durableWrite(join(temporary, 'files', path), bytes);
      await durableWrite(join(temporary, 'manifest.json'), JSON.stringify(candidate.manifest));
      try { await rename(temporary, destination); }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        // A process may have stopped after committing the immutable files but before the pointer.
        for (const file of candidate.manifest.files) await releaseFile(store, candidate.id, file.path);
      }
      releases.push(candidate.id);
    } else for (const file of candidate.manifest.files) await releaseFile(store, candidate.id, file.path);
    const next = stateSchema.parse({ schemaVersion: 1, current: candidate.id, releases, assets });
    const pointerBytes = JSON.stringify(next);
    if (Buffer.byteLength(pointerBytes) > 8 * 1024 * 1024) fail('WEB_RELEASE_CAPACITY');
    await durableWrite(pointer, pointerBytes);
    await rename(pointer, join(store, 'current.json'));
    return { id: candidate.id, directory: join(destination, 'files'), retainedReleases: releases.length, retainedBytes: existingBytes + (newRelease ? candidate.total : 0) };
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(pointer, { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

const mime: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', woff: 'font/woff', woff2: 'font/woff2' };
export function createWebReleaseReader(store: string, legacy: string) {
  let managed = false;
  return async (pathname: string) => {
    const path = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!pathname.startsWith('/') || (!roots.includes(path) && !assetPattern.test(path))) return null;
    const managedAtStart = managed;
    const state = await readWebReleaseState(store);
    let bytes: Buffer, id: string | undefined;
    if (state) {
      managed = true;
      id = assetPattern.test(path) ? state.assets[path]?.release : state.current;
      if (!id) return null;
      bytes = await releaseFile(store, id, path);
      if (assetPattern.test(path) && hash(bytes) !== state.assets[path].sha256) fail('WEB_RELEASE_ASSET_CORRUPT');
    } else {
      if (managedAtStart) fail('WEB_RELEASE_STATE_MISSING');
      // One-time compatibility for an installation that has not published a managed release yet.
      try {
        const candidate = await inspectWebBuild(legacy, 'legacy-local');
        const found = candidate.buffers.get(path); if (!found) return null; bytes = found;
      } catch (error) { if (absent(error)) return null; throw error; }
    }
    return { bytes, release: id, mime: mime[path.split('.').at(-1)!], cacheControl: assetPattern.test(path) ? 'public, max-age=31536000, immutable' : 'no-store' };
  };
}
