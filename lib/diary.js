/**
 * 🐟️の日记——跨会话/跨项目的持久记忆。
 *
 * 三块东西：
 *   1. `diary` 工具：模型侧唯一写入口（add/patch/remove + batch，预算只看最终状态）。
 *      render 把「写了什么/没写成为什么」渲染进聊天流——记忆的触发与更新
 *      不该只藏在 JSON 里，用户要能一眼看到。
 *   2. systemPrompt 段 `whalechan:diary`：会话装配时冻结的快照，贴在 persona
 *      后缀前两位（自定义设定 10199 再前一位 10198）。中途写盘不动提示，前缀缓存不破。
 *   3. 活动流 activity.jsonl + HTTP 路由：侧边栏页面的数据源。
 *
 * 存储格式与预算策略见 lib/memory.js（学 Hermes builtin，不走向量/自动摘要）。
 */
import { DEFAULT_CHANCE, readMemHomeSync, readSettings } from './chance.js'
import {
  ENTRY_DELIMITER,
  MAX_ENTRY_CHARS,
  TARGETS,
  appendActivity,
  applyOperations,
  loadStoreSync,
  readActivitySync,
  renderPromptBlock,
  resolveMemHome,
  saveStore,
  usageOf,
} from './memory.js'

export const DIARY_SECTION = 'whalechan:diary'
/** 侧边栏页面的后端路由；和 config.json 同源不同路径。 */
export const DIARY_ROUTE = '/plugins/dsh-whalechan-herself/diary.json'

/** 会话注入的活动记录节流：提示段每次装配都会算，全记会刷屏。 */
const INJECT_LOG_INTERVAL_MS = 30 * 60 * 1000
let lastInjectLog = 0

const DIARY_DESCRIPTION = [
  'Write to 鲸鱼娘的 persistent diary (target "diary") or 主人的档案 (target "master"): small, high-signal facts that must survive across sessions and projects.',
  'Entries are joined by "§"; a char budget (diary 2200 / master 1375) applies to the FINAL state, so one batch call can remove stale entries and add new ones together.',
  'WHAT BELONGS HERE (碎屑 only): favourite tools and how you run them, how local project folders nest, where generated images go and how they are named, how to connect/use servers, hard prohibitions (never max out CPU/GPU), pet alias names for addresses or tools, the user\'s stable preferences and form of address.',
  'WHAT DOES NOT: anything big enough for a README / AGENTS.md / docs page belongs in the project\'s git repo — suggest that to 主人 instead of writing it here. No task progress, no one-off facts re-discoverable from the repo.',
  'One fact per entry, short and dense. When full, consolidate first (remove outdated, merge duplicates) in the SAME batch that adds the new entry.',
  'patch/remove need old_text: a span copied from one existing entry (unique within it). On failure the current entries are returned — copy from them and retry.',
].join(' ')

const opSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', description: 'add | patch | remove.' },
    content: { type: 'string', description: 'add: the new entry. patch: the replacement text for the old_text span.' },
    old_text: { type: 'string', description: 'Required for patch/remove: a span from one entry, unique within it.' },
  },
  required: ['action'],
}

const DIARY_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', description: 'Single-op shape: add | patch | remove. Omit when using operations.' },
    target: { type: 'string', description: '"diary" = 鲸鱼娘的记事本（环境、习惯、工具坑、教训）; "master" = 主人的档案（称呼、偏好、禁忌）.' },
    content: { type: 'string', description: 'As in a single operation.' },
    old_text: { type: 'string', description: 'As in a single operation.' },
    operations: {
      type: 'array',
      description: 'Batch shape: applied in order, char budget checked once against the FINAL state. Preferred for multiple changes or consolidation.',
      items: opSchema,
    },
  },
  required: ['target'],
}

// 输出结构不封口（同 sticker 的教训：多一个字段就整条 INVALID_TOOL_OUTPUT，代价太大）。
const DIARY_OUTPUT = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    target: { type: 'string' },
    code: { type: 'string' },
    message: { type: 'string' },
    usage: { type: 'object' },
    entries: { type: 'array', items: { type: 'string' } },
    applied: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'target', 'entries'],
}

