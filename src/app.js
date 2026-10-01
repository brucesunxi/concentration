import { GAMES, searchBoard, stopDeck, memorySequence, evaluateSearch, evaluateStop, evaluateMemory, nextLevel, localDay, readData, freshData, getDailyPlan, progressSnapshot } from './core.js';
import { animal, names, island, icon } from './art.js';
import { VOICE_ASSETS, GENERATED_VOICE_ASSETS } from './audio/manifest.js';

const app = document.querySelector('#app');
let data;
try { data = readData(localStorage); } catch { data = freshData(); }
let storageOK = true;
let lastRenderKey = '';
let route = 'home', session = null, block = null, phase = '', trial = null, round = 0, practice = true, paused = false;
let timer = null, started = 0, sessionTick = null, seconds = 0, resultText = '', parentTab = 'records';
let currentAudio = null;
let voiceBusy = false;
// Kept as a small compatibility object for saved parent settings rendered by
// older local data. Runtime playback never calls a voice API.
const voiceState = { configured: GENERATED_VOICE_ASSETS, model: '本地 MP3', voice: 'marin' };
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function save() { try { localStorage.setItem('focus-island-v1', JSON.stringify(data)); storageOK = true; } catch { storageOK = false; } }
function browserSay(message, done) {
  document.querySelector('#announcer').textContent = message;
  if (!data.sound || !('speechSynthesis' in window)) { voiceBusy = false; setVoiceIndicator(); done?.(); return; }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message); utterance.lang = 'zh-CN'; utterance.rate = 0.85;
  utterance.onend = () => { voiceBusy = false; setVoiceIndicator(); done?.(); }; utterance.onerror = () => { voiceBusy = false; setVoiceIndicator(); done?.(); }; speechSynthesis.speak(utterance);
}
function voiceLabel() { return data.voice?.provider === 'browser' ? '设备语音' : GENERATED_VOICE_ASSETS ? '预生成语音' : '设备语音回退'; }
function setVoiceIndicator(text = '') { const el = document.querySelector('.voice-status'); if (el) el.textContent = text || voiceLabel(); }
async function sayStatic(id, fallbackText, done) {
  const message = VOICE_ASSETS[id]?.text || fallbackText;
  document.querySelector('#announcer').textContent = message;
  if (!data.sound) { done?.(); return; }
  voiceBusy = true; setVoiceIndicator(GENERATED_VOICE_ASSETS && data.voice?.provider !== 'browser' ? '播放预生成语音…' : '设备语音回退');
  if (data.voice?.provider === 'browser' || !GENERATED_VOICE_ASSETS || !VOICE_ASSETS[id]) { browserSay(message, done); return; }
  try {
    stopAudio(); const audio = new Audio(VOICE_ASSETS[id].path); currentAudio = audio; audio.volume = 0.92; audio.onended = () => { if (currentAudio === audio) currentAudio = null; voiceBusy = false; setVoiceIndicator(); done?.(); }; audio.onerror = () => { if (currentAudio === audio) currentAudio = null; voiceBusy = false; setVoiceIndicator('设备语音回退'); browserSay(message, done); }; await audio.play();
  } catch { voiceBusy = false; setVoiceIndicator('设备语音回退'); browserSay(message, done); }
}
function stopAudio() { window.speechSynthesis?.cancel(); if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null; } }
function clearTimer() { clearTimeout(timer); timer = null; }
function button(label, action, cls = '', attrs = '') { return `<button class="${cls}" data-action="${action}" ${attrs}>${label}</button>`; }
function shell(content) {
  const active = document.activeElement;
  const focusAction = active?.dataset?.action;
  const focusItem = active?.dataset?.item;
  const key = route + ':' + (route === 'game' ? block.game + ':' + phase : parentTab);
  const changed = key !== lastRenderKey;
  lastRenderKey = key;
  app.innerHTML = `<header class="site-header"><a class="brand" href="#" data-action="brand"><span class="brand-mark">${icon('leaf')}</span><span>小小专注岛<small>LITTLE FOCUS ISLAND</small></span></a>${route === 'game' ? `<div class="session-label">今天的小练习 <span>·</span> 一次做好一件事</div>${button(icon('pause') + ' 休息一下', 'pause', 'quiet')}` : `<nav aria-label="主导航">${button('探索小岛', 'home', route === 'home' ? 'nav active' : 'nav')}${button(icon('lock') + ' 家长空间', 'parent', route === 'parent' ? 'nav active' : 'nav')}</nav>`}</header><main id="main">${content}</main><footer><span>${icon('leaf')} 每次一小步，慢慢长出专注力。</span><span>为 7 岁左右的孩子设计 · ${storageOK ? '记录仅保存在此浏览器' : '浏览器无法保存，记录仅在本次打开时有效'}</span></footer>`;
  if (changed) { window.scrollTo({ top: 0, behavior: 'instant' }); document.querySelector('#announcer').textContent = ''; }
  const restore = !changed && focusAction ? [...app.querySelectorAll('[data-action]')].find(el => el.dataset.action === focusAction && (!focusItem || el.dataset.item === focusItem) && !el.disabled) : null;
  const focus = restore || document.querySelector('main h1');
  if (focus) { if (!restore) focus.tabIndex = -1; focus.focus({ preventScroll: true }); }
}
function renderHome() {
  route = 'home';
  const plan = getDailyPlan(data);
  const today = data.sessions.filter(s => s.date === localDay());
  const finished = today.filter(s => s.complete).length;
  shell(`<section class="hero"><div class="hero-copy"><div class="eyebrow"><span></span> 欢迎来到小小专注岛</div><h1>把注意力，<br>放在眼前的小美好。</h1><p>和森林里的朋友一起，找一找、等一等、记一记。<br>不用比快，每次认真一点点。</p><div class="hero-actions">${button(`开始${plan.title} ${icon('arrow')}`, 'start-plan', 'primary large')}${button(icon('sound') + ' ' + (data.sound ? '语音已开启' : '语音已关闭'), 'sound', 'sound-button', `aria-pressed="${data.sound}"`)}</div><div class="hero-meta"><span>${icon('clock')} 一次约 5–8 分钟</span><span>${icon('check')} 第 ${plan.week} 周课程 · ${voiceLabel()}</span></div></div><div class="hero-art"><div class="art-note"><span class="little-dot"></span> 今天，也是一段小小的成长</div>${island()}<span class="island-caption">慢慢来，小岛一直在这里。</span></div></section>
  <section class="daily-plan"><div><div class="eyebrow muted">TODAY'S ROUTE · 第 ${plan.week} 周</div><h2>${plan.title}</h2><p>${plan.subtitle}</p><div class="plan-transfer">${icon('arrow')} 生活迁移：${plan.transfer}</div></div><div class="plan-steps">${plan.games.map((key, index) => `<div class="plan-step"><span>${String(index + 1).padStart(2, '0')}</span><strong>${GAMES[key].name}</strong><small>${GAMES[key].skill}</small></div>`).join('')}</div></section>
  <section class="explore"><div class="section-heading"><div><div class="eyebrow muted">OUR LITTLE ADVENTURES</div><h2>今天，想探索哪一站？</h2></div><p>可以完整探索，也可以只玩一个。</p></div><div class="game-cards">${Object.entries(GAMES).map(([key, g], i) => `<button class="game-card ${g.color}" data-action="start-${key}"><div class="card-top"><span class="number">0${i + 1}</span><span class="skill-tag">${g.skill}</span></div><div class="card-art ${key}">${key === 'search' ? animal('fox') + animal('rabbit') + animal('bear') : key === 'stop' ? '<img class="bridge-mini" src="/src/assets/bridge-scene.png" alt="小兔和狐狸在小桥两边">' : animal('apple') + animal('leaf') + animal('flower')}</div><div class="card-bottom"><div><h3>${g.name}</h3><p>${g.subtitle} <span>·</span> ${key === 'stop' ? '约 1 分钟' : '约 2 分钟'}</p></div><span class="round-arrow">${icon('arrow')}</span></div></button>`).join('')}</div></section>
  <section class="home-bottom"><div class="gentle-note"><span class="note-icon">${icon('leaf')}</span><div><h3>陪伴，比催促更有力量</h3><p>第一次可以陪孩子一起玩。先听懂规则，再慢慢尝试。</p></div>${button('了解练习方法 ' + icon('arrow'), 'method', 'text-button')}</div><div class="today-note"><span class="today-dot"></span><div><strong>${finished ? `今天完成了 ${finished} 次探索` : '今天的探索，等你开启'}</strong><p>${finished ? '也可以把刚刚的方法用到生活里。' : '没有排名，没有连续打卡压力。'}</p></div></div></section>`);
}
function startSession(games) {
  clearTimer(); stopAudio(); clearInterval(sessionTick);
  const plan = getDailyPlan(data);
  session = { id: crypto.randomUUID(), date: localDay(), startedAt: new Date().toISOString(), games, planId: plan.curriculumId, planWeek: plan.week, blocks: [], complete: false };
  seconds = 0;
  sessionTick = setInterval(() => { if (!paused && route === 'game') { seconds++; if (seconds >= 600) finishSession(false, '今天先到这里，让眼睛和身体休息一下。'); } }, 1000);
  route = 'game'; startBlock(games[0]);
}
function startBlock(game) {
  block = { game, level: data.levels[game], trials: [], completed: false };
  round = 0; practice = true; paused = false; phase = 'intro'; trial = null; renderGame();
}
function gameHeader() {
  const g = GAMES[block.game], step = session.games.indexOf(block.game) + 1;
  return `<div class="game-heading"><div><div class="eyebrow muted">${session.games.length > 1 ? `第 ${step} 站 / 共 ${session.games.length} 站` : '一段小小的探索'} <span class="practice-badge">${practice ? '熟悉玩法 · 不计入记录' : '正式练习'}</span></div><h1>${g.name}</h1></div><div class="voice-actions"><span class="voice-status">${voiceLabel()}</span>${button(icon('sound') + ' 听玩法', 'hear', 'quiet', voiceBusy ? 'disabled' : '')}</div></div><div class="progress-track"><span style="width:${practice ? 0 : round / g.rounds * 100}%"></span></div>`;
}
function renderGame() {
  const g = GAMES[block.game];
  let content = '';
  if (phase === 'intro') content = `<div class="intro-layout"><div class="intro-art ${g.color}">${block.game === 'memory' ? animal('apple') + animal('leaf') : animal('rabbit')}${block.game === 'stop' ? animal('fox') : ''}</div><div class="intro-copy"><span class="skill-tag">${g.subtitle}</span><h2>${block.game === 'search' ? '小兔子，藏在哪里？' : block.game === 'stop' ? '谁可以过小桥？' : '帮森林朋友送包裹'}</h2><p class="rule-text">${g.rule}</p><div class="tip-box">${icon('leaf')} ${g.strategy}</div><p class="subtle">先试一小轮。弄懂规则后，再开始。</p>${button('试试看 ' + icon('arrow'), 'practice', 'primary large')}</div></div>`;
  else if (phase === 'feedback') content = `<div class="center-stage"><div class="feedback-mascot">${animal('rabbit')}</div><div class="eyebrow muted">${practice ? '练习时间' : `第 ${round} / ${g.rounds} 小轮`}</div><h2>${resultText}</h2><p>${g.strategy}</p>${!trial.result.correct && block.game === 'memory' ? `<div class="feedback-answer"><span>刚才的顺序是</span>${trial.sequence.map(item => `<span>${animal(item)}${names[item]}</span>`).join('<span>→</span>')}</div>` : !trial.result.correct && block.game === 'search' ? `<div class="feedback-board">${trial.items.map((item, i) => `<div class="${item === 'rabbit' ? 'target' : ''}">${animal(item)}<small>位置 ${i + 1}${item === 'rabbit' ? ' · 小兔' : ''}</small></div>`).join('')}</div>` : ''}${button(practice ? (trial.practiceNext ? '再看看狐狸 ' : trial.result.correct ? '我明白了，开始吧 ' : '再试一次 ') + icon('arrow') : (round >= g.rounds ? '这一站完成了 ' : '下一小轮 ') + icon('arrow'), 'next', 'primary large')}</div>`;
  else if (phase === 'block-done') content = `<div class="center-stage"><span class="completion-flower">${icon('check')}</span><div class="eyebrow muted">这一站，认真完成</div><h2>把刚刚的小方法，带在身边。</h2><p>${g.strategy}</p><div class="rest-card">伸个懒腰，看看远处。<br><small>准备好了，再去下一站。</small></div>${button('准备好了 ' + icon('arrow'), 'next-block', 'primary large')}${button('今天就到这里', 'finish', 'text-button')}</div>`;
  else if (trial && block.game === 'search') content = `<div class="task-title"><h2>找出所有的小兔子</h2><p>点一下选中，再点一下可以取消。找完再检查。</p></div><div class="search-grid size-${trial.items.length}">${trial.items.map((item, i) => `<button class="tile ${trial.selected.includes(i) ? 'selected' : ''}" data-action="select" data-index="${i}" aria-label="${names[item]}，位置 ${i + 1}" aria-pressed="${trial.selected.includes(i)}">${animal(item)}<span class="selection-mark">${trial.selected.includes(i) ? icon('check') : ''}</span></button>`).join('')}</div><div class="task-bottom"><span>已选 ${trial.selected.length} 个</span>${button('找好了 ' + icon('check'), 'submit-search', 'primary')}</div>`;
  else if (trial && block.game === 'stop') content = `<div class="task-title"><h2>小兔请过桥，狐狸等一等</h2><p>${practice ? '先让小兔过桥，再试试等狐狸离开。' : '看清是谁，再决定。'}</p></div><div class="bridge-stage"><div class="river"></div><div class="bridge"></div><div class="bridge-animal">${animal(trial.item)}<span>${names[trial.item]}</span></div><span class="river-leaf leaf-one"></span><span class="river-leaf leaf-two"></span></div><div class="stop-controls">${button('请过桥', 'cross', 'primary large')}<span>${practice ? '这是示范练习' : `第 ${round + 1} / ${g.rounds} 位森林朋友`}</span></div>`;
  else if (trial && block.game === 'memory') content = `<div class="task-title"><h2>${phase === 'encode' ? '记住包裹的先后顺序' : '按刚才的顺序，点选包裹'}</h2><p>${phase === 'encode' ? '可以在心里说一遍，记好后再出发。' : '点一下送出一个，选错了可以撤回。'}</p></div>${phase === 'encode' ? `<div class="sequence">${trial.sequence.map((item, i) => `<div class="sequence-item"><span>${i + 1}</span>${animal(item)}<strong>${names[item]}</strong></div>`).join('<span class="sequence-arrow">→</span>')}</div><div class="center-actions">${button(icon('sound') + ' 听一遍顺序', 'hear-sequence', 'quiet')}${button('记好了，去送包裹 ' + icon('arrow'), 'recall', 'primary large')}</div>` : `<div class="answer-slots">${trial.sequence.map((_, i) => `<div class="answer-slot">${trial.answer[i] ? animal(trial.answer[i]) : `<span>${i + 1}</span>`}</div>`).join('<span class="sequence-arrow">→</span>')}</div><div class="object-options">${trial.options.map(item => `<button class="object-button" data-action="object" data-item="${item}" ${trial.answer.length >= trial.sequence.length ? 'disabled' : ''}>${animal(item)}<span>${names[item]}</span></button>`).join('')}</div><div class="memory-tools">${button('撤回上一个', 'undo', 'quiet', trial.answer.length ? '' : 'disabled')}${button('再看一次', 'replay', 'quiet')}</div><div class="center-actions">${button('送好了 ' + icon('check'), 'submit-memory', 'primary', trial.answer.length === trial.sequence.length ? '' : 'disabled')}</div>`}`;
  shell(`<section class="game-container">${gameHeader()}<div class="game-panel ${g.color}">${content}</div><div class="game-footnote">${icon('leaf')} 不用比快，认真尝试就很好。${button('结束本次探索', 'pause', 'text-button')}</div></section>`);
}
function newTrial() {
  clearTimer(); stopAudio();
  const game = block.game;
  phase = game === 'memory' ? 'encode' : 'trial';
  if (game === 'search') trial = { items: practice ? ['rabbit', 'fox', 'bear', 'cat', 'rabbit', 'fox'] : searchBoard(block.level), selected: [], assisted: false };
  if (game === 'stop') {
    if (!practice && !block.deck) block.deck = stopDeck();
    trial = { item: practice ? (block.practiceRabbit ? 'fox' : 'rabbit') : block.deck[round], assisted: false };
  }
  if (game === 'memory') trial = { sequence: practice ? ['apple', 'leaf'] : memorySequence(block.level), answer: [], options: ['apple', 'leaf', 'flower', 'berry'], assisted: false, replays: 0 };
  started = performance.now(); renderGame();
  if (game === 'stop') timer = setTimeout(() => resolveStop(false), practice && trial.item === 'rabbit' ? 12000 : [3600, 3000, 2400][block.level - 1]);
}
function record(result) {
  clearTimer(); stopAudio(); trial.result = result;
  if (!practice) { block.trials.push({ ...result, assisted: trial.assisted, replays: trial.replays || 0, durationMs: Math.round(performance.now() - started), ...(block.game === 'stop' ? { stimulus: trial.item } : {}) }); round++; }
  if (!practice) persistProgress();
  phase = 'feedback'; renderGame();
  const feedbackVoice = block.game === 'search'
    ? (result.correct ? 'search-success' : 'search-coach')
    : block.game === 'stop'
      ? (result.correct ? 'stop-success' : 'stop-coach')
      : (result.correct ? 'memory-success' : 'memory-coach');
  sayStatic(feedbackVoice, resultText);
}
function resolveStop(clicked) {
  if (paused || phase !== 'trial') return;
  const result = evaluateStop(trial.item, clicked);
  if (practice) {
    if (result.correct && trial.item === 'rabbit') { block.practiceRabbit = true; resultText = '小兔过桥啦！再试试遇到狐狸。'; trial.practiceNext = true; }
    else if (result.correct) resultText = '你会看清再行动啦！';
    else resultText = trial.item === 'fox' ? '遇到狐狸，让它自己离开。' : '遇到小兔，可以点“请过桥”。';
    record(result); return;
  }
  clearTimer(); block.trials.push({ ...result, assisted: trial.assisted, replays: 0, stimulus: trial.item, durationMs: Math.round(performance.now() - started) }); round++; persistProgress();
  phase = 'gap';
  const panel = document.querySelector('.game-panel');
  panel.innerHTML = `<div class="center-stage stop-gap"><h2>${result.correct ? (clicked ? '小兔过桥了' : '你等住了') : (clicked ? '狐狸要等一等' : '小兔来了，可以点一下')}</h2><p>下一位朋友就要来啦</p></div>`;
  timer = setTimeout(() => { if (round >= GAMES.stop.rounds) completeBlock(); else newTrial(); }, 1000);
}
function completeBlock() {
  clearTimer(); block.completed = true;
  delete block.deck; delete block.practiceRabbit;
  session.blocks.push(block);
  const history = [...data.sessions.filter(s => s.id !== session.id).flatMap(s => s.blocks), ...session.blocks];
  data.levels[block.game] = nextLevel(block.level, history, block.game);
  persistProgress();
  if (session.games.indexOf(block.game) === session.games.length - 1) finishSession(true);
  else { phase = 'block-done'; renderGame(); }
}
function persistProgress() {
  if (!session) return;
  const blocks = [...session.blocks];
  if (block && !block.completed && block.trials.length) blocks.push(block);
  if (!blocks.length) return;
  const snapshot = { ...session, seconds, blocks: blocks.map(({ deck, practiceRabbit, ...b }) => structuredClone(b)) };
  data.sessions = [...data.sessions.filter(s => s.id !== session.id), snapshot].slice(-100);
  save();
}
function finishSession(complete, message = '') {
  if (!session) return;
  clearTimer(); clearInterval(sessionTick); stopAudio(); paused = false;
  if (block && !block.completed && block.trials.length) session.blocks.push(block);
  session.complete = complete; session.seconds = seconds;
  if (session.blocks.length) { data.sessions = [...data.sessions.filter(s => s.id !== session.id), session].slice(-100); save(); }
  route = 'done';
  shell(`<section class="done-page"><div class="done-art">${island()}</div><div class="eyebrow">${complete ? '今天的小探索，完成啦' : '认真尝试，也是一小步'}</div><h1>${complete ? '把专注，带回生活里。' : '休息一下，下次再见。'}</h1><p>${message || '放下屏幕，和家人一起完成一个小任务吧。'}</p><div class="offline-card"><span class="skill-tag">离线小任务</span><h2>先收好铅笔，再把书放进书包。</h2><p>先听完，轻声重复一遍，再按顺序去做。</p></div><div class="center-actions">${button('回到小岛 ' + icon('home'), 'home', 'primary')}${button('家长记录一下', 'parent-observe', 'quiet')}</div><p class="subtle">${storageOK ? '已完成的小轮会保存在这个浏览器。' : '这次记录暂时无法保存。请到家长空间导出。'}</p></section>`);
  session = null;
}
function progressHTML() {
  const snapshot = progressSnapshot(data);
  const plan = getDailyPlan(data);
  return `<section class="progress-dashboard"><div class="dashboard-head"><div><div class="eyebrow muted">COURSE MAP · 第 ${plan.week} 周</div><h2>${plan.title}</h2><p>${plan.subtitle}</p></div><span class="course-chip">${plan.games.length === 3 ? '综合周' : '基础周'}</span></div><div class="skill-progress">${Object.entries(snapshot).map(([key, item]) => `<div class="skill-progress-row"><div class="skill-label"><span>${item.name}</span><small>难度 ${item.level} · ${item.blocks ? `${item.blocks} 站` : '尚未开始'}</small></div><div class="meter"><span style="width:${item.accuracy ?? 0}%"></span></div><strong>${item.accuracy == null ? '—' : `${item.accuracy}%`}</strong></div>`).join('')}</div><div class="transfer-callout">${icon('arrow')} 今日生活迁移：${plan.transfer}</div></section>`;
}
function pauseGame() {
  if (route !== 'game' || paused) return;
  paused = true; clearTimer(); stopAudio();
  const dialog = document.createElement('dialog'); dialog.id = 'pause-dialog';
  dialog.innerHTML = `<div class="pause-art">${animal('rabbit')}</div><h2>小岛也休息一下</h2><p>伸伸手，看看远处。<br>正在做的小轮会重新开始，不记为错误。</p>${button('继续探索 ' + icon('play'), 'resume', 'primary large')}${button('再听一次玩法', 'paused-hear', 'text-button')}${button('今天就到这里', 'finish', 'quiet')}`;
  app.append(dialog); dialog.showModal(); dialog.addEventListener('cancel', e => { e.preventDefault(); resumeGame(); });
}
function resumeGame() {
  document.querySelector('#pause-dialog')?.remove(); paused = false;
  if (phase === 'trial' || phase === 'encode' || phase === 'recall') newTrial();
  else if (phase === 'gap') { if (round >= GAMES.stop.rounds) completeBlock(); else newTrial(); }
  else renderGame();
}
function renderParent(tab = parentTab) {
  route = 'parent'; parentTab = tab;
  const blocks = data.sessions.flatMap(s => s.blocks);
  const tabs = `<div class="parent-tabs" aria-label="家长空间栏目">${button('练习记录', 'tab-records', tab === 'records' ? 'selected' : '')}${button('生活观察', 'tab-observe', tab === 'observe' ? 'selected' : '')}${button('方法与设置', 'tab-method', tab === 'method' ? 'selected' : '')}</div>`;
  let content;
  if (tab === 'records') content = `<div class="parent-summary"><div><span>已记录的探索</span><strong>${data.sessions.length}<small> 次</small></strong></div><div><span>完成的小游戏</span><strong>${blocks.filter(b => b.completed).length}<small> 站</small></strong></div><div><span>生活观察</span><strong>${data.observations.length}<small> 条</small></strong></div></div>${progressHTML()}<div class="info-banner">${icon('leaf')} 游戏表现反映对当前任务的熟悉程度，不能作为诊断、年龄排名或学习能力判断。</div><div class="section-heading"><h2>最近的探索</h2>${button('导出记录', 'export', 'quiet')}</div>${data.sessions.length ? data.sessions.slice().reverse().map(s => `<article class="record-card"><div class="record-title"><strong>${escapeHTML(s.date)} <span>${s.complete ? '完成探索' : '提前结束'}</span></strong><small>活动时间约 ${Math.max(1, Math.round(s.seconds / 60))} 分钟</small></div>${s.blocks.map(b => { const n = b.trials.length; const correct = b.trials.filter(t => t.correct).length; const sum = key => b.trials.reduce((a, t) => a + (t[key] || 0), 0); return `<div class="record-row"><div><strong>${GAMES[b.game].name}</strong><small>难度 ${b.level} · ${b.completed ? '已完成' : '部分完成'}</small></div><div><span>${correct} / ${n}</span><small>完整正确的小轮</small></div><div>${b.game === 'memory' ? `<span>${sum('replays')} 次</span><small>再次查看</small>` : `<span>${sum('commissions')} / ${sum('omissions')}</span><small>误点 / 漏点${b.game === 'search' ? '（目标数）' : ''}</small>`}</div><div><span>${b.trials.filter(t => t.assisted).length} 轮</span><small>使用了提示</small></div></div>`; }).join('')}</article>`).join('') : `<div class="empty-state">${icon('leaf')}<h3>第一份记录，从一次尝试开始</h3><p>完成小游戏后，这里会显示真实的练习记录。<br>示范练习和暂停中断的小轮不参与统计。</p>${button('去探索小岛 ' + icon('arrow'), 'home', 'primary')}</div>`}`;
  else if (tab === 'observe') content = `<div class="observation-layout"><form id="observation-form" class="parent-card"><span class="eyebrow muted">把目光放回生活</span><h2>记录一个具体的小变化</h2><p>尽量比较相似的任务，不用给孩子打分。</p><label>观察的任务<select name="task"><option>整理书包</option><option>完成一小段作业</option><option>听完并执行指令</option><option>其他日常任务</option></select></label><label>大人提醒了几次？<select name="prompts"><option value="unknown">没有计数</option><option value="0">0 次</option><option value="1">1 次</option><option value="2">2 次</option><option value="3+">3 次或更多</option></select></label><label>具体发生了什么？<textarea name="note" required maxlength="500" rows="4" placeholder="例如：先复述了两个步骤，中途提醒了一次，最后自己完成了。"></textarea></label><button class="primary" type="submit">保存这次观察 ${icon('check')}</button><p class="subtle" id="observation-status" role="status">只保存在此浏览器，不需要填写孩子的姓名。</p></form><div><h2>观察手记</h2>${data.observations.length ? data.observations.slice().reverse().map(o => `<article class="observation-note"><div><span>${escapeHTML(o.date)}</span><strong>${escapeHTML(o.task)}</strong></div><p>${escapeHTML(o.note)}</p><small>提醒次数：${escapeHTML(o.prompts === 'unknown' ? '未计数' : o.prompts)}</small></article>`).join('') : '<div class="empty-state small"><h3>还没有观察手记</h3><p>游戏里学到的“先看清、先听完”，<br>有没有出现在真实的小任务中？</p></div>'}</div></div>`;
  else content = `<div class="method-layout"><article class="parent-card"><div class="eyebrow muted">设计依据与边界</div><h2>练习小技能，观察真实生活</h2><p>本产品是教育练习原型，尚未经过临床或教育效果验证。它采用视觉搜索、Go/No-Go（该回应时回应、该等待时等待）和顺序回忆的任务结构，不是标准化测评。</p><h3>课程怎么组织？</h3><p>课程按 4 周循环：第 1–2 周分别巩固“看见目标、看清再行动、记住顺序”，第 3–4 周把三种方法组合，并且每次结束都给一个现实生活迁移任务。每天按星期轮换主训练，已完成的技能会顺延到后面，避免重复堆叠。</p><h3>三个小游戏，各练什么？</h3><ul><li><strong>森林寻宝：</strong>练习有目的地查找与检查。记录漏选和误选，不奖励抢快。</li><li><strong>小兔过桥：</strong>练习辨认后行动或等待。记录误点狐狸、漏点小兔，以及正确等待。</li><li><strong>森林小邮差：</strong>练习保持并复现顺序。当前为图像＋可选语音，不能视为纯听觉注意测量。</li></ul><h3>语音怎么生成？</h3><p>服务端可调用 OpenAI Text-to-Speech 大模型生成普通话音频，浏览器只收到音频，不暴露 API 密钥；同一句提示在本次会话中缓存。未配置密钥、网络异常或家长手动选择设备语音时，自动回退到浏览器语音。语音提示使用固定的儿童友好指令，不让模型评价孩子或追加内容。</p><h3>难度怎样变化？</h3><p>初始难度为 1。连续两次同难度、无提示的完整小游戏正确率均达到 85%，下次升一级；最近一次低于 50%，下次降一级。最多三级，过程中不突然加难。这些是保守的产品规则，并非已验证的训练处方。</p><h3>家长怎样陪伴？</h3><p>首次一起理解规则。孩子疲倦或不想继续时可以结束。一次探索约 5–8 分钟，活动累计 10 分钟会自动结束；这些是体验边界，不是医学剂量。结束后配合整理书包等日常小任务，记录实际变化。</p><h3>参考资料</h3><p><a href="https://developingchild.harvard.edu/resources/handouts-tools/activities-guide-enhancing-and-practicing-executive-function-skills/" target="_blank" rel="noreferrer">哈佛儿童发展中心：执行功能适龄活动指南 ↗</a></p><p><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7726355/" target="_blank" rel="noreferrer">儿童电脑执行功能训练的系统综述与荟萃分析 ↗</a></p><p>上述资料支持设计思路与效果边界，不代表机构认可本产品。游戏成绩提高不保证课堂表现改善。</p></article><aside class="parent-card settings"><h2>练习设置</h2><div class="setting-row"><div><strong>语音引导</strong><small>${voiceState.configured ? `OpenAI 大模型语音 · ${voiceState.model} · ${voiceState.voice}` : '设备语音（服务端尚未配置大模型）'}</small></div>${button(data.sound ? '已开启' : '已关闭', 'sound', 'toggle', `aria-pressed="${data.sound}"`)}</div><div class="voice-mode-row">${button('自动选择', 'voice-auto', data.voice?.provider === 'auto' ? 'selected' : 'quiet')}${button('大模型语音', 'voice-llm', data.voice?.provider === 'llm' ? 'selected' : 'quiet')}${button('设备语音', 'voice-browser', data.voice?.provider === 'browser' ? 'selected' : 'quiet')}</div><p class="subtle">大模型语音需要服务端配置 OPENAI_API_KEY；API 密钥不会下发到浏览器。没有密钥时自动回退。语音请求不会保存孩子姓名或训练记录。</p><hr><h3>下次的起步难度</h3>${Object.entries(GAMES).map(([key, g]) => `<label>${g.name}<select data-level="${key}">${[1, 2, 3].map(n => `<option value="${n}" ${n === data.levels[key] ? 'selected' : ''}>难度 ${n}${n === 1 ? ' · 轻松起步' : ''}</option>`).join('')}</select></label>`).join('')}<hr><h3>数据与隐私</h3><p>无需账户，没有广告或排名。记录保存在当前浏览器，最多保留最近 100 次探索和 100 条观察。清理浏览器数据会丢失记录；家长导出自行保管。系统语音可能使用浏览器的联网语音服务。</p>${button('导出全部记录', 'export', 'quiet')}${button('清空本机记录', 'delete', 'text-button danger')}</aside></div>`;
  shell(`<section class="parent-page"><div class="parent-heading"><div><div class="eyebrow muted">FOR GROWN-UPS</div><h1>陪伴，看得见的小成长。</h1><p>理解练习，也留意屏幕之外的变化。</p></div><span class="privacy-chip">${icon('lock')} 本地保存 · 无需账户</span></div>${tabs}${content}</section>`);
}
const renderParentWithStaticVoice = renderParent;
renderParent = function renderParentStatic(tab = parentTab) {
  renderParentWithStaticVoice(tab);
  const setting = document.querySelector('.settings .setting-row small');
  if (setting) setting.textContent = GENERATED_VOICE_ASSETS ? '预生成语音 · 本地 MP3' : '尚未生成本地素材 · 设备语音回退';
  const hint = document.querySelector('.settings .subtle');
  if (hint) hint.textContent = '语音台词先一次性生成并放在本地。练习时只播放 MP3，不建立实时语音对话；没有素材时自动回退到设备语音。';
  const staticChoice = document.querySelector('.voice-mode-row [data-action="voice-llm"]');
  if (staticChoice) { staticChoice.textContent = '预生成语音'; staticChoice.dataset.action = 'voice-static'; }
};

