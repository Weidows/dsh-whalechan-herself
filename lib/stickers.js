/**
 * 鲸鱼娘表情包索引。
 *
 * lmy414/ai-girl-stickers 仓库有几千个文件，但 dist/ 里全是哈希文件名，没有语义；
 * 唯一带标签/标题/描述的数据源是站点的 archive-data.json。所以：下载一次 → 落盘缓存
 * → 在内存里按场景/心情模糊打分。站点时不时握手失败，所以缓存是必须的，不是优化。
 *
 * 纯逻辑（buildIndex / searchStickers）不碰网络，方便 test/ 直接跑。
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const SITE = 'https://xn--pssy23gqgbz2d718b.com'
export const ARCHIVE_URL = `${SITE}/archive-data.json`
export const STICKER_TYPES = ['meme', 'illustration', 'setting', 'comic', 'standing', 'other']

const TTL_MS = 7 * 24 * 60 * 60 * 1000
const MIN_BODY = 1024
const FETCH_TIMEOUT_MS = 20000

/** 场景词 → 图库里实际存在的标签。只做最常见的几种，多了就是猜。 */
const SYNONYMS = {
  开心: ['比心', '可爱', '搞笑'],
  高兴: ['比心', '可爱', '搞笑'],
  累: ['疲惫', '睡觉', '摸鱼'],
  疲惫: ['疲惫', '睡觉'],
  困: ['睡觉', '摸鱼'],
  饿: ['干饭', '吃饭'],
  饭: ['干饭', '吃饭'],
  开工: ['吐槽', '摸鱼', '摆烂'],
  上班: ['吐槽', '摸鱼', '加班'],
  干活: ['吐槽', '加班', '工作'],
  工作: ['工作', '加班', '吐槽'],
  忙: ['吐槽', '加班', '摆烂'],
  摆烂: ['摆烂', '摸鱼'],
  生气: ['生气', '拒绝'],
  委屈: ['委屈'],
  害羞: ['害羞', '脸红'],
  傲娇: ['傲娇'],
  夸: ['比心', '可爱'],
  摸摸: ['治愈', '可爱'],
  抱抱: ['治愈', '比心'],
  加班: ['吐槽', '摸鱼'],
  摸鱼: ['摸鱼'],
}

let memo = null

/** 缓存文件位置：$DSH_HOME/cache/whalechan-stickers/archive-data.json。 */
export function cacheFile(home = process.env.DSH_HOME) {
  const base = typeof home === 'string' && home.length > 0 ? home : join(homedir(), '.dsh')
  return join(base, 'cache', 'whalechan-stickers', 'archive-data.json')
}