/** 每条操作的一行摘要：聊天流和活动流共用这一种写法。 */
function opLine(op) {
  const action = op?.action ?? '?'
  const content = op?.content ?? op?.new_text ?? ''
  const old = op?.old_text ?? ''
  if (action === 'remove') return `- 删「${excerpt(old)}」`
  if (action === 'patch') return `- 改「${excerpt(old)}」→「${excerpt(content)}」`
  return `- 加「${excerpt(content)}」`
}

function excerpt(text, max = 40) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 提示段文本（同步）。两个库都空 → 空串，宿主把空段整个丢掉。 */
export function diarySectionText() {
  const memHome = resolveMemHome(readMemHomeSync())
  const stores = loadStoreSync(memHome)
  const block = renderPromptBlock(stores)
  if (block.length === 0) return ''
  const total = Object.values(stores).reduce((sum, entries) => sum + entries.length, 0)
  if (total > 0 && Date.now() - lastInjectLog > INJECT_LOG_INTERVAL_MS) {
    lastInjectLog = Date.now()
    appendActivity(memHome, { kind: 'inject', diary: stores.diary.length, master: stores.master.length }).catch(() => {})
  }
  return block
}

/** 工具/设置页共用的写路径：套操作 → 落盘 → 记活动。任何一步失败都不落盘。 */
async function writeOps(memHome, target, operations) {
  const stores = loadStoreSync(memHome)
  const result = applyOperations(target, stores[target], operations)
  if (!result.ok) return result

  await saveStore(memHome, target, result.entries)
  await appendActivity(memHome, {
    kind: 'write',
    via: 'tool',
    target,
    ops: (Array.isArray(operations) ? operations : [operations]).map(opLine),
    usage: `${String(result.usage.count)} 条 · ${String(result.usage.chars)}/${String(result.usage.limit)} 字`,
  }).catch(() => {})
  return result
}

export function registerDiaryTool(ctx) {
  ctx.tools.register({
    name: 'diary',
    description: DIARY_DESCRIPTION,
    parameters: DIARY_PARAMETERS,
    timeoutMs: 15000,
    output: {
      schema: DIARY_OUTPUT,
      render: (_args, value) => renderDiaryOutput(value),
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const target = args?.target
      if (!(target in TARGETS)) {
        return { ok: false, target: String(target ?? ''), code: 'bad_target', message: 'target 只能是 diary 或 master', entries: [] }
      }
      const operations = Array.isArray(args?.operations) ? args.operations : [args]
      const settings = await readSettings().catch(() => ({ chance: DEFAULT_CHANCE, custom: '', memHome: '' }))
      const memHome = resolveMemHome(settings.memHome)

      const result = await writeOps(memHome, target, operations)
      if (!result.ok) {
        return {
          ok: false,
          target,
          code: result.code,
          message: result.message,
          usage: result.usage,
          entries: result.entries,
        }
      }
      return {
        ok: true,
        target,
        message: '已记好。这条更新到此为止，不要重复写。',
        usage: result.usage,
        entries: result.entries,
        applied: (operations ?? []).map(opLine),
      }
    },
  })
}

/** 聊天流里的直观显示：写入成功给一行摘要，失败给原因 + 现有条目。绝不抛错。 */
export function renderDiaryOutput(value) {
  try {
    const title = TARGETS[value?.target]?.title ?? value?.target ?? '?'
    if (value?.ok !== true) {
      const lines = [`⚠️ ${title} 没写进去：${value?.message ?? '未知原因'}`]
      if (Array.isArray(value?.entries) && value.entries.length > 0) {
        lines.push('现有条目（改哪条，就从里面抄一段 old_text）：')
        lines.push(...value.entries.map((entry, index) => `${String(index + 1)}. ${excerpt(entry, 120)}`))
      } else {
        lines.push('（现在还是空的，只能 add）')
      }
      return [{ type: 'text', text: lines.join('\n') }]
    }
    const usage = value?.usage ?? {}
    const lines = [
      `📖 ${title} 已更新：${String(value?.applied?.length ?? 1)} 处（现在 ${String(usage.count ?? '?')} 条 · ${String(usage.chars ?? '?')}/${String(usage.limit ?? '?')} 字 · ${String(usage.pct ?? '?')}%）`,
      ...(Array.isArray(value?.applied) ? value.applied.map((line) => `  ${line}`) : []),
    ]
    return [{ type: 'text', text: lines.join('\n') }]
  } catch {
    return [{ type: 'text', text: '📖 日记结果（渲染失败，见原始输出）' }]
  }
}

