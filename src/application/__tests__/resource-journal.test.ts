import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ResourceJournal } from '../resource-journal.js'
import { FakeWorkbench } from '../../__tests__/workbench.js'
import { MemoryStateStore } from '../../__tests__/helpers.js'
void test('resource cleanup persists attempt claims, retains active references and retries only bounded deletion work', async () => {
  let now = 1000
  const provider = new FakeWorkbench(),
    store = new MemoryStateStore(),
    journal = new ResourceJournal(provider, store, () => now)
  assert.equal(journal.durable, true)
  assert.equal(new ResourceJournal(provider).durable, false)
  journal.remember('42:42', { kind: 'file', id: 'input' }, true)
  journal.remember('42:42', { kind: 'file', id: 'input' }, true)
  journal.remember('42:42', { kind: 'container', id: 'container' })
  const before = provider.remove.bind(provider)
  provider.remove = resource => {
    assert.ok(
      store
        .getRecord<{ id: string; attempts: number }[]>(
          'provider-cleanup',
          journal.key('42:42')
        )!
        .find(item => item.id === resource.id)!.attempts > 0
    )
    return before(resource)
  }
  await journal.tick(new Set(['file:input']), new Set([journal.key('42:42')]))
  assert.equal(provider.calls.length, 0)
  await journal.tick(new Set(['file:input']), new Set())
  assert.equal(journal.entries('42:42').length, 1)
  assert.equal(
    await journal.removeNow('42:42', { kind: 'file', id: 'input' }),
    false
  )
  journal.retire('42:42', [{ kind: 'file', id: 'input' }])
  provider.failure = 'remove'
  for (let i = 0; i < 3; i++) {
    await journal.tick(new Set(), new Set())
    now += 60000
  }
  const attempts = provider.calls.length
  await journal.tick(new Set(), new Set())
  assert.equal(provider.calls.length, attempts)
  journal.retire('42:42')
  provider.failure = ''
  await journal.tick(new Set(), new Set())
  assert.equal(journal.entries('42:42').length, 0)
  assert.equal(
    await journal.removeNow('42:42', { kind: 'file', id: 'absent' }),
    true
  )
  journal.remember('42:42', { kind: 'file', id: 'orphan' }, true)
  const restored = new ResourceJournal(provider, store, () => now)
  await restored.tick(new Set(), new Set())
  assert.equal(restored.entries('42:42').length, 0)
})
void test('cleanup handles concurrent acknowledgements, orphan recovery, future calls and persistence failures without forgetting IDs', async () => {
  let now = 1000
  const provider = new FakeWorkbench(),
    store = new MemoryStateStore(),
    journal = new ResourceJournal(provider, store, () => now)
  journal.remember('a', { kind: 'call', id: 'call' }, false, 2000)
  assert.equal(journal.callCount(), 1)
  assert.equal(
    await journal.removeNow('a', { kind: 'call', id: 'call' }),
    false
  )
  journal.recoverCalls()
  assert.equal(journal.entries('a')[0]!.nextAttempt, 0)
  journal.remember('b', { kind: 'file', id: 'file' }, true)
  journal.recoverCalls()
  provider.remove = async () => {
    assert.equal(
      await journal.removeNow('a', { kind: 'call', id: 'call' }),
      false
    )
    journal.remember('a', { kind: 'file', id: 'new' })
  }
  assert.equal(await journal.removeNow('a', { kind: 'call', id: 'call' }), true)
  assert.equal(journal.entries('a')[0]!.id, 'new')
  now = 2000
  const put = store.putRecord.bind(store)
  store.putRecord = () => {
    throw new Error('Disk')
  }
  assert.throws(() => journal.remember('a', { kind: 'file', id: 'bad' }))
  await assert.rejects(journal.removeNow('a', { kind: 'file', id: 'new' }))
  store.putRecord = put
  assert.equal(journal.entries('a')[0]!.attempts, 0)
  const tooMany = Array.from({ length: 2001 }, (_, i) => ({
    kind: 'file' as const,
    id: String(i),
    active: false,
    attempts: 0,
    nextAttempt: 0,
    createdAt: 0
  }))
  store.putRecord('provider-cleanup', journal.key('full'), tooMany)
  const full = new ResourceJournal(provider, store)
  assert.throws(() => full.remember('full', { kind: 'file', id: 'extra' }))
  store.putRecord('provider-cleanup', journal.key('big'), [
    { ...tooMany[0]!, id: 'x'.repeat(1000001) }
  ])
  assert.throws(() => full.retire('big'))
  const local = new ResourceJournal(new FakeWorkbench())
  local.remember('a', { kind: 'file', id: 'local' })
  await local.tick(new Set(), new Set())
  assert.equal(local.entries('a').length, 0)
})
