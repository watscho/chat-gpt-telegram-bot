import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Watches } from '../watches.js'
import { config, MemoryStateStore } from '../../__tests__/helpers.js'
import { UserError } from '../../domain/conversation.js'
import type { WatchPorts } from '../../domain/watch.js'
const owner = '42:42',
  url = { kind: 'url' as const, url: 'https://example.com/page' }
function setup() {
  let now = 1000,
    text = 'One stable sentence.'
  const settings = config(),
    store = new MemoryStateStore(),
    notices: string[] = []
  settings.statePath = '/unit/state.db'
  const ports: WatchPorts = {
      allowed: () => true,
      read: () => Promise.resolve({ title: 'Page', text }),
      notify: (_owner, watch) => {
        notices.push(watch.id)
        return Promise.resolve()
      }
    },
    watches = new Watches(settings, ports, store, () => now)
  return {
    settings,
    store,
    ports,
    watches,
    notices,
    time: (value: number) => {
      now = value
    },
    text: (value: string) => {
      text = value
    }
  }
}
void test('watches validate subscriptions, persist baselines and cumulative thresholded diffs without model access', async () => {
  const s = setup()
  assert.throws(
    () => new Watches(s.settings, s.ports).add(owner, '1', url, 3600000, 0),
    /persistent/
  )
  s.settings.statePath = ':memory:'
  assert.throws(() => s.watches.add(owner, '1', url, 3600000, 0), /persistent/)
  s.settings.statePath = '/unit/state.db'
  for (const [interval, threshold] of [
    [1, 0],
    [604800001, 0],
    [3600000.5, 0],
    [3600000, -1],
    [3600000, 101],
    [3600000, NaN]
  ])
    assert.throws(() => s.watches.add(owner, '1', url, interval!, threshold!))
  for (const value of [
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/#hash',
    `https://example.com/${'x'.repeat(2050)}`
  ])
    assert.throws(() =>
      s.watches.add(owner, '1', { kind: 'url', url: value }, 3600000, 0)
    )
  for (const target of [
    { kind: 'file' as const, project: '', name: 'a' },
    { kind: 'file' as const, project: '1', name: '' },
    { kind: 'file' as const, project: '1', name: 'x'.repeat(161) }
  ])
    assert.throws(() => s.watches.add(owner, '1', target, 3600000, 0))
  const watch = s.watches.add(owner, '1', url, 3600000, 20)
  assert.throws(() => s.watches.add(owner, '1', url, 3600000, 0), /already/)
  assert.equal(s.watches.get('43:43').length, 0)
  await s.watches.check(owner, watch.id)
  assert.equal(s.notices.length, 0)
  s.text('One stable sentence!')
  await s.watches.check(owner, watch.id)
  assert.equal(s.notices.length, 0)
  assert.equal(
    s.watches.item(owner, watch.id).baseline!.text,
    'One stable sentence.'
  )
  s.text('A completely new paragraph.')
  await s.watches.check(owner, watch.id)
  assert.equal(s.notices.length, 1)
  const changed = s.watches.item(owner, watch.id)
  assert.equal(changed.changes[0]!.notified, true)
  assert.match(changed.changes[0]!.diff, /completely/)
  await s.watches.check(owner, watch.id)
  assert.equal(s.notices.length, 1)
  s.watches.refresh(owner)
  assert.equal(
    s.watches.item(owner, watch.id).baseline!.text,
    'A completely new paragraph.'
  )
  const restored = new Watches(s.settings, s.ports, s.store, () => 9999999)
  await restored.tick()
  assert.equal(restored.item(owner, watch.id).lastAt, 9999999)
  s.watches.enable(owner, watch.id, false)
  await s.watches.check(owner, watch.id)
  s.watches.enable(owner, watch.id, true)
  s.ports.allowed = () => false
  await s.watches.check(owner, watch.id)
  s.watches.remove(owner, watch.id)
  assert.throws(() => s.watches.item(owner, watch.id))
  assert.throws(() => s.watches.enable(owner, watch.id, true))
})
void test('watch failure and notification claims are sanitized, bounded and never retried automatically within a due interval', async () => {
  const s = setup(),
    watch = s.watches.add(owner, '1', url, 3600000, 0)
  for (const result of [
    { title: 'Page', text: '' },
    { title: 'Page', text: 'x'.repeat(60001) },
    { title: 'x'.repeat(201), text: 'A' }
  ]) {
    s.ports.read = () => Promise.resolve(result)
    await s.watches.check(owner, watch.id)
    assert.match(s.watches.item(owner, watch.id).error, /limit/)
  }
  s.ports.read = () => Promise.reject(new Error('private-token'))
  await s.watches.check(owner, watch.id)
  assert.doesNotMatch(s.watches.item(owner, watch.id).error, /private-token/)
  s.ports.read = () =>
    Promise.reject(new UserError('Public source unavailable.'))
  await s.watches.check(owner, watch.id)
  assert.equal(
    s.watches.item(owner, watch.id).error,
    'Public source unavailable.'
  )
  let reads = 0
  s.ports.read = () => {
    reads++
    return Promise.resolve({ title: 'Page', text: `Version ${reads}` })
  }
  await s.watches.check(owner, watch.id)
  s.ports.notify = () => Promise.reject(new Error('transport unavailable'))
  await s.watches.check(owner, watch.id)
  assert.equal(s.watches.item(owner, watch.id).changes.length, 1)
  await s.watches.tick()
  assert.equal(reads, 2)
  for (let i = 0; i < 12; i++) await s.watches.check(owner, watch.id)
  assert.equal(s.watches.item(owner, watch.id).changes.length, 10)
  s.watches.erase(owner)
  assert.equal(s.watches.get(owner).length, 0)
  s.settings.maxJobBytes = 1
  assert.throws(() => s.watches.add(owner, '1', url, 3600000, 0), /capacity/)
})
void test('watch cancellation, revision changes and deletion prevent in-flight reads from resurrecting state', async () => {
  for (const action of [
    'disable',
    'remove',
    'erase',
    'stop',
    'revision',
    'external-delete',
    'reject'
  ] as const) {
    const s = setup(),
      watch = s.watches.add(owner, '1', url, 3600000, 0)
    let resolve!: (value: { title: string; text: string }) => void,
      reject!: (error: Error) => void,
      calls = 0
    s.ports.read = () => {
      calls++
      return new Promise((yes, no) => {
        resolve = yes
        reject = no
      })
    }
    const pending = s.watches.tick()
    await s.watches.tick()
    await s.watches.check(owner, watch.id)
    assert.equal(calls, 1)
    if (action === 'disable') s.watches.enable(owner, watch.id, false)
    if (action === 'remove') s.watches.remove(owner, watch.id)
    if (action === 'erase') s.watches.erase(owner)
    if (action === 'stop') s.watches.stop()
    if (action === 'revision') s.watches.enable(owner, watch.id, true)
    if (action === 'external-delete') {
      s.store.deleteRecord('watches', owner)
      s.watches.refresh(owner)
    }
    if (action === 'reject') {
      s.watches.stop()
      reject(new Error('cancelled'))
    } else resolve({ title: 'Page', text: 'Late content' })
    await pending
    assert.equal(s.watches.get(owner)[0]?.baseline ?? null, null)
  }
})