app.addEventListener('click', event => {
  const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (action === 'brand' || action === 'home') { event.preventDefault(); if (route === 'game') pauseGame(); else renderHome(); }
  else if (action === 'parent') renderParent();
  else if (action === 'parent-observe') renderParent('observe');
  else if (action === 'method') renderParent('method');
  else if (action.startsWith('tab-')) renderParent(action.slice(4));
  else if (action === 'sound') { data.sound = !data.sound; save(); if (data.sound) sayStatic('sound-on', '语音已开启，慢慢来。'); else stopAudio(); route === 'parent' ? renderParent() : renderHome(); }
  else if (action === 'voice-auto' || action === 'voice-static' || action === 'voice-llm' || action === 'voice-browser') { data.voice.provider = action === 'voice-browser' ? 'browser' : 'auto'; save(); renderParent('method'); }
  else if (action === 'start-plan') startSession(getDailyPlan(data).games);
  else if (action === 'start-all') startSession(Object.keys(GAMES));
  else if (action.startsWith('start-')) startSession([action.slice(6)]);
  else if (action === 'hear') { if (trial && ['trial', 'encode', 'recall'].includes(phase)) { trial.assisted = true; if (block.game === 'stop') { pauseGame(); return; } } sayStatic(`${block.game}-rule`, GAMES[block.game].rule); }
  else if (action === 'practice') newTrial();
  else if (action === 'pause') pauseGame();
  else if (action === 'resume') resumeGame();
  else if (action === 'paused-hear') sayStatic(`${block.game}-rule`, GAMES[block.game].rule);
  else if (action === 'finish') { document.querySelector('#pause-dialog')?.remove(); finishSession(false); }
  else if (action === 'select' && phase === 'trial' && !paused) { const i = Number(target.dataset.index); trial.selected = trial.selected.includes(i) ? trial.selected.filter(x => x !== i) : [...trial.selected, i]; const selected = trial.selected.includes(i); target.classList.toggle('selected', selected); target.setAttribute('aria-pressed', String(selected)); target.querySelector('.selection-mark').innerHTML = selected ? icon('check') : ''; document.querySelector('.task-bottom > span').textContent = `已选 ${trial.selected.length} 个`; }
  else if (action === 'submit-search' && phase === 'trial') { const result = evaluateSearch(trial.items, trial.selected); resultText = result.correct ? '小兔子都找到啦！' : '再记住一个办法：一行一行找。'; record(result); }
  else if (action === 'cross') resolveStop(true);
  else if (action === 'hear-sequence') sayStatic('memory-recall', '请按刚才记住的顺序，点选包裹。');
  else if (action === 'recall') { stopAudio(); phase = 'recall'; renderGame(); }
  else if (action === 'object' && phase === 'recall' && trial.answer.length < trial.sequence.length) { trial.answer.push(target.dataset.item); renderGame(); }
  else if (action === 'undo') { trial.answer.pop(); renderGame(); }
  else if (action === 'replay') { trial.assisted = true; trial.replays++; trial.answer = []; phase = 'encode'; renderGame(); }
  else if (action === 'submit-memory' && phase === 'recall') { const result = evaluateMemory(trial.sequence, trial.answer); resultText = result.correct ? '包裹按顺序送到啦！' : '下次试试，在心里说一遍顺序。'; record(result); }
  else if (action === 'next') { if (practice) { if (trial.result.correct && !trial.practiceNext) { practice = false; round = 0; } newTrial(); } else if (round >= GAMES[block.game].rounds) completeBlock(); else newTrial(); }
  else if (action === 'next-block') startBlock(session.games[session.games.indexOf(block.game) + 1]);
  else if (action === 'export') { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `小小专注岛-${localDay()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  else if (action === 'delete') { const dialog = document.createElement('dialog'); dialog.id = 'delete-dialog'; dialog.innerHTML = `<h2>清空这个浏览器的记录？</h2><p>探索记录、观察手记和设置都会删除，无法撤回。可以先取消并导出备份。</p>${button('保留记录', 'cancel-delete', 'primary')}${button('确认清空', 'confirm-delete', 'quiet danger')}`; app.append(dialog); dialog.showModal(); }
  else if (action === 'cancel-delete') document.querySelector('#delete-dialog')?.remove();
  else if (action === 'confirm-delete') { data = freshData(); save(); renderParent('method'); }
});
app.addEventListener('change', event => { if (event.target.dataset.level) { data.levels[event.target.dataset.level] = Number(event.target.value); save(); } });
app.addEventListener('submit', event => { if (event.target.id !== 'observation-form') return; event.preventDefault(); const form = new FormData(event.target); const note = String(form.get('note')).trim(); if (!note) { document.querySelector('#observation-status').textContent = '请写下一件具体的小事。'; return; } data.observations.push({ date: localDay(), task: form.get('task'), prompts: form.get('prompts'), note }); data.observations = data.observations.slice(-100); save(); renderParent('observe'); document.querySelector('#observation-status').textContent = storageOK ? '已保存这次观察。' : '保存失败，请导出备份。'; });
document.addEventListener('visibilitychange', () => { if (document.hidden && route === 'game') pauseGame(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && route === 'game' && !paused) pauseGame(); });
renderHome();
