import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const outputDir = resolve(root, 'src/audio');
const assets = {
  'home-welcome': '欢迎来到小小专注岛。今天，我们只做一件小事。',
  'search-rule': '找出所有的小兔子。找完以后，点找好了。',
  'search-strategy': '一行一行找，找完再检查。',
  'stop-rule': '小兔出现，点请过桥。狐狸出现，等它自己离开。',
  'stop-strategy': '先认清是谁，再决定要不要动手。',
  'memory-rule': '先看包裹的顺序，记好以后，按同样的顺序点选。',
  'memory-strategy': '在心里说一遍，再按顺序行动。',
  'memory-recall': '请按刚才记住的顺序，点选包裹。',
  'practice-start': '先试一小轮。弄懂规则以后，再开始。',
  'sound-on': '语音已开启，慢慢来。',
  'search-success': '小兔子都找到啦！',
  'search-coach': '再记住一个办法：一行一行找。',
  'stop-success': '你会看清再行动啦！',
  'stop-coach': '遇到狐狸，让它自己离开。',
  'memory-success': '包裹按顺序送到啦！',
  'memory-coach': '下次试试，在心里说一遍顺序。',
};

await mkdir(outputDir, { recursive: true });
for (const [id, text] of Object.entries(assets)) {
  const aiff = resolve(outputDir, `.${id}.aiff`);
  await run('say', ['-v', 'Tingting', '-r', '155', '-o', aiff, text]);
  const { stdout: audioInfo } = await run('afinfo', [aiff]);
  if (!/audio bytes: [1-9]\d*/.test(audioInfo)) throw new Error(`系统音色没有产生有效音频：${id}`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-codec:a', 'libmp3lame', '-q:a', '4', resolve(outputDir, `${id}.mp3`)]);
  await rm(aiff, { force: true });
  console.log(`已生成 ${id}.mp3`);
}

const manifest = `// Generated offline with the macOS Chinese voice Tingting.\nexport const GENERATED_VOICE_ASSETS = true;\nexport const VOICE_ASSETS = ${JSON.stringify(Object.fromEntries(Object.entries(assets).map(([id, text]) => [id, { text, path: `/src/audio/${id}.mp3` }])), null, 2)};\n`;
await writeFile(resolve(outputDir, 'manifest.js'), manifest);
console.log(`完成：${Object.keys(assets).length} 个本地 MP3（系统中文音色 Tingting）。`);
