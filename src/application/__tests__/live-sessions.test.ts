import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LiveSessions } from '../live-sessions.js'
import { ResourceJournal } from '../resource-journal.js'
import { Workspaces } from '../workspaces.js'
import { UsageLedger } from '../usage.js'
import { config, MemoryStateStore } from '../../__tests__/helpers.js'
import { FakeWorkbench } from '../../__tests__/workbench.js'
function setup() {
  const settings = config()
  settings.workbench.miniAppURL = 'https://voice.example.com/voice'
  settings.workbench.liveSeconds = 60
  const store = new MemoryStateStore(),
    provider = new FakeWorkbench(),
    ws = new Workspaces(settings, store),
    usage = new UsageLedger(settings, ws, store),
    journal = new ResourceJournal(provider, store),
    live = new LiveSessions(settings, provider, journal, usage, ws)
  return { settings, store, provider, ws, usage, journal, live }
}
void test('live sessions reserve the full configured estimate and stop through a server-owned watchdog without exposing credentials', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const s = setup()
  assert.equal(s.live.status('42:42', '1').enabled, true)
  assert.equal(s.live.status('42:42', '1').project, null)
  const project = s.ws.create('42:42', 'Work')
  s.ws.configure('42:42', '1', { project: project.id, answerLanguage: 'es' })
  assert.equal(s.live.status('42:42', '1').project, 'Work')
  const call = await s.live.open('42:42', '1', 'v=0\r\noffer', 'language')
  assert.equal(s.live.count, 1)
  assert.equal(s.usage.get('42:42').voice, 1)
  assert.equal(
    s.usage.get('42:42').estimatedMicroUsd,
    s.settings.estimateVoice + s.settings.workbench.estimateLiveMinute
  )
  assert.match(JSON.stringify(s.provider.calls), /Answer language: es/)
  assert.ok(!JSON.stringify(call).includes('test-key'))
  await assert.rejects(
    s.live.open('42:42', '1', 'v=0', 'conversation'),
    /already active/
  )
  await assert.rejects(s.live.close('43:43', call.id), /not found/)
  t.mock.timers.tick(60000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(s.live.count, 0)
  await s.live.stop()
  assert.equal(s.live.status('42:42', '1').enabled, false)
})
void test('live validation blocks unknown owners, bad SDP, capacity, ephemeral storage and quota failures before a provider call', async () => {
  const s = setup()
  for (const owner of ['42:43', '42:42:1', '99:99'])
    await assert.rejects(s.live.open(owner, '1', 'v=0', 'conversation'))
  for (const [offer, mode] of [
    ['bad', 'conversation'],
    ['v=0' + 'x'.repeat(100001), 'conversation'],
    ['v=0', 'unknown']
  ])
    await assert.rejects(s.live.open('42:42', '1', offer!, mode!))
  s.settings.statePath = ':memory:'
  await assert.rejects(s.live.open('42:42', '1', 'v=0', 'conversation'))
  assert.equal(s.live.status('42:42', '1').enabled, false)
  s.settings.statePath = 'state.sqlite'
  const missing = new LiveSessions(
    s.settings,
    undefined,
    s.journal,
    s.usage,
    s.ws
  )
  await assert.rejects(missing.open('42:42', '1', 'v=0', 'conversation'))
  assert.equal(missing.status('42:42', '1').enabled, false)
  const transient = new LiveSessions(
    s.settings,
    s.provider,
    new ResourceJournal(s.provider),
    s.usage,
    s.ws
  )
  await assert.rejects(transient.open('42:42', '1', 'v=0', 'conversation'))
  assert.equal(transient.status('42:42', '1').enabled, false)
  s.settings.workbench.miniAppURL = null
  await assert.rejects(s.live.open('42:42', '1', 'v=0', 'conversation'))
  s.settings.workbench.miniAppURL = 'https://voice.example.com'
  s.settings.maxConcurrentRequests = 1
  s.journal.remember(
    '43:43',
    { kind: 'call', id: 'other' },
    false,
    Date.now() + 1000
  )
  await assert.rejects(
    s.live.open('42:42', '1', 'v=0', 'conversation'),
    /capacity/
  )
  s.journal.retire('43:43')
  await s.journal.removeNow('43:43', { kind: 'call', id: 'other' })
  s.ws.limits('42:42', 'budget', 0)
  await assert.rejects(
    s.live.open('42:42', '1', 'v=0', 'conversation'),
    /budget/
  )
  assert.equal(
    s.provider.calls.some(item => item.method === 'live'),
    false
  )
})
void test('live shutdown handles provider ambiguity, restart recovery, storage failure and an opening-call race without paid retries', async () => {
  const s = setup()
  s.provider.failure = 'live'
  await assert.rejects(s.live.open('42:42', '1', 'v=0', 'conversation'))
  assert.equal(s.usage.get('42:42').failed, 1)
  s.provider.failure = ''
  const call = await s.live.open('42:42', '1', 'v=0', 'interview')
  s.provider.failure = 'remove'
  await assert.rejects(s.live.close('42:42', call.id), /cleanup/)
  s.live.recover()
  assert.equal(s.live.count, 1)
  await s.live.stop()
  s.provider.failure = ''
  s.journal.retire('42:42')
  await s.journal.tick(new Set(), new Set())
  s.live.recover()
  assert.equal(s.live.count, 0)
  await assert.rejects(
    s.live.open('42:42', '1', 'v=0', 'conversation'),
    /stopping/
  )
  const disk = setup()
  disk.store.putRecord = (scope, key, value) => {
    if (scope === 'provider-cleanup') throw new Error('Disk')
    MemoryStateStore.prototype.putRecord.call(disk.store, scope, key, value)
  }
  await assert.rejects(disk.live.open('42:42', '1', 'v=0', 'conversation'))
  assert.ok(disk.provider.calls.some(item => item.method === 'remove'))
  const race = setup()
  let finish!: (call: { id: string; sdp: string }) => void
  race.provider.live = () =>
    new Promise(resolve => {
      finish = resolve
    })
  const opening = race.live.open('42:42', '1', 'v=0', 'conversation')
  await assert.rejects(
    race.live.open('42:42', '1', 'v=0', 'conversation'),
    /already/
  )
  await race.live.stop()
  finish({ id: 'late', sdp: 'v=0' })
  await assert.rejects(opening, /stopping/)
  assert.equal(race.journal.callCount(), 0)
  const recovery = setup(),
    running = await recovery.live.open('42:42', '1', 'v=0', 'conversation')
  recovery.journal.retire('42:42')
  await recovery.journal.removeNow('42:42', { kind: 'call', id: running.id })
  recovery.live.recover()
  await recovery.live.stop()
})
void test('live watchdog and shutdown retain uncertain deletion and tolerate cleanup storage failures', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const disk = setup()
  t.mock.method(disk.provider, 'remove', () =>
    Promise.reject(new Error('provider'))
  )
  t.mock.method(disk.journal, 'remember', () => {
    throw new Error('disk')
  })
  await assert.rejects(disk.live.open('42:42', '1', 'v=0', 'conversation'))
  const deadline = setup()
  await deadline.live.open('42:42', '1', 'v=0', 'conversation')
  deadline.provider.failure = 'remove'
  t.mock.timers.tick(60000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(deadline.live.count, 1)
  await deadline.live.stop()
  const stopping = setup()
  await stopping.live.open('42:42', '1', 'v=0', 'conversation')
  t.mock.method(stopping.journal, 'retire', () => {
    throw new Error('disk')
  })
  await stopping.live.stop()
  assert.equal(stopping.live.count, 1)
})
void test('live visual frame claims are bounded per owned active call and source scope changes invalidate actions', async () => {
  const s = setup(),
    call = await s.live.open('42:42', '1', 'v=0', 'conversation')
  assert.deepEqual(s.live.scope('42:42', call.id), {
    thread: '1',
    project: null
  })
  assert.throws(() => s.live.scope('43:43', call.id))
  assert.throws(() => s.live.scope('42:42', 'missing'))
  s.live.frame('42:42', call.id)
  s.live.frame('42:42', call.id)
  s.live.frame('42:42', call.id)
  assert.throws(() => s.live.frame('42:42', call.id), /three/)
  const project = s.ws.create('42:42', 'Changed')
  s.ws.configure('42:42', '1', { project: project.id })
  assert.throws(() => s.live.scope('42:42', call.id))
  await s.live.close('42:42', call.id)
  assert.throws(() => s.live.scope('42:42', call.id))
  await s.live.stop()
})