async function download(fetchImpl = fetch) {
  let last
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(ARCHIVE_URL, {
        headers: { 'accept-encoding': 'identity', 'user-agent': 'dsh-whalechan-herself' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = Buffer.from(await res.arrayBuffer())
      if (body.length < MIN_BODY) throw new Error(`body too small (${body.length} bytes)`)
      return body
    } catch (error) {
      last = error
    }
  }
  throw last
}

/**
 * 读取索引：内存 → 新鲜缓存 → 下载（失败则退回旧缓存）。
 * @param {{ refresh?: boolean, home?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function loadArchive(options = {}) {
  const now = Date.now()
  if (!options.refresh && memo !== null && now - memo.at < TTL_MS) return memo.index

  const file = cacheFile(options.home)
  let raw = null

  if (!options.refresh) {
    try {
      const info = await stat(file)
      if (now - info.mtimeMs < TTL_MS) raw = await readFile(file)
    } catch {
      // 没有缓存，走下载
    }
  }

  if (raw === null) {
    try {
      const body = await download(options.fetchImpl)
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, body)
      await rename(tmp, file)
      raw = body
    } catch (error) {
      try {
        raw = await readFile(file)
      } catch {
        throw new Error(`表情包索引下载失败（${error.message}），本地也没有缓存：${ARCHIVE_URL}`)
      }
    }
  }

  const index = buildIndex(JSON.parse(raw.toString('utf8')))
  memo = { index, at: now }
  return index
}

/** 只留下需要的字段，顺手把相对路径补成绝对 URL。 */
export function buildIndex(archive) {
  const works = []
  for (const work of Array.isArray(archive?.works) ? archive.works : []) {
    if (typeof work?.i !== 'string' || work.i.length === 0) continue
    const preview = SITE + work.i
    works.push({
      id: work.id ?? work.slug ?? preview,
      name: typeof work.n === 'string' && work.n.length > 0 ? work.n : '（无名）',
      tags: Array.isArray(work.tg) ? work.tg : [],
      type: work.k?.[0] ?? 'other',
      typeName: typeof work.ts === 'string' ? work.ts : '',
      characters: Array.isArray(work.cids) ? work.cids : work.cid ? [work.cid] : [],
      preview,
      large: typeof work.l === 'string' && work.l.length > 0 ? SITE + work.l : preview,
      description: typeof work.d === 'string' ? work.d : '',
      author: typeof work.a === 'string' ? work.a : '',
    })
  }
  return { works, total: works.length }
}

function tokens(query) {
  const out = new Set()
  for (const part of query.split(/[\s,，、。;；:：!！?？~～…·()（）[\]【】"'“”‘’/\\|+-]+/u)) {
    if (part.length >= 2) out.add(part)
  }
  for (const match of query.matchAll(/[\u4e00-\u9fff]+/gu)) {
    const run = match[0]
    if (run.length > 4) for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2))
  }
  return [...out]
}

function extraTags(query) {
  const out = []
  for (const [word, tags] of Object.entries(SYNONYMS)) {
    if (query.includes(word)) out.push(...tags)
  }
  return out
}

function score(work, query, toks, extras) {
  const name = work.name.toLowerCase()
  const desc = work.description.toLowerCase()
  let total = 0
  for (const tok of toks) {
    if (work.tags.some((tag) => tag.toLowerCase() === tok)) total += 5
    else if (work.tags.some((tag) => tag.toLowerCase().includes(tok))) total += 3
    if (name.includes(tok)) total += 3
    if (desc.includes(tok)) total += 1
  }
  if (query.length >= 2) {
    if (name.includes(query)) total += 4
    if (desc.includes(query)) total += 2
  }
  for (const tag of extras) if (work.tags.some((t) => t.includes(tag))) total += 2
  return total
}

function shuffle(list) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function present(work) {
  return {
    name: work.name,
    tags: work.tags,
    typeName: work.typeName,
    preview: work.preview,
    large: work.large,
    // 名字里可能有 ] 或 )，会把 markdown 拆坏
    markdown: `![${work.name.replace(/[[\]]/g, ' ').trim()}](${work.preview})`,
    description: work.description.slice(0, 160),
  }
}

/**
 * 按场景/心情找图。查不到好匹配就退回随机（matched: false 告诉模型别硬说贴合）。
 * @param {{ works: object[], total: number }} index
 * @param {{ scene?: string, count?: number, character?: string, type?: string, random?: boolean }} [options]
 */
export function searchStickers(index, options = {}) {
  const count = Math.min(8, Math.max(1, Number.isFinite(options.count) ? Math.trunc(options.count) : 3))
  const scene = String(options.scene ?? '').trim()
  const character = String(options.character ?? 'deepseek').trim().toLowerCase()

  let pool = index.works
  if (character !== 'any') pool = pool.filter((work) => work.characters.includes(character))
  if (typeof options.type === 'string' && STICKER_TYPES.includes(options.type)) {
    pool = pool.filter((work) => work.type === options.type)
  }
  if (pool.length === 0) return { matched: false, total: 0, scene, stickers: [] }

  const query = scene.toLowerCase()
  if (options.random === true || query.length === 0) {
    return { matched: true, total: pool.length, scene, stickers: shuffle(pool).slice(0, count).map(present) }
  }

  const toks = tokens(query)
  const extras = extraTags(query)
  const ranked = pool
    .map((work) => ({ work, score: score(work, query, toks, extras) + Math.random() }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0].score
  const matched = Math.floor(best) > 0
  const picked = (matched ? ranked : shuffle(pool).map((work) => ({ work })))
    .slice(0, count)
    .map((entry) => present(entry.work))

  return { matched, total: pool.length, scene, stickers: picked }
}
