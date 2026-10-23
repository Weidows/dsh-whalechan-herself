/**
 * 掷骰这一段是「概率」唯一真正生效的地方，所以单独盯一下：
 * 命中要真的往消息尾部加，未命中要把旧的删掉（不能越堆越多），同一轮后续 step 不重掷。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { writeChance } from '../lib/chance.js'
import { apply } from '../lib/index.js'

const KIND = 'whalechan-sticker-roll'

async function withChance(chance, run) {
  const home = await mkdtemp(join(tmpdir(), 'whalechan-roll-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  await writeChance(chance, { home })
  try {
    let handler
    apply({
      tools: { register: () => {} },
      on: (name, fn) => {
        if (name === 'agent/pre-step') handler = fn
      },
      effect: (fn) => void fn(),
      get: () => undefined,
      logger: { warn: () => {} },
    })
    await run(handler)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

const enter = (messages = []) => async () => ({ kind: 'enter', messages })
const payload = (step) => ({ step, signal: { aborted: false } })

test('命中：尾部追加一条掷骰消息', async () => {
  const original = Math.random
  Math.random = () => 0.01
  try {
    await withChance(100, async (preStep) => {
      const decision = await preStep(payload(1), enter([{ id: 'a', role: 'user', content: [] }]))
      assert.equal(decision.messages.length, 2)
      const rolled = decision.messages.at(-1)
      assert.equal(rolled.source.kind, KIND)
      assert.match(rolled.content[0].text, /命中/)
    })
  } finally {
    Math.random = original
  }
})

test('未命中：把上一轮那条删掉，不叠加', async () => {
  await withChance(0, async (preStep) => {
    const stale = {
      id: 'stale',
      role: 'user',
      content: [{ type: 'text', text: '上一轮的' }],
      source: { kind: KIND, form: 'snapshot', sections: [] },
    }
    const decision = await preStep(payload(1), enter([{ id: 'a', role: 'user', content: [] }, stale]))
    assert.deepEqual(
      decision.messages.map((m) => m.id),
      ['a'],
    )
  })
})

test('同一轮后续 step 不重掷', async () => {
  const original = Math.random
  let rolls = 0
  Math.random = () => {
    rolls += 1
    return 0.01
  }
  try {
    await withChance(100, async (preStep) => {
      const first = await preStep(payload(1), enter([]))
      const second = await preStep(payload(2), async () => ({ kind: 'enter', messages: first.messages }))
      assert.equal(second.messages.length, 1)
      assert.equal(rolls, 1)
    })
  } finally {
    Math.random = original
  }
})
