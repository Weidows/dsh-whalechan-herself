/**
 * client bundle 是自注册脚本（不是 ESM），宿主扫不到 / 语法不对就静默少一页。
 * 这里用假的 window + 假 react 把它跑一遍，确认三件事：
 *   1. 注册的 id 和 package.json 的 name 一致（不一致宿主就接不上）；
 *   2. 不是 ESM（真正的 bundle 里不能有 import/export）；
 *   3. apply() 真的往 settings.section 里塞了一页「鲸鱼娘」。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'lib/client.js'), 'utf8')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

test('bundle 不是 ESM，且 id 与包名一致', () => {
  assert.doesNotMatch(source, /^\s*(?:import|export)\s/m)
  assert.equal(pkg.dsh?.client?.platform, 'web')
  assert.equal(pkg.exports?.['./client'], './lib/client.js')

  let captured
  new Function('window', source)({ __ModuleLoader__: { load: (entry) => (captured = entry) } })
  assert.equal(captured.id, pkg.name)
  assert.equal(typeof captured.factory, 'function')
})

test('apply 往 settings.section 注册一页「鲸鱼娘」', () => {
  let captured
  new Function('window', source)({ __ModuleLoader__: { load: (entry) => (captured = entry) } })

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (value) => [value, () => {}],
    useEffect: () => {},
  }
  const mod = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`bundle 不该 require ${name}`)
  })
  assert.deepEqual(mod.inject, ['slots'])

  const injected = []
  const registered = []
  const slots = {
    inject: (name, run) => {
      injected.push(name)
      run()
    },
    register: (decl, component) => registered.push({ decl, component }),
  }

  mod.apply({ get: (name) => (name === 'slots' ? slots : undefined) })

  assert.deepEqual(injected, ['settings.section'])
  assert.equal(registered.length, 1)
  const { decl, component } = registered[0]
  assert.equal(decl.name, 'settings.section')
  assert.equal(decl.id, 'whalechan')
  assert.equal(decl.label, '鲸鱼娘')
  assert.equal(typeof decl.order, 'number')

  // component 是 () => h(Panel)，再往下叫一层才真正跑 Panel 本体。
  const element = component()
  assert.equal(typeof element.type, 'function')
  assert.equal(element.type().type, 'div')
})

test('没有 slots 服务时安静退出，不炸整个页面', () => {
  let captured
  new Function('window', source)({ __ModuleLoader__: { load: (entry) => (captured = entry) } })
  const mod = captured.factory(() => ({ createElement: () => null, useState: () => [0, () => {}], useEffect: () => {} }))
  assert.doesNotThrow(() => mod.apply({}))
  assert.doesNotThrow(() => mod.apply({ get: () => undefined }))
})
