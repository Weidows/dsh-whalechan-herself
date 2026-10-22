# dsh-whalechan-herself

给 DeepSeek Harness 装一个 **鲸鱼娘（Whale-chan / DeepSeek娘）** Agent 预设：干活能力和自带预设一样全，说话有性格，开工先吐槽、收工要白米饭，还会按场景从社区图库里找表情包发给你。

## 装

用 DSH 的插件管理器装目录（不是 `npm install` 进 profile，也不是手改 profile 的 yml）：

```
plugin_manager  action: install_bundle  target: <本仓库绝对路径>
```

装完在 **新会话** 的预设里选「鲸鱼娘 Whale-chan」。已开着的会话沿用旧插件版本，不会变。

## 里面有什么

| 部分 | 说明 |
| --- | --- |
| `cordis.patch.yml` | 插入 `preset-whalechan`：插件列表照抄 Web 自带的 `standard` 预设（bash/pwsh、文件、搜索、任务、子代理、workflow、web、plan mode、compaction 全在），只把 persona 换成鲸鱼娘，并多挂一行本插件 |
| `lib/index.js` | 注册 `sticker` 工具 |
| `lib/stickers.js` | 图库索引的下载、缓存、模糊匹配（纯逻辑，`npm test` 直接跑） |

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

两个实现上的坑，改的时候别踩回去：

- **不要 `import` `@deepseek-ai/*` 框架包。** 本插件是从 profile 里 `link:` 到源码目录的，裸包名会从源码目录往上找、找不到（Node 解析符号链接后按真实路径算）。所以 `lib/index.js` 直接用 `ctx.tools.register({ name, description, parameters, output, execute })` 注册裸定义，`parameters` / `output.schema` 写标准 JSON Schema——和 MCP 服务器注册工具是同一种形状。
- **改插件代码要重启 DSH 才生效。** 宿主进程按 ESM 缓存已经导入过的模块，新会话也吃不到改后的代码。改 `cordis.patch.yml`（预设定义）不需要重装，但同样要重启宿主；`cordis.patch.yml` 改完想立刻验证就重装一次 bundle 更稳。

## 致谢与许可

- 角色设定参考 [Neko3000/deepseek-whalechan](https://github.com/Neko3000/deepseek-whalechan)。
- 表情包图源 [lmy414/ai-girl-stickers](https://github.com/lmy414/ai-girl-stickers)，在线索引与版权说明见 [蓝色大肥鱼](https://xn--pssy23gqgbz2d718b.com/)（网友二创合集，多数图片授权状态不明，仅限个人非商用；具体以站点每张图的权利说明为准）。
- 本插件代码与图标：MIT。
- 鲸鱼娘角色本身不是 DeepSeek 官方形象，是社区创作。
