/**
 * dsh-whalechan-herself host half: the `sticker` tool.
 *
 * The persona row lives in cordis.patch.yml; this module only gives her a way
 * to find a sticker that fits the moment. It deliberately returns Markdown
 * image lines: the Web GUI renders http(s) markdown images as <img>, so the
 * model can paste one straight into its reply.
 *
 * Note: no `@deepseek-ai/dsh-tools` import. This bundle is installed as a link
 * to a source checkout outside the profile, so a bare framework import would
 * not resolve; `ctx.tools.register` accepts a raw definition with plain JSON
 * Schema (the same shape MCP servers register), which is all we need.
 */
import { STICKER_TYPES, loadArchive, searchStickers } from './stickers.js'

export const name = 'dsh-whalechan-herself'
export const inject = ['tools']

const DESCRIPTION = [
  'Find a community sticker (表情包) of DeepSeek娘/鲸鱼娘 for the current scene or mood.',
  'Returns ready-to-paste Markdown image lines (`![名字](链接)`) plus tags and a short description.',
  'Call it when a sticker genuinely fits — start-of-work grumbling, finishing a task, being teased, a small mishap, cheering the user up.',
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

const stickerSchema = {
  type: 'object',
  additionalProperties: false,
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
  additionalProperties: false,
  properties: {
    matched: { type: 'boolean' },
    total: { type: 'integer' },
    scene: { type: 'string' },
    stickers: { type: 'array', items: stickerSchema },
  },
  required: ['matched', 'total', 'scene', 'stickers'],
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
}
