# dsh-whalechan-herself

> 给 DeepSeek Harness 装一个 **鲸鱼娘（Whale-chan / DeepSeek娘）** Agent 预设：干活能力和自带预设一样全，说话有性格，开工先吐槽、收工要白米饭，还会按概率从社区图库里挑表情包发给你。

| | |
| --- | --- |
| 能力分类 | 娱乐 / 技能与智能体 |
| 依赖 | DSH ≥ 0.2.0，Node ≥ 20；无需额外 API Key |
| 网络 | 只访问表情包图库的索引文件（首次调用时下载，之后 7 天走本地缓存） |
| 许可 | MIT |

## 装

```
dsh plugin --profile web add github:Weidows/dsh-whalechan-herself
```

在仓库里改代码调试时，也可以用 DSH 的插件管理器装本地目录（不是 `npm install` 进 profile，也不是手改 profile 的 yml）：

```
plugin_manager  action: install_bundle  target: <本仓库绝对路径>
```

装完**重启 DSH**，在**新会话**的预设里选「鲸鱼娘 Whale-chan」。已开着的会话沿用旧插件版本，不会变。

## 设置：表情包概率

设置页里有独立一页「鲸鱼娘」（`settings.section`），只有一个滑条：

- **0** = 关闭，这一轮永远不自发表情包
- **30** = 默认，大约三成轮次会发
- **100** = 每轮都发

概率不是写在人设里的百分比，那样模型只会「大概遵守」。实际做法是**宿主每轮掷一次骰**：命中就往这一轮的消息尾部放一条快照消息说「命中，发一张」，未命中放「别发」。模型只负责看图，规则由代码兜。

设置存在 `$DSH_HOME/whalechan-herself/config.json`：清缓存不会顺手清掉设置。

## 里面有什么

| 部分 | 说明 |
| --- | --- |
| `cordis.patch.yml` | 插入 `preset-whalechan`：插件列表照抄 Web 自带的 `standard` 预设（bash/pwsh、文件、搜索、任务、子代理、workflow、web、plan mode、compaction 全在），只把 persona 换成鲸鱼娘，并多挂一行本插件 |
| `lib/index.js` | 注册 `sticker` 工具、每轮掷骰（`agent/pre-step`）、设置页的配置路由 |
| `lib/stickers.js` | 图库索引的下载、缓存、模糊匹配（纯逻辑，`npm test` 直接跑） |
| `lib/chance.js` | 概率的读写与钳位（0–100，坏文件自动回默认） |
| `lib/client.js` | 浏览器半端：设置页那一页 |

性格设定写在预设的 `persona` 里：元气 / 傲娇 / 温柔可靠 / 偷懒 / 腹黑，同时硬性要求「事实优先、先读懂再动手、改完要验证、不编造输出」——卖萌只能占一两句，不能拿人设换干活质量。

## `sticker` 工具

按场景或心情在 [蓝色大肥鱼](https://xn--pssy23gqgbz2d718b.com/) 图库（[lmy414/ai-girl-stickers](https://github.com/lmy414/ai-girl-stickers) 的在线索引）里找图，返回可以直接粘的 Markdown 图片。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `scene` | 空 | 中文场景/心情关键词，如 `摸鱼 累`、`干完活了 讨饭`、`生气 拒绝`。留空就是随机 |
| `count` | 1 | 返回几张候选，1–8 |
| `character` | `deepseek` | 角色 id；`any` 表示全站 |
| `type` | 不限 | `meme` 梗图 / `illustration` 插画 / `standing` 立绘 / `comic` 漫画 / `setting` 设定图 / `other` |
| `random` | `false` | 跳过匹配直接随机 |
| `refresh` | `false` | 重新下载索引，不吃 7 天缓存 |

返回的 `markdown` 字段就是 `![名字](https://…/previews/…webp)`。Web GUI 会把 http(s) 的 Markdown 图片渲染成真图，所以直接放进回复就行，不需要额外的 UI 插件。

### 数据与缓存

图库仓库有几个 GB 且文件名哈希无语义，所以不 clone。工具只用站点那份 `archive-data.json`（约 3.7 MB，含标题/标签/描述），首次调用下载后缓存在 `$DSH_HOME/cache/whalechan-stickers/archive-data.json`，7 天内不再联网；站点握手不稳，下载失败会自动退回旧缓存。

## 开发

```
npm test     # node --test，纯逻辑，不联网
```

几个实现上的坑，改的时候别踩回去：

- **不要 `import` `@deepseek-ai/*` 框架包。** 本插件是从 profile 里 `link:` 到源码目录的，裸包名会从源码目录往上找、找不到（Node 解析符号链接后按真实路径算）。所以 `lib/index.js` 直接用 `ctx.tools.register({ name, description, parameters, output, execute })` 注册裸定义，`parameters` / `output.schema` 写标准 JSON Schema——和 MCP 服务器注册工具是同一种形状。
- **改插件代码要重启 DSH 才生效。** 宿主进程按 ESM 缓存已经导入过的模块，新会话也吃不到改后的代码。改 `cordis.patch.yml`（预设定义）不需要重装，但同样要重启宿主；`cordis.patch.yml` 改完想立刻验证就重装一次 bundle 更稳。
- **掷骰结果进消息，不进 `systemPrompt` 段。** 段一变，系统提示词头节点就要重写，从第一个变化的 token 起丢前缀缓存；往本轮消息尾部追加/原地替换只动尾巴。同一条消息靠 `source.kind === 'whalechan-sticker-roll'` 认领，同一轮重试时原地替换，不会越堆越多。
- **客户端 bundle 不是 ESM**，是 `window.__ModuleLoader__.load({ id, factory })` 自注册脚本，`id` 必须等于包名；进设置页用 `slots.register({ name: 'settings.section', … })`，`label` 就是左侧导航那一项。

## 致谢与许可

- 角色设定参考 [Neko3000/deepseek-whalechan](https://github.com/Neko3000/deepseek-whalechan)。
- 表情包图源 [lmy414/ai-girl-stickers](https://github.com/lmy414/ai-girl-stickers)，在线索引与版权说明见 [蓝色大肥鱼](https://xn--pssy23gqgbz2d718b.com/)（网友二创合集，多数图片授权状态不明，仅限个人非商用；具体以站点每张图的权利说明为准）。
- 本插件代码与图标：MIT。
- 鲸鱼娘角色本身不是 DeepSeek 官方形象，是社区创作。
