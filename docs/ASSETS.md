# 视觉素材清单

本次使用内置 `image_gen` 生成了新的透明 PNG 素材，并复制到 `src/assets/` 作为项目资源。所有图片采用同一套儿童教育产品视觉规范：手绘 gouache、纸张纹理、sage green / warm cream / muted terracotta 配色、平静友好的表情、无文字和无水印。

| 文件 | 用途 | 生成内容 |
|---|---|---|
| `hero-island.png` | 首页主视觉、完成页 | 森林小岛、房子、小兔、树、溪流和暖阳 |
| `bridge-scene.png` | 小兔过桥卡片 | 木桥、溪流、兔子和狐狸，角色左右分离 |
| `characters-sheet.png` | 所有训练角色 | 2×2 透明精灵图：兔子、狐狸、小熊、小猫 |
| `objects-sheet.png` | 森林小邮差 | 2×2 透明精灵图：苹果、叶子、花朵、蓝莓 |

角色和物件精灵图通过 CSS 裁切，避免同一角色在不同题目中出现风格漂移。`src/art.js` 只负责映射语义名称到图片精灵；不再内嵌旧 SVG 角色和小岛插画。页面保留少量 SVG 只用于界面图标（箭头、暂停、声音、锁等），这些是 UI 矢量图标，不属于儿童场景素材。

## 图像生成提示词摘要

- 主岛：premium hand-painted gouache storybook forest island, cream cottage, rabbit, transparent background, warm morning, no text.
- 角色：four separate friendly rabbit, fox, bear, cat character sheet, consistent gouache and paper grain, transparent background.
- 过桥：wooden bridge, gentle stream, rabbit and fox waiting on opposite sides, transparent background, patient mood.
- 物件：apple, leaf, pink flower, purple berry cluster, four separate objects, gouache paper texture, transparent background.

生成后的 PNG 已在首页、游戏卡片、游戏说明和训练选项中进行浏览器检查，资源加载无错误。
