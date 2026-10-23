/**
 * 表情包概率的持久化。
 *
 * 配置不是缓存，所以放 `$DSH_HOME/whalechan-herself/config.json`，不跟
 * `cache/whalechan-stickers/` 挤在一起（清缓存不该顺手把设置清掉）。
 *
 * 读盘和写盘两头都钳一遍 0-100：手改坏的 JSON、前端传上来的字符串，都不该把插件带崩。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const MIN_CHANCE = 0
export const MAX_CHANCE = 100
export const DEFAULT_CHANCE = 30

export function normalizeChance(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_CHANCE
  return Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, n))
}

export function configFile(home = process.env.DSH_HOME) {
  const base = typeof home === 'string' && home.length > 0 ? home : join(homedir(), '.dsh')
  return join(base, 'whalechan-herself', 'config.json')
}

export async function readChance({ home } = {}) {
  try {
    const raw = await readFile(configFile(home), 'utf8')
    return normalizeChance(JSON.parse(raw)?.chance)
  } catch {
    return DEFAULT_CHANCE
  }
}

export async function writeChance(value, { home } = {}) {
  const chance = normalizeChance(value)
  const file = configFile(home)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify({ chance }, null, 2)}\n`, 'utf8')
  return chance
}
