import { writeFile } from 'node:fs/promises';
import { openDatabase, migrate } from '../apps/api/database.ts';
import { createLocalContent } from '../apps/api/content.ts';
import { verifyRelease, verifyAsset } from '../packages/content/index.ts';
import type { ContentPack, Release } from '../packages/content/index.ts';
import { TASKS } from '../packages/task-engine/index.ts';
import type { AgeBand, Locale } from '../packages/task-engine/index.ts';

// Source-catalogue inventory only. Actual studio publications and market approval
// require their own database, people and evidence; no family data is read here.
const ages: AgeBand[] = ['6-8', '9-11', '12-14', '15-17'];
const languages: Locale[] = ['zh-CN', 'en'];
const args = process.argv.slice(2);
let jsonPath: string | undefined, markdownPath: string | undefined;
for (let i = 0; i < args.length; i += 2) {
  if (!args[i + 1] || !['--out', '--markdown'].includes(args[i])) throw new Error('Usage: npm run content:readiness -- [--out report.json] [--markdown report.md]');
  if (args[i] === '--out') { if (jsonPath) throw new Error('Duplicate --out'); jsonPath = args[i + 1]; }
  else { if (markdownPath) throw new Error('Duplicate --markdown'); markdownPath = args[i + 1]; }
}
const db = await openDatabase('memory://');
try {
  await migrate(db);
  const catalogue = await createLocalContent(db), trusted = await catalogue.trust();
  const entries = (await db.query<{ envelope: Release; state: string }>('SELECT envelope,state FROM content_releases ORDER BY pack_id,version')).rows;
  const bySlot = new Map<string, { envelope: Release; state: string }>();
  for (const row of entries) {
    const pack = await verifyRelease(row.envelope, trusted, { mode: 'local', market: 'LOCAL' });
    const slot = `${pack.task}:${pack.ageBand}:${pack.locale}`;
    if (bySlot.has(slot)) throw new Error(`More than one source content pack for ${slot}`);
    for (const asset of pack.assets) {
      const file = catalogue.media.get(asset.path);
      if (!file) throw new Error(`Missing content asset: ${slot}/${asset.id}`);
      await verifyAsset(asset, new Uint8Array(file.body));
    }
    bySlot.set(slot, row);
  }
  const rows = [];
  for (const ageBand of ages) for (const locale of languages) for (const task of TASKS) {
    const slot = `${task}:${ageBand}:${locale}`, row = bySlot.get(slot);
    const pack: ContentPack | undefined = row?.envelope.body.pack;
    const narrationAsset = pack?.assets.find(a => a.id === pack.audio?.assetId);
    const audioAttached = !!(pack?.audio && narrationAsset?.mime === 'audio/mpeg' && narrationAsset.transcript === pack.copy[pack.audio.copyKey]);
    const ruleNarrationAttached = audioAttached && pack?.audio?.copyKey === 'rule';
    const issues = [
      ...(!row ? ['CONTENT_MISSING'] : []),
      ...(row && (row.state !== 'active' || row.envelope.body.channel !== 'published') ? ['NOT_PUBLISHED'] : []),
      ...(pack?.review !== 'approved' ? ['PACK_REVIEW_PENDING'] : []),
      ...(pack?.assets.some(a => a.review !== 'approved') ? ['MEDIA_REVIEW_PENDING'] : []),
      ...(!audioAttached ? ['FIXED_AUDIO_MISSING'] : []),
      ...(audioAttached && !ruleNarrationAttached ? ['RULE_NARRATION_MISSING'] : []),
      ...(audioAttached && !narrationAsset?.voice ? ['VOICE_ID_MISSING'] : []),
      ...(row?.envelope.body.markets.includes('LOCAL') ? ['LOCAL_MARKET_ONLY'] : []),
    ];
    rows.push({ slot, ageBand, locale, task, contentId:pack?.id ?? null, contentVersion:pack?.version ?? null,
      contentHash:row?.envelope.body.packHash ?? null, channel:row?.envelope.body.channel ?? null,
      requiredNarrationKind:'rule', requiredNarrationText:pack?.copy.rule ?? null,
      attachedCopyKey:pack?.audio?.copyKey ?? null,
      audioAttached, ruleNarrationAttached, audioSha256:audioAttached ? narrationAsset?.sha256 ?? null : null,
      voice:audioAttached ? narrationAsset?.voice ?? null : null, issues });
  }
  const report = { schemaVersion: 2, generatedAt: new Date().toISOString(),
    scope: 'Fresh source development catalogue. Does not inspect a studio database, approve voices, verify human reviews, or certify a market release.',
    expected: { ageBands:ages, locales:languages, tasks:TASKS },
    summary: { combinations:rows.length, sourcePacks:entries.length,
      withFixedAudio:rows.filter(x => x.audioAttached).length, missingFixedAudio:rows.filter(x => !x.audioAttached).length,
      withRuleNarration:rows.filter(x => x.ruleNarrationAttached).length,
      strategyOnlyAudio:rows.filter(x => x.audioAttached && x.attachedCopyKey === 'strategy').length,
      missingRuleNarration:rows.filter(x => !x.ruleNarrationAttached).length,
      distinctMissingRuleScripts:new Set(rows.filter(x => !x.ruleNarrationAttached && x.requiredNarrationText).map(x => `${x.locale}:${x.requiredNarrationText}`)).size,
      publishedEligible:rows.filter(x => x.issues.length === 0).length,
      pendingHumanReview:rows.filter(x => x.issues.includes('PACK_REVIEW_PENDING')).length }, rows };
  const text = (value: string | null) => (value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const markdown = `# 固定语音与分龄内容缺口清单\n\n生成时间：${report.generatedAt}。本清单来自干净的源码开发内容库，只帮助内容团队制作与审阅；它不证明声音自然、专业审核完成，也没有读取实际工作台或家庭数据。\n\n- 年龄段：${ages.join('、')}；语言：${languages.join('、')}；任务：${TASKS.join('、')}。\n- ${report.summary.withFixedAudio}/${report.summary.combinations} 个组合已有字幕与所绑定文本逐字匹配的固定 MP3；其中 ${report.summary.withRuleNarration} 个朗读完整规则、${report.summary.strategyOnlyAudio} 个只朗读策略，${report.summary.missingFixedAudio} 个缺少声音。\n- ${report.summary.missingRuleNarration} 个组合尚缺正式发布所需的规则朗读，按语言和当前规则去重为 ${report.summary.distinctMissingRuleScripts} 条台词；跨年龄共用录音仍须逐档审核。${report.summary.publishedEligible} 个组合满足当前源码层面的正式内容标记。全部现有素材仍为开发预览。\n\n| 年龄 | 语言 | 任务 | 现有声音 | 完整规则朗读 | 现有音色 ID（仅参考） | 待制作或复核的完整规则 |\n|---|---|---|---|---|---|---|\n${rows.map(r => `| ${r.ageBand} | ${r.locale} | ${r.task} | ${r.audioAttached ? r.attachedCopyKey === 'strategy' ? '策略录音' : '规则录音' : '缺失'} | ${r.ruleNarrationAttached ? '已接入，待审核' : '待制作'} | ${text(r.voice)} | ${text(r.requiredNarrationText)} |`).join('\n')}\n\n## 每个组合的验收步骤\n\n1. 运行 \`npm run voice:content -- --missing-rules --dry-run\` 核对四条待录规则；制作命令仅将候选写入未跟踪的 \`dist/content-rule-candidates\`，不会覆盖已签名素材或自动附加内容包。\n2. 按表中完整规则和语言制作或复核固定 MP3，把文件、字幕及新内容版本绑定；运行时直接播放已审素材。已有策略录音不得冒充规则录音，旧开发包保持原签名。\n3. 母语审核人完整听审发音、语气和适龄程度，方法负责人对照任务规则及判分检查指令。审核依据应保存到内容工作流。\n4. 检查 MP3 字节与摘要，在参考设备上验收播放、字幕、图片辨识和无障碍使用。对获准组合发布不可变内容版本。\n5. 国家、年龄、语言及客户端渠道逐项取得准入结论；单一组合的批准不扩展至其他组合。\n`;
  if (jsonPath) await writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n');
  if (markdownPath) await writeFile(markdownPath, markdown);
  console.log(JSON.stringify({ ...report.summary, ...(jsonPath ? { report:jsonPath } : {}), ...(markdownPath ? { checklist:markdownPath } : {}) }));
} finally { await db.close(); }
