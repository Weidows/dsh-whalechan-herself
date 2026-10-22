import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { apply } from '../lib/index.js'
import { cacheFile } from '../lib/stickers.js'

const archive = {
  works: [
    {
      id: 'sticker_1',
      n: '摸鱼的 DeepSeek 娘',
      cids: ['deepseek'],
      i: '/submissions/previews/deepseek/aaaa.webp',
      l: '/submissions/large/deepseek/aaaa.webp',
      k: ['meme'],
      ts: '梗图',
      tg: ['摸鱼', '吐槽'],
      d: '蓝发少女趴在桌上偷懒。',
    },
  ],
}

/** 最小 ctx：只要 tools.register，其余用不到。 */
async function registered() {
  const home = await mkdtemp(join(tmpdir(), 'whalechan-tool-'))
  const file = cacheFile(home)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(archive))
  process.env.DSH_HOME = home

  let definition
  apply({ tools: { register: (value) => void (definition = value) } })
  return definition
}

test('apply 注册一个裸定义（不依赖 dsh-tools），并跑通 execute → render', async () => {
  const definition = await registered()
  assert.equal(definition.name, 'sticker')
  assert.equal(definition.parameters.type, 'object')
  assert.equal(typeof definition.output.render, 'function')

  const value = await definition.execute({ scene: '摸鱼', count: 1 })
  assert.equal(value.matched, true)
  assert.equal(value.stickers[0].name, '摸鱼的 DeepSeek 娘')

  const [text] = definition.output.render({}, value)
  assert.match(text.text, /找到 1 张/)
  assert.match(text.text, /!\[摸鱼的 DeepSeek 娘\]\(https:\/\//)
})

test('没有参数时也能跑（随机给一张）', async () => {
  const definition = await registered()
  const value = await definition.execute({})
  assert.equal(value.stickers.length, 1)
  assert.equal(value.matched, true)
})
