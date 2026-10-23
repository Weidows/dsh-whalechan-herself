import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  DEFAULT_CHANCE,
  MAX_CHANCE,
  MIN_CHANCE,
  configFile,
  normalizeChance,
  readChance,
  writeChance,
} from '../lib/chance.js'

test('normalizeChance 钳在 0-100，坏值回默认', () => {
  assert.equal(normalizeChance(0), MIN_CHANCE)
  assert.equal(normalizeChance(100), MAX_CHANCE)
  assert.equal(normalizeChance(-5), MIN_CHANCE)
  assert.equal(normalizeChance(999), MAX_CHANCE)
  assert.equal(normalizeChance('42'), 42)
  assert.equal(normalizeChance(42.6), 43)
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
