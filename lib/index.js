/**
 * dsh-whalechan-herself host half: the `sticker` tool, the per-turn sticker
 * dice, and the settings route behind the Web settings page.
 *
 * The persona row lives in cordis.patch.yml; this module gives her a way to
 * find a sticker that fits the moment. It deliberately returns Markdown image
 * lines: the Web GUI renders http(s) markdown images as <img>, so the model can
 * paste one straight into its reply.
 *
 * 发不发由宿主掷骰，不靠人设里的百分比：`agent/pre-step` 每轮往消息尾部放一条
 * 快照消息（命中/未命中），人设只管看图。掷骰结果进消息而不是 systemPrompt 段，
 * 因为段变了会让头节点重写、从第一个变化的 token 起丢前缀缓存；尾部追加不动基线。
 *
 * Note: no `@deepseek-ai/dsh-tools` import. This bundle is installed as a link
 * to a source checkout outside the profile, so a bare framework import would
 * not resolve; `ctx.tools.register` accepts a raw definition with plain JSON
 * Schema (the same shape MCP servers register), which is all we need.
 */
import { DEFAULT_CHANCE, readChance, writeChance } from './chance.js'
import { STICKER_TYPES, loadArchive, searchStickers } from './stickers.js'

export const name = 'dsh-whalechan-herself'
export const inject = ['tools']

const DESCRIPTION = [
  'Find a community sticker (表情包) of DeepSeek娘/鲸鱼娘 for the current scene or mood.',
  'Returns ready-to-paste Markdown image lines (`![名字](链接)`) plus tags and a short description.',
  'Call it when this turn says a sticker was rolled in (「表情包掷骰 · 命中」), or when a sticker genuinely fits.',
  'Never invent sticker URLs or describe a picture instead of sending it.',
].join(' ')

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    scene: {
      type: 'string',
      description:
        'Chinese scene/mood keywords, e.g. "摸鱼 累", "干完活了 讨饭", "生气 拒绝", "可爱 比心". Omit for a random sticker.',
    },
    count: { type: 'integer', description: 'How many candidates, 1-8. Default 1.' },
    character: {
      type: 'string',
      description: 'Character id filter, default deepseek. Use "any" for every character in the archive.',
    },
    type: { type: 'string', description: `Type filter: ${STICKER_TYPES.join(' | ')}.` },
    random: { type: 'boolean', description: 'Skip matching and pick at random.' },
    refresh: { type: 'boolean', description: 'Re-download the archive index instead of using the 7-day cache.' },
  },
}

// 输出结构故意不封口（不写 additionalProperties: false）：多一个字段就整条 INVALID_TOOL_OUTPUT
// 的代价太大——2026-10-22 就因为漏声明 scene，一整个会话的工具调用全挂。字段漂移交给
// test/tool.test.js 的 assertConforms 拦，运行期宁可多字段也别罢工。
const stickerSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    typeName: { type: 'string' },
    preview: { type: 'string' },
    large: { type: 'string' },
    markdown: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['name', 'tags', 'preview', 'large', 'markdown'],
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    matched: { type: 'boolean' },
    total: { type: 'integer' },
    scene: { type: 'string' },
    stickers: { type: 'array', items: stickerSchema },
  },
  required: ['matched', 'total', 'scene', 'stickers'],
}

/** 掷骰消息的 source.kind：同轮重试时靠它找到旧的那条，原地替换而不是越堆越多。 */
const ROLL_KIND = 'whalechan-sticker-roll'
/** 设置页读写的路由；和插件包名同源，重载时不会跟别人的路由撞。 */
const CONFIG_ROUTE = '/plugins/dsh-whalechan-herself/config.json'

