/**
 * 🐟️の日记的测试：存储纯逻辑（§ 分隔/预算/batch 原子性）、diary 工具的
 * 写入-失败-重试回路、diary.json 路由（GET/POST/activity/405）、以及人设段快照。
 *
 * 隔离靠 WHALECHAN_MEM_HOME 指到临时目录：日记在 ~/.mem/whalechan，
 * 不归 DSH_HOME 管，测试绝不许写真 home。
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  ENTRY_DELIMITER,
  applyOperations,
  normalizeMemHome,
  parseEntries,
  readActivitySync,
  renderPromptBlock,
  resolveMemHome,
  serializeEntries,
  storeFiles,
  usageOf,
} from '../lib/memory.js'
import { DIARY_SECTION, diarySectionText, registerDiaryTool, renderDiaryOutput } from '../lib/diary.js'
import { readSettings, writeSettings } from '../lib/chance.js'
import { apply } from '../lib/index.js'

async function withMemHome(run) {
  const memHome = await mkdtemp(join(tmpdir(), 'whalechan-diary-'))
  const previous = process.env.WHALECHAN_MEM_HOME
  process.env.WHALECHAN_MEM_HOME = memHome
  try {
    await run(memHome)
  } finally {
    if (previous === undefined) delete process.env.WHALECHAN_MEM_HOME
    else process.env.WHALECHAN_MEM_HOME = previous
    // Windows 上活动流的异步 append 可能晚于 rm，重试两次再放弃（目录在 tmp，留着无害）。
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rm(memHome, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 2) throw error
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }
}

// -- 纯逻辑 --------------------------------------------------------------------

test('§ 分隔的解析与序列化互逆，容忍 BOM/空白/空条目', () => {
  const entries = ['一条', '两条\n换行也行', '三条']
  assert.deepEqual(parseEntries(serializeEntries(entries)), entries)
  assert.deepEqual(parseEntries(`\uFEFF  一条 ${ENTRY_DELIMITER}  ${ENTRY_DELIMITER}两条\n\n`), ['一条', '两条'])
  assert.deepEqual(parseEntries(''), [])
  assert.equal(serializeEntries([]), '')
})

test('applyOperations：add 后预算只看最终状态（删+加一个 batch 过检）', () => {
  const filler = (i) => `旧条目${String(i)}，${'占一些字数凑预算用的填充'.repeat(28)}`
  const fresh = (tag) => `新知识${tag}，${'很重要的事'.repeat(130)}`
  const entries = Array.from({ length: 4 }, (_, i) => filler(i))
  // 4 条种子 ≈ 1264 字
  const seeded = applyOperations('diary', [], entries.map((content) => ({ action: 'add', content })))
  assert.equal(seeded.ok, true)
  assert.ok(seeded.usage.chars > 1200, '种子条目要真占住预算')

  // 顶格再加两条长的 → 最终 ~2600 字，超 2200，拒
  const alone = applyOperations('diary', seeded.entries, [
    { action: 'add', content: fresh('甲') },
    { action: 'add', content: fresh('乙') },
  ])
  assert.equal(alone.ok, false)
  assert.equal(alone.code, 'budget')
  assert.deepEqual(alone.entries, seeded.entries, '失败时原样返回')

  // 同一个 batch 里先删 3 条旧的再加同样的两条 → 最终 ~1650 字，过
  const batch = applyOperations('diary', seeded.entries, [
    { action: 'remove', old_text: filler(0).slice(0, 6) },
    { action: 'remove', old_text: filler(1).slice(0, 6) },
    { action: 'remove', old_text: filler(2).slice(0, 6) },
    { action: 'add', content: fresh('甲') },
    { action: 'add', content: fresh('乙') },
  ])
  assert.equal(batch.ok, true)
  assert.equal(batch.usage.count, 3)
  assert.ok(batch.usage.chars <= batch.usage.limit)
})

test('applyOperations 的失败码：old_text 缺失/找不到/多命中/span 不唯一', () => {
  const entries = ['服务器连 ssh://gpu 端口 22', '服务器别名是 gpu']
  assert.equal(applyOperations('diary', entries, [{ action: 'remove' }]).code, 'old_text_required')
  assert.equal(applyOperations('diary', entries, [{ action: 'remove', old_text: '不存在' }]).code, 'not_found')
  // 两条都含「服务器」→ 多命中；且 span 在同一条里出现两次也不行
  assert.equal(applyOperations('diary', entries, [{ action: 'patch', old_text: '服务器', content: '机器' }]).code, 'ambiguous')
  assert.equal(applyOperations('diary', ['一条一条'], [{ action: 'patch', old_text: '一条', content: 'x' }]).code, 'span_not_unique')
  // patch 只动 old_text 那一 span，条目其余部分保留
  const patched = applyOperations('diary', ['gpu 机器禁止打满'], [{ action: 'patch', old_text: '禁止', content: '别' }])
  assert.equal(patched.ok, true)
  assert.deepEqual(patched.entries, ['gpu 机器别打满'])
})

test('renderPromptBlock：空库空串；有货带用量标题', () => {
  assert.equal(renderPromptBlock({ diary: [], master: [] }), '')
  const block = renderPromptBlock({ diary: ['a', 'b'], master: [] })
  assert.match(block, /🐟️の日记 \[/)
  assert.doesNotMatch(block, /主人的档案/)
})

test('resolveMemHome：~ 展开、相对路径拒绝、env 参与解析', () => {
  assert.equal(resolveMemHome(''), resolveMemHome(''), '空串走默认')
  const expanded = resolveMemHome(join('~', '.mem', 'x'), undefined)
  assert.ok(expanded.endsWith(join('.mem', 'x')), `应展开为绝对路径：${expanded}`)
  assert.ok(expanded.includes(homedirSep()), '展开要基于 home')
  // 相对路径不猜：normalize 拒绝，resolve 退默认
  assert.equal(normalizeMemHome('relative/path'), '')
  assert.equal(resolveMemHome('relative/path'), resolveMemHome(''))
  assert.equal(resolveMemHome('', '/tmp/env-mem'), '/tmp/env-mem')
})

/** homedir 里的分隔符（win 是 \，posix 是 /），跨平台拼断言用。 */
function homedirSep() {
  return homedir().match(/[\\/]/)?.[0] ?? '/'
}

