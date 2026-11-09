import { execFileSync } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

export const PLAY_INTERNAL_SOURCE_ROOTS = [
  'package.json', 'package-lock.json', 'tsconfig.json', 'packages', 'scripts/mobile.mjs',
  'scripts/configure-android-play-internal.mjs', 'scripts/verify-android-play-internal.mjs',
  'scripts/check-play-internal-prerequisites.mjs', 'scripts/check-play-internal-api.mjs',
  'scripts/materialize-play-upload-keystore.mjs', 'scripts/build-play-internal-android.mjs',
  'apps/family-mobile/package.json', 'apps/family-mobile/build-identity.json',
  'apps/family-mobile/app.config.ts', 'apps/family-mobile/metro.config.cjs',
  'apps/family-mobile/tsconfig.json', 'apps/family-mobile/Gemfile',
  'apps/family-mobile/Gemfile.lock', 'apps/family-mobile/index.ts', 'apps/family-mobile/src',
];

const commitPattern = /^[a-f0-9]{40}$/;

export function gitWorkTree(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function gitSourceFiles(cwd) {
  return execFileSync('git', ['ls-files', '-z', '--', ...PLAY_INTERNAL_SOURCE_ROOTS], { cwd }).toString('utf8').split('\0').filter(Boolean);
}

async function walk(directory, cwd, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('PLAY_INTERNAL_SOURCE_LINK');
    if (entry.isDirectory()) await walk(full, cwd, files);
    else if (entry.isFile()) files.push(relative(cwd, full).split(sep).join('/'));
    else throw new Error('PLAY_INTERNAL_SOURCE_UNSAFE');
  }
}

/** File list for an extracted source archive, which has no git index. */
export async function filesystemSourceFiles(cwd) {
  const files = [];
  for (const source of PLAY_INTERNAL_SOURCE_ROOTS) {
    const full = join(cwd, source);
    const info = await lstat(full);
    if (info.isSymbolicLink()) throw new Error('PLAY_INTERNAL_SOURCE_LINK');
    if (info.isFile()) files.push(source);
    else if (info.isDirectory()) await walk(full, cwd, files);
    else throw new Error('PLAY_INTERNAL_SOURCE_UNSAFE');
  }
  return files.sort();
}

export async function listPlayInternalSourceFiles(cwd) {
  return gitWorkTree(cwd) ? gitSourceFiles(cwd) : filesystemSourceFiles(cwd);
}

export function resolveSourceCommit(cwd, sourceRef) {
  if (typeof sourceRef !== 'string' || !sourceRef || sourceRef.startsWith('-') || /[\r\n\0]/.test(sourceRef)) throw new Error('Source reference must resolve to a commit');
  if (gitWorkTree(cwd)) {
    const commit = execFileSync('git', ['-C', cwd, 'rev-parse', '--verify', `${sourceRef}^{commit}`], { encoding: 'utf8' }).trim();
    if (!commitPattern.test(commit)) throw new Error('Source reference must resolve to a commit');
    return { commit, git: true };
  }
  if (!commitPattern.test(sourceRef)) throw new Error('Source reference must resolve to a commit');
  return { commit: sourceRef, git: false };
}

export async function readVerifiedSourceFile(cwd, resolved, path) {
  if (typeof path !== 'string' || isAbsolute(path) || path.split(/[\\/]/).includes('..') || path.startsWith('-')) throw new Error('Unsafe or duplicate source path');
  if (resolved.git) return execFileSync('git', ['-C', cwd, 'show', `${resolved.commit}:${path}`], { encoding: 'buffer', maxBuffer: 40 * 1024 * 1024 });
  const file = join(cwd, path);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe or duplicate source path');
  return readFile(file);
}