function rollMessage(hit, chance) {
  const text = hit
    ? `[表情包掷骰 · 命中 ${chance}%] 这一轮请调用一次 sticker 工具，把返回的 \`![名字](链接)\` 原文贴进回复；只贴一张，结论和代码照常写。`
    : `[表情包掷骰 · 未命中 ${chance}%] 这一轮不要发表情包，也不要调用 sticker 工具。`
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: ROLL_KIND, form: 'snapshot', sections: [{ name: ROLL_KIND, text }] },
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'sticker',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    timeoutMs: 45000,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => {
        if (value.stickers.length === 0) return [{ type: 'text', text: '图库里没有符合条件的图。' }]
        const head = value.matched
          ? `找到 ${String(value.stickers.length)} 张（图库共 ${String(value.total)} 张）`
          : `没有贴合的匹配，随机给了 ${String(value.stickers.length)} 张：`
        const lines = value.stickers.map((sticker, index) => {
          const tags = sticker.tags.length > 0 ? ` [${sticker.tags.join(',')}]` : ''
          return `${String(index + 1)}. ${sticker.name}${tags}\n${sticker.markdown}`
        })
        return [{ type: 'text', text: [head, ...lines].join('\n') }]
      },
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const index = await loadArchive({ refresh: args?.refresh === true })
      return searchStickers(index, {
        scene: args?.scene,
        count: args?.count ?? 1,
        character: args?.character,
        type: args?.type,
        random: args?.random,
      })
    },
  })

  // 概率只在内存里放一份：设置页写盘后立刻覆盖，别每轮读文件。
  let chance = null
  const currentChance = async () => {
    if (chance === null) {
      chance = await readChance().catch(() => DEFAULT_CHANCE)
    }
    return chance
  }

  // 每轮开局掷一次。后续 step 不重掷：同一轮里命中/未命中必须稳定，否则消息来回变，
  // 缓存从头开始丢。
  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      const decision = await next()
      if (decision?.kind === 'reject' || payload?.signal?.aborted) return decision
      if (payload?.step !== 1) return decision
      if (!Array.isArray(decision.messages)) return decision

      const pct = await currentChance()
      const messages = [...decision.messages]
      const at = messages.findIndex((message) => message?.source?.kind === ROLL_KIND)

      if (pct <= 0) {
        if (at === -1) return decision
        messages.splice(at, 1)
        return { ...decision, messages }
      }

      const message = rollMessage(Math.random() * 100 < pct, pct)
      if (at === -1) messages.push(message)
      else messages[at] = message
      return { ...decision, messages }
    },
    { prepend: true },
  )

  // 设置页的后端。webServer 可能晚于本插件就位（headless 里永远没有），
  // 所以先试一次，没拿到就定时兜一下，拿到就停。
  let disposeRoute = null
  const registerRoute = () => {
    if (disposeRoute !== null) return
    let webServer
    try {
      webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer
    } catch {
      webServer = ctx.webServer
    }
    if (!webServer || typeof webServer.register !== 'function') return

    const handler = async (req, res) => {
      try {
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, chance: await currentChance() })
          return
        }
        if (req.method === 'POST') {
          let body = ''
          for await (const chunk of req) body += chunk
          chance = await writeChance(JSON.parse(body || '{}').chance)
          sendJson(res, 200, { ok: true, chance })
          return
        }
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
      } catch (error) {
        ctx.logger?.warn?.(`whalechan: 概率设置处理失败（${String(error?.message ?? error)}）`)
        sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
      }
    }

    try {
      disposeRoute = webServer.register({ kind: 'exact', path: CONFIG_ROUTE, handler })
    } catch (error) {
      // 重载/二次 apply 时宿主会对重复 path 抛 duplicate exact route，激活就整条挂了。
      ctx.logger?.warn?.(`whalechan: 概率设置路由注册失败（${String(error?.message ?? error)}）`)
      disposeRoute = () => {}
    }
  }

  registerRoute()
  if (disposeRoute === null) {
    const timer = setInterval(registerRoute, 1000)
    timer.unref?.()
    ctx.effect(() => () => clearInterval(timer), 'whalechan: 等 webServer')
  }
  ctx.effect(() => () => {
    disposeRoute?.()
    disposeRoute = null
  }, 'whalechan: 概率设置路由')
}
