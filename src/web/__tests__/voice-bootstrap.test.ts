import { test } from 'node:test'
import assert from 'node:assert/strict'
import { domSetup } from './helpers.js'
void test('browser module bootstraps the visible page without opening a microphone', async t => {
  const d = domSetup()
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
  await import('../voice-client.js')
  assert.equal(d.nodes.start!.disabled, true)
  assert.match(d.nodes.status!.textContent, /Telegram/)
})
