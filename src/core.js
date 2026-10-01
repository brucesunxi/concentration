export const VERSION = 2;
export const GAMES = {
  search: { name: '森林寻宝', subtitle: '仔细找一找', skill: '选择性注意', color: 'green', rounds: 3, rule: '找出所有的小兔子。找完后，点“找好了”。', strategy: '一行一行找，找完再检查。' },
  stop: { name: '小兔过桥', subtitle: '看清再行动', skill: '抑制控制', color: 'peach', rounds: 12, rule: '小兔出现，点“请过桥”；狐狸出现，等它自己离开。', strategy: '先认清是谁，再决定要不要动手。' },
  memory: { name: '森林小邮差', subtitle: '记住小顺序', skill: '工作记忆', color: 'purple', rounds: 3, rule: '先看包裹的顺序，记好后，按同样的顺序点选。', strategy: '在心里说一遍，再按顺序行动。' }
};
export const CURRICULUM = [
  { id: 'notice', title: '看见目标', subtitle: '先停下来，再一行一行找', focus: 'search', weeks: [1, 2], transfer: '整理书桌时，按区域逐项检查。' },
  { id: 'wait', title: '看清再行动', subtitle: '有些时候，等待也是答案', focus: 'stop', weeks: [1, 2], transfer: '听完两步指令后，再开始行动。' },
  { id: 'remember', title: '把顺序放在心里', subtitle: '先复述，再按顺序完成', focus: 'memory', weeks: [1, 2], transfer: '把书包整理步骤轻声说一遍。' },
  { id: 'combine', title: '把方法带回生活', subtitle: '今天练一个小技能，再完成一个真实任务', focus: 'mixed', weeks: [3, 4], transfer: '先听完、再计划、最后检查。' }
];
export function weekOf(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.max(1, Math.floor((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000 / 7) + 1);
}
export function getCurriculumWeek(date = new Date()) { return ((weekOf(date) - 1) % 4) + 1; }
export function getDailyPlan(data, date = new Date()) {
  const week = getCurriculumWeek(date);
  const day = date.getDay() || 7;
  const eligible = CURRICULUM.filter(item => item.weeks.includes(week) && item.focus !== 'mixed');
  const recent = data.sessions.filter(s => s.date === localDay(date)).flatMap(s => s.blocks).map(b => b.game);
  const plan = week === 3 || week === 4 ? ['search', 'stop', 'memory'] : [eligible.find((item, index) => item.focus && !recent.includes(item.focus) && index >= (day - 1) % Math.max(eligible.length, 1))?.focus || eligible.find(item => item.focus && !recent.includes(item.focus))?.focus || 'search'];
  const unique = [...new Set(plan.filter(Boolean))];
  const games = unique.filter(game => !recent.includes(game)).concat(unique.filter(game => recent.includes(game)));
  const item = CURRICULUM.find(x => x.focus === games[0]) || CURRICULUM[3];
  return { week, day, curriculumId: item.id, title: item.title, subtitle: item.subtitle, transfer: item.transfer, games: games.slice(0, week >= 3 ? 3 : 1), done: recent.length > 0 };
}
export function progressSnapshot(data, date = new Date()) {
  const sessions = data.sessions.filter(s => s.date <= localDay(date));
  const blocks = sessions.flatMap(s => s.blocks);
  return Object.fromEntries(Object.entries(GAMES).map(([game, meta]) => {
    const relevant = blocks.filter(b => b.game === game);
    const trials = relevant.flatMap(b => b.trials);
    const correct = trials.filter(t => t.correct).length;
    return [game, { name: meta.name, skill: meta.skill, level: data.levels[game], blocks: relevant.length, trials: trials.length, accuracy: trials.length ? Math.round(correct / trials.length * 100) : null, lastDate: sessions.slice().reverse().find(s => s.blocks.some(b => b.game === game))?.date || null }];
  }));
}
export function shuffle(items, random = Math.random) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}
export function searchBoard(level = 1, random = Math.random) {
  const count = [6, 9, 12][level - 1] || 6;
  const targets = 2;
  return shuffle([...Array(targets).fill('rabbit'), ...Array.from({ length: count - targets }, (_, i) => ['fox', 'bear', 'cat'][i % 3])], random);
}
export function stopDeck(random = Math.random) {
  return ['rabbit', ...shuffle([...Array(7).fill('rabbit'), ...Array(4).fill('fox')], random)];
}
export function memorySequence(level = 1, random = Math.random) {
  return shuffle(['apple', 'leaf', 'flower', 'berry'], random).slice(0, level === 3 ? 3 : 2);
}
export function evaluateSearch(board, selected) {
  const set = new Set(selected);
  const hits = board.filter((item, i) => item === 'rabbit' && set.has(i)).length;
  const omissions = board.filter((item, i) => item === 'rabbit' && !set.has(i)).length;
  const commissions = board.filter((item, i) => item !== 'rabbit' && set.has(i)).length;
  return { correct: omissions === 0 && commissions === 0, hits, omissions, commissions };
}
export function evaluateStop(item, clicked) {
  return { correct: (item === 'rabbit') === clicked, hits: item === 'rabbit' && clicked ? 1 : 0, omissions: item === 'rabbit' && !clicked ? 1 : 0, commissions: item === 'fox' && clicked ? 1 : 0, correctWait: item === 'fox' && !clicked ? 1 : 0 };
}
export function evaluateMemory(expected, actual) {
  return { correct: expected.length === actual.length && expected.every((item, i) => item === actual[i]), matched: expected.filter((item, i) => item === actual[i]).length, length: expected.length };
}
// Conservative product heuristic, not a normed psychometric threshold.
export function nextLevel(level, history, game) {
  const blocks = history.filter(x => x.game === game).slice(-2);
  const valid = b => b && b.level === level && b.completed && b.trials.length && b.trials.every(t => !t.assisted);
  if (!valid(blocks.at(-1))) return level;
  const accuracy = block => block.trials.filter(t => t.correct).length / block.trials.length;
  if (accuracy(blocks.at(-1)) < 0.5) return Math.max(1, level - 1);
  if (blocks.length === 2 && blocks.every(b => valid(b) && accuracy(b) >= 0.85)) return Math.min(3, level + 1);
  return level;
}
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function freshData() { return { version: VERSION, sessions: [], observations: [], levels: { search: 1, stop: 1, memory: 1 }, sound: true, voice: { provider: 'auto', cache: true, status: 'unknown' } }; }
export function readData(storage) {
  try {
    const d = JSON.parse(storage.getItem('focus-island-v1'));
    if (![1, VERSION].includes(d?.version) || !Array.isArray(d.sessions) || !Array.isArray(d.observations)) return freshData();
    return { ...freshData(), sessions: d.sessions.filter(s => typeof s.date === 'string' && Array.isArray(s.blocks) && s.blocks.every(b => GAMES[b.game] && Array.isArray(b.trials))).slice(-100), observations: d.observations.filter(o => typeof o.note === 'string' && typeof o.date === 'string').slice(-100), levels: Object.fromEntries(Object.keys(GAMES).map(k => [k, [1, 2, 3].includes(d.levels?.[k]) ? d.levels[k] : 1])), sound: d.sound !== false, voice: { ...freshData().voice, ...(d.voice || {}) }, version: VERSION };
  } catch { return freshData(); }
}
