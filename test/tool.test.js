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

/** 最小 ctx：只要 tools.register / on / effect / get，其余用不到。 */
async function registered() {
  const home = await mkdtemp(join(tmpdir(), 'whalechan-tool-'))
  const file = cacheFile(home)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(archive))
  process.env.DSH_HOME = home

  let definition
  apply({
    tools: { register: (value) => void (definition = value) },
    on: () => {},
    effect: (fn) => void fn(),
    get: () => undefined,
    logger: { warn: () => {} },
  })
  return definition
}

/**
 * execute 的返回值必须严格落在 output.schema 里：schema 是 additionalProperties:false，
 * 多一个没声明的字段 Host 就整条判 invalid output（sticker 就因为漏声明 scene 全挂过）。
 */
function assertConforms(schema, value, path = 'value') {
  if (schema.type !== 'object' && schema.type !== 'array') return
  if (schema.type === 'array') {
    value.forEach((item, index) => assertConforms(schema.items, item, `${path}[${String(index)}]`))
    return
  }
  for (const [key, item] of Object.entries(value)) {
    assert.ok(schema.properties[key], `${path}.${key} is not a declared property`)
    assertConforms(schema.properties[key], item, `${path}.${key}`)
  }
  for (const key of schema.required ?? []) assert.ok(key in value, `${path}.${key} is required`)
}

test('apply 注册一个裸定义（不依赖 dsh-tools），并跑通 execute → render', async () => {
  const definition = await registered()
  assert.equal(definition.name, 'sticker')
  assert.equal(definition.parameters.type, 'object')
  assert.equal(typeof definition.output.render, 'function')

  const value = await definition.execute({ scene: '摸鱼', count: 1 })
  assertConforms(definition.output.schema, value)
  assert.equal(value.matched, true)
  assert.equal(value.stickers[0].name, '摸鱼的 DeepSeek 娘')

  const [text] = definition.output.render({}, value)
  assert.match(text.text, /找到 1 张/)
  assert.match(text.text, /!\[摸鱼的 DeepSeek 娘\]\(https:\/\//)
})

test('没有参数时也能跑（随机给一张）', async () => {
  const definition = await registered()
  const value = await definition.execute({})
  assertConforms(definition.output.schema, value)
  assert.equal(value.stickers.length, 1)
  assert.equal(value.matched, true)
})
