import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  DEFAULT_CHANCE,
  MAX_CHANCE,
  MAX_CUSTOM,
  MIN_CHANCE,
  configFile,
  normalizeChance,
  normalizeCustom,
  readChance,
  readCustomSync,
  readSettings,
  writeChance,
  writeSettings,
} from '../lib/chance.js'

test('normalizeChance 钳在 0-100，坏值回默认', () => {
  assert.equal(normalizeChance(0), MIN_CHANCE)
  assert.equal(normalizeChance(100), MAX_CHANCE)
  assert.equal(normalizeChance(-5), MIN_CHANCE)
  assert.equal(normalizeChance(999), MAX_CHANCE)
  assert.equal(normalizeChance('42'), 42)
  assert.equal(normalizeChance(42.6), 42.6)
  assert.equal(normalizeChance(42.65), 42.7)
  assert.equal(normalizeChance(66.6), 66.6)
  assert.equal(normalizeChance(undefined), DEFAULT_CHANCE)
  assert.equal(normalizeChance('abc'), DEFAULT_CHANCE)
})

test('读写往返，坏 JSON 不炸', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whalechan-chance-'))
  try {
    assert.equal(await readChance({ home }), DEFAULT_CHANCE)
    assert.equal(await writeChance(35, { home }), 35)
    assert.equal(await readChance({ home }), 35)
    assert.equal(await writeChance(140, { home }), MAX_CHANCE)
    assert.equal(await readChance({ home }), MAX_CHANCE)

    await mkdir(join(home, 'whalechan-herself'), { recursive: true })
    await writeFile(configFile(home), '{ 坏', 'utf8')
    assert.equal(await readChance({ home }), DEFAULT_CHANCE)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('自定义设定：读写往返、截断、同步读，且写概率不会冲掉它', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whalechan-custom-'))
  try {
    assert.deepEqual(await readSettings({ home }), { chance: DEFAULT_CHANCE, custom: '' })
    assert.equal(readCustomSync({ home }), '')

    await writeSettings({ custom: '  你叫阿鲸，喊我老板。\r\n别自称 AI。 ' }, { home })
    assert.equal(readCustomSync({ home }), '你叫阿鲸，喊我老板。\n别自称 AI。')
    assert.equal(await readChance({ home }), DEFAULT_CHANCE)

    // 只存概率时自定义设定必须留着：设置页和旧客户端都只提交 chance。
    await writeChance(12.5, { home })
    const after = await readSettings({ home })
    assert.equal(after.chance, 12.5)
    assert.equal(after.custom, '你叫阿鲸，喊我老板。\n别自称 AI。')

    assert.equal(normalizeCustom('x'.repeat(MAX_CUSTOM + 50)).length, MAX_CUSTOM)
    assert.equal(normalizeCustom(null), '')
    assert.equal(normalizeCustom(42), '')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
