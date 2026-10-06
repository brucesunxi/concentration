import manifest from '../../../assets/content-rule-candidates/manifest.json';
import childZh from '../../../assets/content-rule-candidates/stop-rule-child-zh.mp3?url';
import childEn from '../../../assets/content-rule-candidates/stop-rule-child-en.mp3?url';
import teenZh from '../../../assets/content-rule-candidates/stop-rule-teen-zh.mp3?url';
import teenEn from '../../../assets/content-rule-candidates/stop-rule-teen-en.mp3?url';

const sources: Record<string, string> = {
  'stop-rule-child-zh.mp3': childZh,
  'stop-rule-child-en.mp3': childEn,
  'stop-rule-teen-zh.mp3': teenZh,
  'stop-rule-teen-en.mp3': teenEn,
};

export function RuleVoiceCandidates() {
  return <section className="panel rule-voice-candidates" aria-labelledby="rule-voice-candidates-title">
    <span className="eyebrow">RULE NARRATION REVIEW</span>
    <h3 id="rule-voice-candidates-title">完整规则语音候选</h3>
    <p>以下四段录音供内部听审，分别对应四个年龄段的八种语言组合。它们尚未进入孩子使用的内容包，也未获得方法、母语或设备审核通过。</p>
    <div className="rule-voice-grid">
      {manifest.entries.map(entry => <article className="rule-voice-card" key={entry.file}>
        <div className="asset-top"><strong>{entry.cohort === 'child' ? '儿童' : '青少年'} · {entry.locale === 'zh-CN' ? '简体中文' : 'English'}</strong><span className="status">待审核</span></div>
        <p className="muted">适用候选：{entry.ageBands.join('、')} 岁。每个年龄段须单独核对理解与适龄性。</p>
        <p className="transcript">{entry.transcript}</p>
        <audio controls preload="none" src={sources[entry.file]} aria-label={`${entry.ageBands.join('、')} 岁 ${entry.locale} 完整规则候选录音`} />
        <p className="muted">{(entry.durationMs / 1000).toFixed(2)} 秒 · {entry.voice}</p>
        <a className="text-button" href={sources[entry.file]} download={entry.file}>下载原始 MP3，供编辑导入新稿</a>
        <details><summary>核对文件摘要</summary><code>{entry.sha256}</code></details>
      </article>)}
    </div>
    <p className="muted">导入时仍须核对来源和使用权，填写逐字字幕；换入新稿后完成当前稿试玩、完整听审和独立审核。试听此候选不会自动记录为稿件审核。</p>
  </section>;
}