// -- 工具回路 ------------------------------------------------------------------

/** 最小 ctx：捕获工具定义。 */
function captureTool() {
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

test('diary 工具：add → 落盘 → 活动流；render 直观可见', async () => {
  await withMemHome(async (memHome) => {
    const tool = captureTool()
    assert.equal(tool.name, 'diary')

    const value = await tool.execute({ target: 'diary', action: 'add', content: '画好的图存 F:\\Pictures\\aigc，按角色/日期分子目录' })
    assert.equal(value.ok, true)
    assert.equal(value.usage.count, 1)
    assert.deepEqual(value.entries, ['画好的图存 F:\\Pictures\\aigc，按角色/日期分子目录'])

    const raw = await readFile(storeFiles(memHome).diary, 'utf8')
    assert.match(raw, /F:\\Pictures\\aigc/)

    const [text] = tool.output.render({}, value)
    assert.match(text.text, /📖 🐟️の日记 已更新/)
    assert.match(text.text, /加「画好的图存/)

    const activity = readActivitySync(memHome)
    assert.equal(activity.length, 1)
    assert.equal(activity[0].kind, 'write')
    assert.equal(activity[0].target, 'diary')
  })
})

test('diary 工具：失败时返回现有条目 + 原因，render 不会甩错', async () => {
  await withMemHome(async () => {
    const tool = captureTool()
    await tool.execute({ target: 'master', action: 'add', content: '喊我老板' })

    const failed = await tool.execute({ target: 'master', action: 'patch', old_text: '不存在的', content: 'x' })
    assert.equal(failed.ok, false)
    assert.equal(failed.code, 'not_found')
    assert.deepEqual(failed.entries, ['喊我老板'])

    const [text] = tool.output.render({}, failed)
    assert.match(text.text, /⚠️/)
    assert.match(text.text, /喊我老板/)

    // 坏 target 不炸
    const bad = await tool.execute({ target: 'nonsense', action: 'add', content: 'x' })
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'bad_target')
    tool.output.render({}, bad)
  })
})

test('diary 工具：batch 整合（删过时 + 加新）一次完成', async () => {
  await withMemHome(async () => {
    const tool = captureTool()
    await tool.execute({ target: 'diary', operations: [{ action: 'add', content: '旧习惯：每天手动备份' }, { action: 'add', content: '服务器用 jump 站连' }] })

    const value = await tool.execute({
      target: 'diary',
      operations: [
        { action: 'remove', old_text: '手动备份' },
        { action: 'add', content: '备份已交给 Syncthing，不要手动拷' },
      ],
    })
    assert.equal(value.ok, true)
    assert.deepEqual(value.entries, ['服务器用 jump 站连', '备份已交给 Syncthing，不要手动拷'])
  })
})

// -- 人设段 --------------------------------------------------------------------

