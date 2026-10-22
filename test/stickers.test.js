import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import test from 'node:test'

import { SITE, buildIndex, cacheFile, loadArchive, searchStickers } from '../lib/stickers.js'

const work = (over = {}) => ({
  id: 'sticker_1',
  n: '摸鱼的 DeepSeek 娘',
  cids: ['deepseek'],
  i: '/submissions/previews/deepseek/aaaa.webp',
  l: '/submissions/large/deepseek/aaaa.webp',
  k: ['meme'],
  ts: '梗图',
  tg: ['摸鱼', '吐槽'],
  d: '蓝发少女趴在桌上偷懒。',
  ...over,
})

const archive = {
  works: [
    work(),
    work({ id: 'sticker_2', n: '干饭的 DeepSeek 娘', i: '/submissions/previews/deepseek/bbbb.webp', tg: ['干饭', '白米饭'] }),
    work({ id: 'sticker_3', n: 'GPT娘', cids: ['gpt'], tg: ['摸鱼'] }),
    work({ id: 'sticker_4', n: '没有预览的图', i: '' }),
    work({ id: 'sticker_5', n: '只有预览', l: undefined }),
  ],
}

test('buildIndex 只收有预览图的条目，并补成绝对地址', () => {
  const index = buildIndex(archive)
  assert.equal(index.total, 4)
  assert.equal(index.works[0].preview, `${SITE}/submissions/previews/deepseek/aaaa.webp`)
  assert.equal(index.works[0].large, `${SITE}/submissions/large/deepseek/aaaa.webp`)
  assert.equal(index.works[3].large, index.works[3].preview)
})

test('searchStickers 按标签命中，且默认只找 DeepSeek 娘', () => {
  const index = buildIndex(archive)
  const result = searchStickers(index, { scene: '摸鱼', count: 3 })
  assert.equal(result.matched, true)
  assert.ok(result.stickers.length > 0)
  assert.equal(result.stickers[0].name, '摸鱼的 DeepSeek 娘')
  assert.ok(result.stickers.every((sticker) => !sticker.name.startsWith('GPT娘')))
})

test('searchStickers 认同义词：饿 → 干饭', () => {
  const index = buildIndex(archive)
  const result = searchStickers(index, { scene: '好饿', count: 1 })
  assert.equal(result.matched, true)
  assert.equal(result.stickers[0].name, '干饭的 DeepSeek 娘')
})

test('开工吐槽也要找得到图（开工 → 吐槽/摸鱼）', () => {
  const index = buildIndex(archive)
  const result = searchStickers(index, { scene: '开工了 又要干活', count: 1 })
  assert.equal(result.matched, true)
  assert.ok(result.stickers[0].tags.includes('吐槽') || result.stickers[0].tags.includes('摸鱼'))
})

test('没有好匹配时退回随机并标记 matched:false', () => {
  const index = buildIndex(archive)
  const result = searchStickers(index, { scene: '量子力学考试', count: 2 })
  assert.equal(result.matched, false)
  assert.equal(result.stickers.length, 2)
})

test('返回的 markdown 是可粘贴的图片语法，名字里的方括号不会拆坏它', () => {
  const index = buildIndex({
    works: [work({ n: '图 [1]' })],
  })
  const [sticker] = searchStickers(index, { scene: '摸鱼' }).stickers
  assert.equal(sticker.markdown, `![图  1](${SITE}/submissions/previews/deepseek/aaaa.webp)`)
})

test('character=any 不按角色过滤', () => {
  const index = buildIndex(archive)
  const result = searchStickers(index, { scene: '摸鱼', character: 'any', count: 8 })
  assert.equal(result.total, 4)
})

test('loadArchive 读取缓存，不在 fetch 可用时也照常工作', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whalechan-'))
  const file = cacheFile(home)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(archive))

  const offline = () => {
    throw new Error('offline')
  }
  const index = await loadArchive({ home, fetchImpl: offline })
  assert.equal(index.total, 4)
})

test('loadArchive 无缓存且下载失败时给出可读的错误', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whalechan-'))
  const offline = async () => {
    throw new Error('offline')
  }
  await assert.rejects(() => loadArchive({ home, refresh: true, fetchImpl: offline }), /下载失败/)
})
