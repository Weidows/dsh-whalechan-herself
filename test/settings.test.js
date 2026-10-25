/**
 * 设置页的后端是「概率」唯一的写入口，所以单独盯一下收发：
 * GET 读当前值、POST 钳位后落盘、别的方法 405。跑不起真宿主，就用最小的
 * req/res 桩子把 handler 直接叫一遍。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { readChance, readSettings, writeChance, writeSettings } from '../lib/chance.js'
import { CUSTOM_SECTION, apply } from '../lib/index.js'

const ROUTE = '/plugins/dsh-whalechan-herself/config.json'

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

function postReq(body) {
  return {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

async function withRoute(chance, run) {
  const home = await mkdtemp(join(tmpdir(), 'whalechan-settings-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  await writeChance(chance, { home })

  const routes = []
  // 路由归 profile 根那行（config.uiOnly），预设里的子行只带工具和掷骰。
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

  try {
    // config.json + diary.json 两条都归 profile 根那行（config.uiOnly）。
    assert.equal(routes.length, 2)
    const config = routes.find((route) => route.path === ROUTE)
    assert.ok(config, `必须有 ${ROUTE}`)
    assert.equal(config.kind, 'exact')
    await run(config.handler, home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

test('GET 读当前设置', async () => {
  await withRoute(45, async (handler) => {
    const res = fakeRes()
    await handler({ method: 'GET' }, res)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { ok: true, chance: 45, custom: '', memHome: '' })
  })
})

test('POST 落盘并钳在 0-100', async () => {
  await withRoute(30, async (handler, home) => {
    const ok = fakeRes()
    await handler(postReq('{"chance":"55"}'), ok)
    assert.deepEqual(ok.body, { ok: true, chance: 55, custom: '', memHome: '' })
    assert.equal(await readChance({ home }), 55)

    const over = fakeRes()
    await handler(postReq('{"chance":999}'), over)
    assert.equal(over.body.chance, 100)
    assert.equal(await readChance({ home }), 100)
  })
})

test('POST 存自定义设定，且只发 chance 时不冲掉它', async () => {
  await withRoute(30, async (handler, home) => {
    const custom = fakeRes()
    await handler(postReq('{"custom":"你叫阿鲸，喊我老板。"}'), custom)
    assert.equal(custom.body.custom, '你叫阿鲸，喊我老板。')
    assert.equal((await readSettings({ home })).custom, '你叫阿鲸，喊我老板。')

    const onlyChance = fakeRes()
    await handler(postReq('{"chance":88}'), onlyChance)
    assert.equal(onlyChance.body.chance, 88)
    assert.equal(onlyChance.body.custom, '你叫阿鲸，喊我老板。')
  })
})

test('自定义设定注册成人设段，挂在 persona 后缀前一位并现读文件', async () => {
  const home = await mkdtemp(join(tmpdir(), 'whalechan-section-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
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

    // 现在挂两段：自定义设定 + 日记快照（日记段在它前一位）。
    assert.equal(sections.length, 2)
    const custom = sections.find((section) => section.name === CUSTOM_SECTION)
    const diary = sections.find((section) => section.name === 'whalechan:diary')
    assert.ok(custom)
    assert.ok(diary)
    assert.equal(custom.order, 10199)
    assert.equal(diary.order, 10198)
    // 空设定整段丢掉，不凭空多一个小标题；空日记同样。
    assert.equal(custom.text(), '')
    assert.equal(diary.text(), '')

    await writeChance(66.6, { home })
    await writeSettings({ custom: '你叫阿鲸，喊我老板。' }, { home })
    assert.match(custom.text(), /你叫阿鲸/)
    assert.match(custom.text(), /以这里为准/)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

test('别的动词 405，坏 body 400 但不炸插件', async () => {
  await withRoute(30, async (handler) => {
    const res = fakeRes()
    await handler({ method: 'DELETE' }, res)
    assert.equal(res.status, 405)
    assert.equal(res.body.ok, false)

    const broken = fakeRes()
    await handler(postReq('不是 JSON'), broken)
    assert.equal(broken.status, 400)
    assert.equal(broken.body.ok, false)
  })
})
