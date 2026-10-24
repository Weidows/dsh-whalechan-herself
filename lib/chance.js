/**
 * 设置持久化：表情包概率 + 用户自定义设定。
 *
 * 配置不是缓存，所以放 `$DSH_HOME/whalechan-herself/config.json`，不跟
 * `cache/whalechan-stickers/` 挤在一起（清缓存不该顺手把设置清掉）。
 *
 * 读写两头都钳一遍：手改坏的 JSON、前端传上来的字符串，都不该把插件带崩。
 * 概率留一位小数（默认 66.6%），自定义设定截断在 `MAX_CUSTOM` 字，免得一屏
 * 提示词把每轮的 token 预算吃掉。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const MIN_CHANCE = 0
export const MAX_CHANCE = 100
export const DEFAULT_CHANCE = 66.6
/** 自定义设定的长度上限（字符）。2000 字够写名字、称呼、口癖和一两条规矩。 */
export const MAX_CUSTOM = 2000

export function normalizeChance(value) {
  const n = Math.round(Number(value) * 10) / 10
  if (!Number.isFinite(n)) return DEFAULT_CHANCE
  return Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, n))
}

export function normalizeCustom(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n/g, '\n').trim().slice(0, MAX_CUSTOM)
}

export function configFile(home = process.env.DSH_HOME) {
  const base = typeof home === 'string' && home.length > 0 ? home : join(homedir(), '.dsh')
  return join(base, 'whalechan-herself', 'config.json')
}

export async function readSettings({ home } = {}) {
  try {
    const raw = JSON.parse(await readFile(configFile(home), 'utf8'))
    return { chance: normalizeChance(raw?.chance), custom: normalizeCustom(raw?.custom) }
  } catch {
    return { chance: DEFAULT_CHANCE, custom: '' }
  }
}

/** 只写传进来的字段，其余保留：设置页存概率时不该把自定义设定冲掉。 */
export async function writeSettings(patch = {}, { home } = {}) {
  const current = await readSettings({ home })
  const next = {
    chance: patch?.chance === undefined ? current.chance : normalizeChance(patch.chance),
    custom: patch?.custom === undefined ? current.custom : normalizeCustom(patch.custom),
  }
  const file = configFile(home)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

export async function readChance(options) {
  return (await readSettings(options)).chance
}

export async function writeChance(value, options) {
  return (await writeSettings({ chance: value }, options)).chance
}

/**
 * 自定义设定的同步读。人设段（systemPrompt.section）的 text 只能是同步函数，
 * 而这个文件只有几百字节——每次装配读一遍比缓存一层状态更不容易错。
 */
export function readCustomSync({ home } = {}) {
  try {
    return normalizeCustom(JSON.parse(readFileSync(configFile(home), 'utf8'))?.custom)
  } catch {
    return ''
  }
}
