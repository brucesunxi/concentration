# “看清再行动”完整规则语音候选

2026-10-06。沿用已有 Azure Speech 资源，按当前源码规则生成四条固定 MP3，分别供儿童与青少年两档、中文与英文试听。生成时没有新增 API 密钥；密钥没有写入素材、清单或应用构建。

| 组合 | 完整规则 | 候选录音 | 长度 | SHA-256 |
|---|---|---|---:|---|
| 6–11 岁 · 中文 | 小兔出现时点一下。其他动物出现时，等它离开。 | [试听](../../../assets/content-rule-candidates/stop-rule-child-zh.mp3) | 5.784 秒 | `d2f3391b…be0f8de5` |
| 6–11 岁 · 英文 | Tap when a rabbit appears. Wait for the other animals to leave. | [试听](../../../assets/content-rule-candidates/stop-rule-child-en.mp3) | 5.520 秒 | `401587bd…e1fe` |
| 12–17 岁 · 中文 | 圆环出现时点一下。其他图形出现时，等它离开。 | [试听](../../../assets/content-rule-candidates/stop-rule-teen-zh.mp3) | 5.472 秒 | `a75f7afd…9ad10b4` |
| 12–17 岁 · 英文 | Tap when you see a ring. Wait when you see another shape. | [试听](../../../assets/content-rule-candidates/stop-rule-teen-en.mp3) | 4.776 秒 | `0fad5b91…2489e` |

完整摘要、声音 ID、语速、音高、字节数及两档适用范围写在[候选清单](../../../assets/content-rule-candidates/manifest.json)。`npm run voice:candidates:check` 已复核四份实际文件的 SHA-256、长度、响度、峰值和首尾静音，且当前规则文本在八个年龄/语言组合中逐字匹配。四份录音的 LUFS 为 -20.97 至 -20.24，真峰值为 -4.58 至 -4.42 dBTP；本次检查只验证工程条件，不证明语音听感自然或孩子能理解。

候选文件存放在 `assets/content-rule-candidates`，不在运行时 `src/audio` 中，也没有附加到已签名内容包。现有抑制任务开发包仍使用已签名的策略旁白；正式 `published` 包仍拒绝用策略旁白冒充规则。后续按 **6–8、9–11、12–14、15–17** 四档分别完成母语听审、方法规则与判分核对、参考设备播放和孩子理解检查。审核通过后，内容团队通过工作台导入实际音频文件、绑定逐字字幕、完成双人审核并发布新不可变内容版本；不修改旧包。
