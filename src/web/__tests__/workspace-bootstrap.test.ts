import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workspaceDOM } from './workspace-helpers.js'
void test('workspace browser entry mounts without starting any provider work', async t => {
  const d = workspaceDOM()
  d.window.Telegram.WebApp.initData = ''
  Object.defineProperty(globalThis, 'document', {
    value: d.document,
    configurable: true
  })
  t.after(() => Reflect.deleteProperty(globalThis, 'document'))
  Object.defineProperty(globalThis, 'window', {
    value: d.window,
    configurable: true
  })
  t.after(() => Reflect.deleteProperty(globalThis, 'window'))
  await import('../workspace-client.js')
  assert.equal(d.nodes.refresh!.disabled, true)
})
