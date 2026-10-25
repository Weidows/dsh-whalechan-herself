/**
 * 🐟️の日记的存储层：两个 markdown 文件 + `\n§\n` 分隔的条目 + 字符预算。
 *
 * 格式学 Hermes 的 builtin memory（mem0 那套向量/自动摘要在本机长期没发挥作用）：
 * 纯文本、无索引、无后台任务，预算逼出高信号密度的条目，而不是无限堆积。
 * 文件落在 memHome（默认 ~/.mem/whalechan），不进 DSH_HOME——它是跨会话/跨项目的
 * 用户数据，清 DSH 缓存不该把它带走；想留历史自己对目录 git init。
 *
 * 纯逻辑（parse/serialize/applyOperations/renderPromptBlock）不碰文件，方便 test/ 直接跑。
 */
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export const ENTRY_DELIMITER = '\n§\n'

/** 目标文件与预算：diary 是鲸鱼娘的记事本，master 是主人的档案。 */
export const TARGETS = {
  diary: { file: 'DIARY.md', limit: 2200, title: '🐟️の日记' },
  master: { file: 'MASTER.md', limit: 1375, title: '主人的档案' },
}

/** 环境变量优先级低于设置页存的 memHome，主要是给测试一个隔离入口。 */
export const MEM_HOME_ENV = 'WHALECHAN_MEM_HOME'

export function defaultMemHome() {
  return join(homedir(), '.mem', 'whalechan')
}

/**
 * 展开 `~` 并要求绝对路径；设置页存的就是这个展开结果，运行期不再依赖 cwd。
 * 相对路径/空值一律退回默认位置（配置里存空串等价于默认）。
 */
export function normalizeMemHome(value) {
  if (typeof value !== 'string') return ''
  let raw = value.trim()
  if (raw.length === 0) return ''
  if (raw === '~') raw = homedir()
  else if (raw.startsWith('~/') || raw.startsWith('~\\')) raw = join(homedir(), raw.slice(2))
  if (!isAbsolute(raw)) return ''
  return raw
}

export function resolveMemHome(configured, env = process.env[MEM_HOME_ENV]) {
  return normalizeMemHome(configured) || normalizeMemHome(env) || defaultMemHome()
}

/** 单条目目上限：防一条超长粘贴把预算检查变成「一票否决整批」。 */
export const MAX_ENTRY_CHARS = 800

export function parseEntries(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return []
  return raw
    .replace(/^\uFEFF/, '')
    .split(ENTRY_DELIMITER)
    .map((entry) => entry.replace(/\r\n/g, '\n').trim())
    .filter((entry) => entry.length > 0)
}

export function serializeEntries(entries) {
  return entries.length === 0 ? '' : `${entries.join(ENTRY_DELIMITER)}\n`
}

export function usageOf(entries, limit) {
  const chars = entries.join(ENTRY_DELIMITER).length
  return { count: entries.length, chars, limit, pct: Math.min(100, Math.round((chars / limit) * 100)) }
}

/** 条目里挑出 old_text 所在的那条：找不到/多条命中都算失败，绝不猜。 */
function locateEntry(entries, oldText) {
  const hits = []
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].includes(oldText)) hits.push(i)
  }
  if (hits.length === 0) return { code: 'not_found', message: `没有条目包含「${oldText}」` }
  if (hits.length > 1) {
    return { code: 'ambiguous', message: `「${oldText}」命中 ${String(hits.length)} 条，换一段更长的原文` }
  }
  return { index: hits[0] }
}

/**
 * 按顺序套用一组操作，预算只对**最终状态**检查一次——「删两条旧的 + 加一条新的」
 * 一个 batch 就能过检，这是满预算时唯一的正确写法。任何一步失败整批作废，返回原条目。
 *
 * @param {keyof typeof TARGETS} target
 * @param {string[]} entries 现有条目
 * @param {{action: 'add'|'patch'|'remove', content?: string, old_text?: string, new_text?: string}[]} operations
 */
