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

import { readChance, writeChance } from '../lib/chance.js'
import { apply } from '../lib/index.js'

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
    assert.equal(routes.length, 1)
    assert.equal(routes[0].path, ROUTE)
    assert.equal(routes[0].kind, 'exact')
    await run(routes[0].handler, home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

test('GET 读当前概率', async () => {
  await withRoute(45, async (handler) => {
    const res = fakeRes()
    await handler({ method: 'GET' }, res)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { ok: true, chance: 45 })
  })
})

test('POST 落盘并钳在 0-100', async () => {
  await withRoute(30, async (handler, home) => {
    const ok = fakeRes()
    await handler(postReq('{"chance":"55"}'), ok)
    assert.deepEqual(ok.body, { ok: true, chance: 55 })
    assert.equal(await readChance({ home }), 55)

    const over = fakeRes()
    await handler(postReq('{"chance":999}'), over)
    assert.equal(over.body.chance, 100)
    assert.equal(await readChance({ home }), 100)
  })
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