test('diarySectionText：空库空串，写盘后出快照块（同步读）', async () => {
  await withMemHome(async (memHome) => {
    assert.equal(diarySectionText(), '')
    await writeFile(storeFiles(memHome).master, '称呼用「老板」\n§\n禁止打满 GPU\n', 'utf8')
    const text = diarySectionText()
    assert.match(text, /主人的档案 \[/)
    assert.match(text, /称呼用「老板」/)
    assert.doesNotMatch(text, /🐟️の日记/)
  })
})

test('apply 把日记段挂在自定义设定（10199）之前一位', async () => {
  const sections = []
  const systemPrompt = {
    getSectionOrder: (name) => (name === 'DEPLOYMENT_PERSONA_SUFFIX' ? 10200 : 0),
    section: (section) => {
      sections.push(section)
      return () => {}
    },
  }
  apply({
    tools: { register: () => {} },
    on: () => {},
    effect: (fn) => void fn(),
    get: (name) => (name === 'systemPrompt' ? systemPrompt : undefined),
    logger: { warn: () => {} },
  })
  const names = sections.map((section) => section.name)
  assert.deepEqual(names.sort(), ['whalechan:custom', DIARY_SECTION])
  const diary = sections.find((section) => section.name === DIARY_SECTION)
  assert.equal(diary.order, 10198)
})

// -- 路由 ----------------------------------------------------------------------

function fakeRes() {
  return {
    status: 0,
    body: undefined,
    writeHead(status) {
      this.status = status
    },
    end(payload) {
      this.body = JSON.parse(payload)
    },
  }
}

const postReq = (body) => ({
  method: 'POST',
  async *[Symbol.asyncIterator]() {
    yield body
  },
})

async function withRoute(run) {
  await withMemHome(async (memHome) => {
    const routes = []
    apply(
      {
        tools: { register: () => {} },
        on: () => {},
        effect: (fn) => void fn(),
        get: (name) => (name === 'webServer' ? { register: (route) => (routes.push(route), () => {}) } : undefined),
        logger: { warn: () => {} },
      },
      { uiOnly: true },
    )
    const diary = routes.find((route) => route.path.endsWith('/diary.json'))
    assert.ok(diary, 'diary.json 路由必须注册')
    await run(diary.handler, memHome)
  })
}

test('diary 路由：坏 body / 坏 target 400 但不炸', async () => {
  await withRoute(async (handler) => {
    const broken = fakeRes()
    await handler(postReq('不是 JSON'), broken)
    assert.equal(broken.status, 400)

    const badTarget = fakeRes()
    await handler(postReq(JSON.stringify({ target: 'nonsense', entries: [] })), badTarget)
    assert.equal(badTarget.status, 400)
  })
})

test('diary 路由收发：GET/POST/activity/405', async () => {
  await withRoute(async (handler, memHome) => {
    // GET：空库
    const empty = fakeRes()
    await handler({ method: 'GET', url: '/plugins/dsh-whalechan-herself/diary.json' }, empty)
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.body.diary.entries, [])
    assert.equal(empty.body.memHome, memHome)

    // POST：整包保存
    const saved = fakeRes()
    await handler(postReq(JSON.stringify({ target: 'diary', entries: ['工具习惯：7z 命令行', '目录：~/source/repos 是主仓库根'] })), saved)
    assert.equal(saved.status, 200)
    assert.equal(saved.body.ok, true)
    assert.equal(saved.body.usage.count, 2)

    // 活动流有 ui 写入记录
    const activity = fakeRes()
    await handler({ method: 'GET', url: '/plugins/dsh-whalechan-herself/diary.json?view=activity' }, activity)
    assert.equal(activity.status, 200)
    assert.equal(activity.body.activity[0].kind, 'edit')
    assert.equal(activity.body.activity[0].via, 'ui')

    // 超预算拒收（一堆 60 字的短条目把总量顶过 2200）
    const many = Array.from({ length: 40 }, (_, i) => `习惯${String(i).padStart(2, '0')}：${'啰嗦但合法的短条目'.repeat(6)}`)
    const over = fakeRes()
    await handler(postReq(JSON.stringify({ target: 'diary', entries: many })), over)
    assert.equal(over.status, 400)
    assert.match(over.body.error, /预算/)

    // 条目里藏 § 拒收（防格式被拆坏）
    const sneaky = fakeRes()
    await handler(postReq(JSON.stringify({ target: 'diary', entries: [`a${ENTRY_DELIMITER}b`] })), sneaky)
    assert.equal(sneaky.status, 400)

    // 405
    const denied = fakeRes()
    await handler({ method: 'DELETE' }, denied)
    assert.equal(denied.status, 405)
  })
})

// -- memHome 设置 --------------------------------------------------------------

test('memHome 进设置：保存展开 ~，读取原样带回，坏值退默认', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whalechan-memhome-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await writeSettings({ memHome: join('~', '.mem', 'whalechan') }, { home })
    let settings = await readSettings({ home })
    assert.ok(settings.memHome.endsWith(join('.mem', 'whalechan')), `~ 应展开：${settings.memHome}`)
    assert.notEqual(settings.memHome[0], '~')

    await writeSettings({ memHome: 'relative/nope' }, { home })
    settings = await readSettings({ home })
    assert.equal(settings.memHome, '', '相对路径不猜，退默认')

    await writeSettings({ memHome: '/abs/path' }, { home })
    settings = await readSettings({ home })
    assert.equal(settings.memHome, '/abs/path')

    // 只改 chance 不冲 memHome
    await writeSettings({ chance: 42 }, { home })
    settings = await readSettings({ home })
    assert.equal(settings.chance, 42)
    assert.equal(settings.memHome, '/abs/path')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

test('usageOf 计数正确', () => {
  const usage = usageOf(['ab', 'cd'], 100)
  assert.equal(usage.count, 2)
  assert.equal(usage.chars, `ab${ENTRY_DELIMITER}cd`.length)
  assert.equal(usage.pct, Math.min(100, Math.round((usage.chars / 100) * 100)))
})

test('renderDiaryOutput 对任意形状都不炸', () => {
  renderDiaryOutput(undefined)
  renderDiaryOutput({ ok: true, target: 'diary' })
  renderDiaryOutput({ ok: false, target: 'diary', entries: null })
})