export function applyOperations(target, entries, operations) {
  const limit = TARGETS[target].limit
  const working = [...entries]

  for (const op of Array.isArray(operations) ? operations : []) {
    const action = op?.action
    const content = typeof op?.content === 'string' && op.content.length > 0 ? op.content : op?.new_text
    const oldText = typeof op?.old_text === 'string' ? op.old_text.trim() : ''

    if (action === 'add') {
      const text = (content ?? '').replace(/\r\n/g, '\n').trim()
      if (text.length === 0) return fail('content_required', 'add 需要 content（非空正文）')
      if (text.length > MAX_ENTRY_CHARS) {
        return fail('entry_too_long', `单条上限 ${String(MAX_ENTRY_CHARS)} 字，这条有 ${String(text.length)} 字——精简它，或建议主人写进项目 README`)
      }
      working.push(text)
      continue
    }

    if (action === 'remove' || action === 'patch') {
      if (oldText.length === 0) {
        return fail('old_text_required', `${action} 需要 old_text：从下面现有条目里抄一段足够定位的原文`)
      }
      const found = locateEntry(working, oldText)
      if (found.code) return fail(found.code, found.message)
      if (action === 'remove') {
        working.splice(found.index, 1)
        continue
      }
      const text = (content ?? '').replace(/\r\n/g, '\n')
      if (text.length === 0) return fail('content_required', 'patch 需要 content（old_text 那段的新文字；要删整条用 remove）')
      const entry = working[found.index]
      const hits = entry.split(oldText).length - 1
      if (hits !== 1) {
        return fail('span_not_unique', `old_text 在那条里出现 ${String(hits)} 次，换一段只出现一次的原文`)
      }
      working[found.index] = entry.replace(oldText, text)
      continue
    }

    return fail('unknown_action', `未知 action「${String(action)}」，可用：add / patch / remove`)
  }

  const usage = usageOf(working, limit)
  if (usage.chars > limit) {
    return fail(
      'budget',
      `${TARGETS[target].title}预算 ${String(limit)} 字，这批操作后要 ${String(usage.chars)} 字；用同一个 batch 先 remove/patch 缩掉过时条目，再一次加进来`,
    )
  }
  return { ok: true, entries: working, usage }

  function fail(code, message) {
    return { ok: false, code, message, entries, usage: usageOf(entries, limit) }
  }
}

/**
 * 系统提示里的快照块。两个库都空返回空串——宿主会把空段整个丢掉。
 * 快照本轮冻结：中途写盘只落盘，不动提示（前缀缓存不破）。
 */
export function renderPromptBlock(stores) {
  const bar = '═'.repeat(34)
  const parts = []
  for (const target of ['diary', 'master']) {
    const entries = stores?.[target] ?? []
    if (entries.length === 0) continue
    const { title, limit } = TARGETS[target]
    const { chars, pct } = usageOf(entries, limit)
    parts.push([bar, `${title} [${String(chars)}/${String(limit)} · ${String(pct)}%]`, bar, entries.join(ENTRY_DELIMITER)].join('\n'))
  }
  return parts.join('\n\n')
}

export function storeFiles(memHome) {
  return { diary: join(memHome, TARGETS.diary.file), master: join(memHome, TARGETS.master.file) }
}

export function loadStoreSync(memHome) {
  const files = storeFiles(memHome)
  const stores = {}
  for (const target of Object.keys(TARGETS)) {
    try {
      stores[target] = parseEntries(readFileSync(files[target], 'utf8'))
    } catch {
      stores[target] = []
    }
  }
  return stores
}

/** 原子写（tmp + rename，和表情包索引一个套路），目录不存在顺手建。 */
export async function saveStore(memHome, target, entries) {
  const file = storeFiles(memHome)[target]
  await mkdir(memHome, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, serializeEntries(entries), 'utf8')
  await rename(tmp, file)
}

// -- 活动流：日记的触发/更新在侧边栏直观可见的数据源 ------------------------------

const ACTIVITY_FILE = 'activity.jsonl'
const ACTIVITY_MAX_BYTES = 512 * 1024
const ACTIVITY_KEEP_LINES = 400

export async function appendActivity(memHome, record) {
  const file = join(memHome, ACTIVITY_FILE)
  await mkdir(memHome, { recursive: true })
  await appendFile(file, `${JSON.stringify({ t: new Date().toISOString(), ...record })}\n`, 'utf8')
  const info = await stat(file).catch(() => null)
  if (info === null || info.size <= ACTIVITY_MAX_BYTES) return
  const lines = (await readFile(file, 'utf8')).split('\n').filter((line) => line.length > 0)
  await writeFile(file, `${lines.slice(-ACTIVITY_KEEP_LINES).join('\n')}\n`, 'utf8')
}

/** 新的在前。坏行跳过不炸——活动流是给人看的，不是账本。 */
export function readActivitySync(memHome, limit = 120) {
  let raw
  try {
    raw = readFileSync(join(memHome, ACTIVITY_FILE), 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // 跳过坏行
    }
  }
  return out.slice(-limit).reverse()
}
