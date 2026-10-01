# Android 本地测试包源码留存验收

日期：2026-10-01。范围为 v0.38–v0.40 的隔离构建源码，不包含家庭资料。

## 留存结果

| 版本 | 已保存源码 | 归档 SHA-256 | 文件数 |
|---|---|---|---:|
| v0.38 | [归档](../../../dist/mobile-native/v0.38/android/source-archive.tar.gz) · [清单](../../../dist/mobile-native/v0.38/android/source-archive.json) | `f9c96931778cfb89fe6674f59002b756018d53e5c3aaa3ffea5c2deb30fd2cab` | 111 |
| v0.39 | [归档](../../../dist/mobile-native/v0.39/android/source-archive.tar.gz) · [清单](../../../dist/mobile-native/v0.39/android/source-archive.json) | `d7e257b50bf0561dab5489ad17cf0423e57420aafdbc1809c555ac516e6a3a1a` | 112 |
| v0.40 | [归档](../../../dist/mobile-native/v0.40/android/source-archive.tar.gz) · [清单](../../../dist/mobile-native/v0.40/android/source-archive.json) | `ba886048815ad7557a6585bc57a0b55472a443fb31b30ebb84a5c4d44c5fa7be` | 112 |

归档生成时核对隔离目录的每个源码文件与原始快照；归档后再次解压并逐文件验证摘要。三个归档均通过不依赖原构建目录的独立复核。清理三个已结束的临时构建目录后，可用空间从约 4.7GB 回到 7.3GB；[v0.40 APK 归档复核报告](../../../dist/mobile-native/v0.40/android/verification-from-archive.json)再次确认安装包 SHA-256、版本码 3、与 v0.39 同一签名和 112 个源码文件。归档测试还验证源码变化及归档字节损坏会被拒绝，不会生成成功报告；本批完整业务回归 297/297 通过。

复核命令为 `node scripts/verify-mobile-source-archive.mjs --archive <归档> --snapshot <对应快照> --report <对应清单>`。当前版本的 Android 包可在此基础上通过 `scripts/verify-android-local-artifact.mjs` 的 `--source-archive` 和 `--source-archive-report` 参数复核。旧版本 APK 的原始静态报告仍保存，但跨版本复核还需对应版本的源码检出；不能把当前工作区源码当作历史源码。

## 尚未完成

归档和散列证明的是这些本地文件之间的一致性，不证明编译器可信、真实设备行为、内容质量或市场合规。独立 PostgreSQL 测试仍未执行：本机 Docker API 在取得访问权限后没有返回，已终止无响应的只读检查命令，没有修改容器或数据库。该套件继续保留为发布阻断项。
