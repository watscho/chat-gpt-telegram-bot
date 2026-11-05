import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Studio } from '../studio.js'
import type { StudioState } from '../../domain/studio.js'
import { UserError } from '../../domain/conversation.js'
import { studioSetup, studioInput, studioFile } from '../../__tests__/studio.js'
import { compareResults, replacePassage } from '../studio-results.js'
const owner = '42:42'
void test('Inbox is private, bounded, idempotent by source and separate from paid processing', () => {
  const s = studioSetup(),
    value = {
      source: '1',
      thread: '1',
      project: null,
      text: 'Keep this',
      documents: [],
      images: [],
      recording: null
    }
  assert.equal(s.studio.collecting(owner, '1'), false)
  s.studio.collecting(owner, '1', true)
  assert.equal(s.studio.collecting(owner, '1'), true)
  s.studio.collecting(owner, '1', false)
  const item = s.studio.capture(owner, value)
  assert.equal(s.studio.capture(owner, value).id, item.id)
  assert.throws(() => s.studio.item('43:43', item.id))
  s.studio.assign(owner, item.id, 'p1')
  assert.equal(s.studio.item(owner, item.id).project, 'p1')
  assert.throws(() => s.studio.assign(owner, 'bad', null))
  for (const [kind, patch] of [
    ['link', { text: 'https://example.com' }],
    ['files', { documents: [studioFile] }],
    ['files', { images: [{ data: 'YQ==', mime: 'image/png' as const }] }],
    [
      'recording',
      {
        recording: {
          file: 'a',
          name: 'r.ogg',
          mime: 'audio/ogg',
          bytes: null,
          seconds: null
        }
      }
    ]
  ] as const)
    assert.equal(
      s.studio.capture(owner, {
        ...value,
        ...patch,
        documents: 'documents' in patch ? [...patch.documents] : [],
        images: 'images' in patch ? [...patch.images] : [],
        source: kind + JSON.stringify(patch)
      }).kind,
      kind
    )
  assert.throws(() =>
    s.studio.capture(owner, { ...value, source: 'empty', text: '' })
  )
  assert.throws(() =>
    s.studio.capture(owner, {
      ...value,
      source: 'long',
      text: 'a'.repeat(8001)
    })
  )
  s.studio.removeItem(owner, item.id)
  assert.throws(() => s.studio.removeItem(owner, item.id))
  s.studio.refresh(owner)
  assert.equal(s.studio.get(owner).inbox.length, 4)
  for (let i = 4; i < 100; i++)
    s.studio.capture(owner, { ...value, source: String(i + 10) })
  assert.throws(() => s.studio.capture(owner, { ...value, source: 'overflow' }))
  s.settings.maxJobBytes = 1
  assert.throws(() => s.studio.collecting(owner, '1', true), /storage/)
  const local = new Studio(s.settings, s.ports)
  assert.equal(local.get('a').missions.length, 0)
  s.settings.maxJobBytes = 20000000
  local.collecting('a', '1', true)
  local.refresh('a')
  assert.equal(local.collecting('a', '1'), false)
  local.recover()
  local.erase('a')
})
void test('mission recipes freeze reviewed inputs, isolate public research and validate persistent capacity before work', () => {
  const s = studioSetup(),
    input = { ...studioInput(), documents: [studioFile] }
  const mission = s.plan('autopilot', input)
  assert.equal(mission.steps[0]!.kind, 'analysis')
  assert.deepEqual(mission.input.memories, [])
  input.prompt = 'changed'
  assert.notEqual(s.studio.mission(owner, mission.id).input.prompt, 'changed')
  assert.equal(s.plan().steps[0]!.kind, 'compose')
  assert.equal(
    s.plan('autopilot', {
      ...studioInput(),
      documents: [{ ...studioFile, name: 'd.docx' }]
    }).steps[0]!.kind,
    'compose'
  )
  const research = s.plan('research', {
    ...studioInput(),
    documents: [studioFile],
    images: [{ data: 'YQ==', mime: 'image/png' }]
  })
  assert.deepEqual(research.input.documents, [])
  assert.deepEqual(research.input.images, [])
  assert.equal(research.input.instructions, '')
  assert.deepEqual(
    research.steps.map(step => step.kind),
    ['search', 'search', 'compose']
  )
  const chain = s.plan('chain')
  assert.equal(chain.steps[1]!.connection, 'mail')
  assert.ok(s.studio.estimate(chain) > 0)
  for (const steps of [
    [],
    Array.from({ length: 5 }, () => ({ connection: 'mail', prompt: 'Send' })),
    [{ connection: 'foreign', prompt: 'Send' }],
    [{ connection: 'mail', prompt: '' }],
    [{ connection: 'mail', prompt: 'a'.repeat(2001) }]
  ])
    assert.throws(() =>
      s.studio.plan(owner, '1', 'chain', studioInput(), steps)
    )
  for (const patch of [
    { prompt: '' },
    { prompt: 'x'.repeat(8001) },
    { documents: Array(11).fill(studioFile) },
    { images: Array(11).fill({ data: 'YQ==', mime: 'image/png' }) },
    { documents: [{ ...studioFile, data: '' }] },
    { images: [{ data: '', mime: 'image/png' as const }] }
  ])
    assert.throws(() => s.plan('autopilot', { ...studioInput(), ...patch }))
  s.settings.maxDocumentBytes = 1
  assert.throws(() =>
    s.plan('autopilot', { ...studioInput(), documents: [studioFile] })
  )
  s.settings.maxDocumentBytes = 20000000
  s.settings.maxImageBytes = 1
  assert.throws(() =>
    s.plan('autopilot', {
      ...studioInput(),
      images: [{ data: 'YWJj', mime: 'image/png' }]
    })
  )
  while (s.studio.get(owner).missions.length < 20) s.plan()
  assert.throws(() => s.plan(), /limit reached/)
  s.settings.statePath = ':memory:'
  assert.throws(() => s.plan(), /persistent/)
  s.settings.statePath = 'state.sqlite'
  assert.throws(() =>
    new Studio(s.settings, s.ports).plan(owner, '1', 'autopilot', studioInput())
  )
})
void test('plan approval, local edits and controls reject stale, expired, repeated and cross-owner requests', () => {
  const s = studioSetup(),
    mission = s.plan()
  assert.throws(() => s.studio.start('43:43', mission.id, 1))
  assert.throws(() => s.studio.start(owner, mission.id, 2))
  assert.throws(() => s.studio.editPlan(owner, mission.id, 1, 99, 'x'))
  assert.throws(() => s.studio.editPlan(owner, mission.id, 1, 0, ''))
  assert.throws(() =>
    s.studio.editPlan(owner, mission.id, 1, 0, 'x'.repeat(2001))
  )
  let changed = s.studio.editPlan(owner, mission.id, 1, 0, 'Inspect carefully')
  assert.equal(changed.steps[0]!.prompt, 'Inspect carefully')
  s.clock(601001)
  assert.throws(
    () => s.studio.start(owner, mission.id, changed.revision),
    /expired/
  )
  s.clock(1000)
  changed = s.studio.start(owner, mission.id, changed.revision)
  assert.throws(() => s.studio.start(owner, mission.id, changed.revision))
  assert.throws(() =>
    s.studio.editPlan(owner, mission.id, changed.revision, 0, 'changed')
  )
  assert.throws(() =>
    s.studio.control(owner, mission.id, changed.revision, 'resume')
  )
  assert.throws(() =>
    s.studio.control(owner, mission.id, changed.revision, 'retry')
  )
  changed = s.studio.control(owner, mission.id, changed.revision, 'pause')
  assert.throws(() =>
    s.studio.control(owner, mission.id, changed.revision, 'pause')
  )
  changed = s.studio.control(owner, mission.id, changed.revision, 'resume')
  changed = s.studio.control(owner, mission.id, changed.revision, 'cancel')
  assert.throws(() =>
    s.studio.control(owner, mission.id, changed.revision, 'cancel')
  )
  s.studio.remove(owner, mission.id)
  assert.throws(() => s.studio.mission(owner, mission.id))
})
void test('durable steps claim before effects, resume completed checkpoints and claim notices once', async () => {
  const s = studioSetup(),
    mission = s.plan()
  let allowed = false,
    available = false
  s.ports.allowed = () => allowed
  s.ports.available = () => available
  s.studio.start(owner, mission.id, 1)
  await s.studio.tick()
  allowed = true
  await s.studio.tick()
  available = true
  s.ports.execute = async () => {
    assert.equal(
      s.store.getRecord<StudioState>('studio', owner)!.missions[0]!.state,
      'running'
    )
    await s.studio.tick()
    return { text: 'Result', images: [] }
  }
  await s.studio.tick()
  assert.equal(s.studio.mission(owner, mission.id).steps[0]!.state, 'done')
  const restored = new Studio(s.settings, s.ports, s.store)
  restored.recover()
  await restored.tick()
  await restored.tick()
  assert.equal(restored.mission(owner, mission.id).state, 'done')
  s.ports.notify = () => Promise.reject(new Error('transport'))
  await restored.tick()
  await restored.tick()
  assert.equal(
    restored.mission(owner, mission.id).noticeRevision,
    restored.mission(owner, mission.id).revision
  )
  restored.stop()
  new Studio(s.settings, s.ports).recover()
  await new Studio(s.settings, s.ports).tick()
})
void test('uncertain paid outcomes require explicit retry and a fresh plan; cancellation never commits a late result', async () => {
  for (const failure of [
    new UserError('Quota unavailable'),
    new Error('private-secret')
  ]) {
    const s = studioSetup(),
      mission = s.plan()
    s.ports.execute = () => Promise.reject(failure)
    s.studio.start(owner, mission.id, 1)
    await s.studio.tick()
    let current = s.studio.mission(owner, mission.id)
    assert.equal(current.state, 'uncertain')
    assert.ok(!current.steps[0]!.receipt!.text.includes('private-secret'))
    await s.studio.tick()
    current = s.studio.mission(owner, mission.id)
    const draft = s.studio.control(owner, mission.id, current.revision, 'retry')
    assert.equal(draft.state, 'draft')
  }
  const s = studioSetup(),
    mission = s.plan()
  let finish!: (value: { text: string; images: [] }) => void
  s.ports.execute = () =>
    new Promise(resolve => {
      finish = resolve
    })
  s.studio.start(owner, mission.id, 1)
  const pending = s.studio.tick()
  await new Promise(resolve => setImmediate(resolve))
  let current = s.studio.mission(owner, mission.id)
  assert.throws(() => s.studio.remove(owner, mission.id))
  assert.throws(() =>
    s.studio.control(owner, mission.id, current.revision, 'pause')
  )
  s.studio.control(owner, mission.id, current.revision, 'cancel')
  const cancelled = new Studio(s.settings, s.ports, s.store)
  cancelled.recover()
  assert.equal(cancelled.mission(owner, mission.id).state, 'cancelled')
  finish({ text: 'Late', images: [] })
  await pending
  assert.equal(s.studio.mission(owner, mission.id).versions.length, 0)
  const interrupted = studioSetup(),
    m = interrupted.plan()
  let done!: (value: { text: string; images: [] }) => void
  interrupted.ports.execute = () =>
    new Promise(resolve => {
      done = resolve
    })
  interrupted.studio.start(owner, m.id, 1)
  const work = interrupted.studio.tick()
  await new Promise(resolve => setImmediate(resolve))
  const restored = new Studio(
    interrupted.settings,
    interrupted.ports,
    interrupted.store
  )
  restored.recover()
  assert.equal(restored.mission(owner, m.id).state, 'uncertain')
  done({ text: 'Lost acknowledgement', images: [] })
  await work
  current = interrupted.studio.mission(owner, m.id)
  assert.equal(current.state, 'queued')
})
void test('MCP proposals require exact expiring approvals and preserve reviewed action receipts across continuations', async () => {
  const s = studioSetup(),
    mission = s.plan('chain')
  s.studio.start(owner, mission.id, 1)
  await s.studio.tick()
  {
    const current = s.studio.mission('42:42', mission.id)
    s.studio.control('42:42', mission.id, current.revision, 'resume')
  }
  s.ports.execute = () =>
    Promise.resolve({
      text: 'Review actions',
      images: [],
      approval: {
        connection: 'mail',
        continuation: 'captured',
        calls: [
          { id: 'a1', name: 'send', arguments: '{"to":"review@example.com"}' }
        ]
      }
    })
  await s.studio.tick()
  let current = s.studio.mission(owner, mission.id),
    approval = current.steps[1]!.approval!
  assert.equal(current.state, 'review')
  assert.throws(() =>
    s.studio.approve(owner, mission.id, current.revision, 'wrong', true)
  )
  s.clock(601001)
  assert.throws(() =>
    s.studio.approve(owner, mission.id, current.revision, approval.token, true)
  )
  const draft = s.studio.control(owner, mission.id, current.revision, 'retry')
  s.clock(1000)
  s.studio.start(owner, mission.id, draft.revision)
  await s.studio.tick()
  current = s.studio.mission(owner, mission.id)
  approval = current.steps[1]!.approval!
  const approved = s.studio.approve(
    owner,
    mission.id,
    current.revision,
    approval.token,
    true
  )
  assert.equal(approved.steps[1]!.continuation, 'captured')
  assert.match(approved.steps[1]!.events[0]!.text, /review@example.com/)
  assert.throws(() =>
    s.studio.approve(owner, mission.id, current.revision, approval.token, true)
  )
  s.ports.execute = (_owner, _mission, step) => {
    assert.equal(step.continuation, 'captured')
    return Promise.resolve({ text: 'Service reported completion.', images: [] })
  }
  await s.studio.tick()
  assert.equal(s.studio.mission(owner, mission.id).state, 'done')
  assert.throws(() =>
    s.studio.control(
      owner,
      mission.id,
      s.studio.mission(owner, mission.id).revision,
      'cancel'
    )
  )
  const rejected = studioSetup(),
    m = rejected.plan('chain')
  rejected.studio.start(owner, m.id, 1)
  await rejected.studio.tick()
  {
    const current = rejected.studio.mission('42:42', m.id)
    rejected.studio.control('42:42', m.id, current.revision, 'resume')
  }
  rejected.ports.execute = () =>
    Promise.resolve({ text: 'Review', images: [], approval: approval.value })
  await rejected.studio.tick()
  let r = rejected.studio.mission(owner, m.id)
  rejected.studio.approve(
    owner,
    m.id,
    r.revision,
    r.steps[1]!.approval!.token,
    false
  )
  assert.equal(rejected.studio.mission(owner, m.id).state, 'cancelled')
  assert.throws(() =>
    s.studio.approve(
      owner,
      mission.id,
      s.studio.mission(owner, mission.id).revision,
      'none',
      true
    )
  )
  const state = rejected.studio.get(owner)
  state.missions[0]!.state = 'review'
  state.missions[0]!.steps[1]!.state = 'review'
  state.missions[0]!.steps[1]!.approval = {
    token: 'review',
    expiresAt: 999999,
    value: approval.value
  }
  state.missions[0]!.steps[1]!.events = Array.from({ length: 20 }, () => ({
    at: 0,
    state: 'approved',
    text: 'Receipt'
  }))
  rejected.store.putRecord('studio', owner, state)
  rejected.studio.refresh(owner)
  r = rejected.studio.mission(owner, m.id)
  assert.throws(
    () => rejected.studio.approve(owner, m.id, r.revision, 'review', true),
    /event limit/
  )
})
void test('text versions have stable parentage, exact passage edits, bounded comparisons and explicit paid revisions', async () => {
  const s = studioSetup(),
    done = await s.finish(s.plan()),
    original = s.studio.result(owner, done.id)
  assert.throws(() => s.studio.result(owner, done.id, 'missing'))
  let edited = s.studio.editResult(
    owner,
    done.id,
    done.revision,
    'New report\nWith evidence'
  )
  assert.equal(s.studio.result(owner, done.id).parent, original.id)
  assert.equal(
    replacePassage('one\ntwo', 'two', '$& revised'),
    'one\n$& revised'
  )
  for (const passage of ['', 'missing', 'a'])
    assert.throws(() => replacePassage('a a', passage, 'x'))
  assert.equal(compareResults('same', 'same'), 'No text changes.')
  assert.match(
    compareResults('first\nold\nlast', 'first\nnew\nlast'),
    /- old\n\+ new/
  )
  assert.match(compareResults('a', 'a\nb'), /\+ b/)
  assert.match(compareResults('a\nb', 'a'), /- b/)
  edited = s.studio.restore(owner, done.id, edited.revision, original.id)
  assert.equal(s.studio.result(owner, done.id).id, original.id)
  for (const instructions of ['', 'x'.repeat(2001)])
    assert.throws(() =>
      s.studio.revise(owner, done.id, edited.revision, instructions)
    )
  const revised = s.studio.revise(
    owner,
    done.id,
    edited.revision,
    'Improve the conclusion'
  )
  assert.equal(revised.state, 'draft')
  assert.throws(() =>
    s.studio.editResult(owner, done.id, revised.revision, 'Not while queued')
  )
  assert.throws(() =>
    s.studio.restore(owner, done.id, revised.revision, original.id)
  )
  await s.finish(revised)
  let current = s.studio.mission(owner, done.id)
  assert.equal(current.versions.length, 2 + 1)
  for (const text of ['', 'x'.repeat(60001)])
    assert.throws(() =>
      s.studio.editResult(owner, done.id, current.revision, text)
    )
  while (current.versions.length < 10)
    current = s.studio.editResult(
      owner,
      done.id,
      current.revision,
      'Retained revision'
    )
  assert.throws(() =>
    s.studio.editResult(owner, done.id, current.revision, 'Overflow')
  )
  assert.throws(() => s.studio.revise(owner, done.id, current.revision, 'More'))
  const state = s.studio.get(owner)
  state.missions[0]!.versions = state.missions[0]!.versions.slice(0, 1)
  state.missions[0]!.steps = Array.from(
    { length: 10 },
    () => state.missions[0]!.steps[0]!
  )
  s.store.putRecord('studio', owner, state)
  s.studio.refresh(owner)
  assert.throws(() => s.studio.revise(owner, done.id, current.revision, 'More'))
})
void test('thread deletion and erasure invalidate pending intent, abort active work and never restore removed owner data', async () => {
  const s = studioSetup(),
    done = await s.finish(s.plan()),
    draft = s.plan()
  s.studio.collecting(owner, '1', true)
  s.studio.deleteThread(owner, 'other')
  s.studio.deleteThread(owner, '1')
  assert.equal(s.studio.mission(owner, done.id).state, 'done')
  assert.equal(s.studio.mission(owner, draft.id).state, 'cancelled')
  assert.equal(s.studio.collecting(owner, '1'), false)
  const next = s.plan()
  let finish!: (value: { text: string; images: [] }) => void
  s.ports.execute = (_owner, _mission, _step, signal) =>
    new Promise(resolve => {
      finish = resolve
      signal.addEventListener('abort', () => {}, { once: true })
    })
  s.studio.start(owner, next.id, 1)
  const pending = s.studio.tick()
  await new Promise(resolve => setImmediate(resolve))
  s.studio.stop()
  s.studio.erase('43:43')
  s.studio.erase(owner)
  finish({ text: 'Late', images: [] })
  await pending
  assert.equal(s.studio.get(owner).missions.length, 0)
})
void test('checkpoint write failures never dispatch an unclaimed step or automatically repeat an uncertain paid response', async t => {
  const s = studioSetup(),
    mission = s.plan(),
    put = s.store.putRecord.bind(s.store)
  let failure = 'claim'
  t.mock.method(
    s.store,
    'putRecord',
    (scope: string, key: string, value: unknown) => {
      const state = value as StudioState
      if (
        scope === 'studio' &&
        failure === 'claim' &&
        state.missions[0]!.state === 'running'
      ) {
        failure = ''
        throw new Error('Disk before claim')
      }
      if (
        scope === 'studio' &&
        failure === 'result' &&
        state.missions[0]!.steps[0]!.state === 'done'
      ) {
        failure = ''
        throw new Error('Disk after provider response')
      }
      put(scope, key, value)
    }
  )
  s.studio.start(owner, mission.id, 1)
  await s.studio.tick()
  assert.equal(s.calls.length, 0)
  failure = 'result'
  await s.studio.tick()
  assert.equal(s.calls.length, 1)
  assert.equal(s.studio.mission(owner, mission.id).state, 'uncertain')
  await s.studio.tick()
  assert.equal(s.calls.length, 1)
})