/** 人设段注册：挂在自定义设定（10199）再前一位。ctx 里没 systemPrompt 就静默跳过。 */
export function registerDiarySection(ctx, systemPrompt) {
  if (typeof systemPrompt?.section !== 'function' || typeof systemPrompt.getSectionOrder !== 'function') return
  const order = systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') - 2
  ctx.effect(() => systemPrompt.section({ name: DIARY_SECTION, order, text: diarySectionText }), 'whalechan: 日记段')
}

// -- 侧边栏页面的后端 -----------------------------------------------------------

/** POST body 上限：条目总量有预算管着，64KB 绰绰有余，别让无界读取挂着。 */
export const MAX_BODY_BYTES = 64 * 1024

async function readBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > MAX_BODY_BYTES) throw new Error('body too large')
  }
  return body
}

/**
 * 整包保存（侧边栏编辑用）：非空、单条不超限、总量过预算才收。
 * 和工具共用 applyOperations 的预算语义，但来源是「用户逐条编辑后的完整列表」。
 */
async function replaceStore(memHome, target, entries) {
  if (!Array.isArray(entries)) return { ok: false, message: 'entries 必须是字符串数组' }
  const cleaned = entries
    .map((entry) => String(entry ?? '').replace(/\r\n/g, '\n').trim())
    .filter((entry) => entry.length > 0)
  for (const entry of cleaned) {
    if (entry.includes(ENTRY_DELIMITER)) return { ok: false, message: '条目里不能包含分隔符 §' }
    if (entry.length > MAX_ENTRY_CHARS) {
      return { ok: false, message: `单条上限 ${String(MAX_ENTRY_CHARS)} 字：「${excerpt(entry)}」超了` }
    }
  }
  const usage = usageOf(cleaned, TARGETS[target].limit)
  if (usage.chars > TARGETS[target].limit) {
    return { ok: false, message: `${TARGETS[target].title}预算 ${String(TARGETS[target].limit)} 字，现在 ${String(usage.chars)} 字，先删几条再存`, usage }
  }
  await saveStore(memHome, target, cleaned)
  await appendActivity(memHome, {
    kind: 'edit',
    via: 'ui',
    target,
    ops: [`${String(cleaned.length)} 条 · ${String(usage.chars)}/${String(usage.limit)} 字`],
  }).catch(() => {})
  return { ok: true, usage }
}

export function registerDiaryRoute(ctx, webServer) {
  return webServer.register({
    kind: 'exact',
    path: DIARY_ROUTE,
    handler: async (req, res) => {
      const send = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(value))
      }
      try {
        const settings = await readSettings()
        const memHome = resolveMemHome(settings.memHome)

        if (req.method === 'GET') {
          // 侧边栏活动时间线只要增量小包，别把整库条目再拉一遍。
          if (typeof req?.url === 'string' && req.url.split('?')[1]?.split('&').includes('view=activity')) {
            const stores = loadStoreSync(memHome)
            send(200, {
              ok: true,
              activity: readActivitySync(memHome),
              usage: {
                diary: usageOf(stores.diary, TARGETS.diary.limit),
                master: usageOf(stores.master, TARGETS.master.limit),
              },
            })
            return
          }
          const stores = loadStoreSync(memHome)
          const payload = { ok: true, memHome, defaultMemHome: resolveMemHome('') === memHome }
          for (const target of Object.keys(TARGETS)) {
            payload[target] = { entries: stores[target], usage: usageOf(stores[target], TARGETS[target].limit) }
          }
          send(200, payload)
          return
        }

        if (req.method === 'POST') {
          const patch = JSON.parse((await readBody(req)) || '{}')
          if (!(patch?.target in TARGETS)) {
            send(400, { ok: false, error: 'target 只能是 diary 或 master' })
            return
          }
          const result = await replaceStore(memHome, patch.target, patch.entries)
          if (!result.ok) {
            send(400, { ok: false, error: result.message })
            return
          }
          const stores = loadStoreSync(memHome)
          send(200, {
            ok: true,
            target: patch.target,
            usage: result.usage,
            entries: stores[patch.target],
          })
          return
        }

        send(405, { ok: false, error: 'method not allowed' })
      } catch (error) {
        ctx.logger?.warn?.(`whalechan: 日记路由处理失败（${String(error?.message ?? error)}）`)
        send(400, { ok: false, error: String(error?.message ?? error) })
      }
    },
  })
}
