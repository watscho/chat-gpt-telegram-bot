import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Workbench } from '../workbench.js'
import { WorkbenchModel } from '../workbench-model.js'
import { Workspaces } from '../workspaces.js'
import { config, FakeModel, MemoryStateStore } from '../../__tests__/helpers.js'
import { FakeWorkbench } from '../../__tests__/workbench.js'
import type { Document, ReplyOptions } from '../../domain/conversation.js'
import type { ToolApproval, WorkbenchRequest } from '../../domain/workbench.js'
const file: Document = {
  name: 'sales.csv',
  mime: 'text/csv',
  data: Buffer.from('name,total\nA,12').toString('base64')
}
function setup(durable = true) {
  let now = 1000
  const settings = config(),
    store = new MemoryStateStore(),
    ws = new Workspaces(settings, store),
    provider = new FakeWorkbench()
  const app = new Workbench(
    settings,
    ws,
    provider,
    durable ? store : undefined,
    () => now
  )
  const project = ws.create('42:42', 'Work')
  ws.configure('42:42', '1', { project: project.id })
  const options = (
    kind: WorkbenchRequest['kind'] = 'analysis'
  ): ReplyOptions => ({
    scope: { owner: '42:42', thread: '1', project: project.id },
    workbench:
      kind === 'connection'
        ? { kind, project: project.id, connection: 'mail' }
        : { kind, project: project.id }
  })
  const run = (
    kind: WorkbenchRequest['kind'] = 'analysis',
    files: Document[] = [file]
  ) =>
    app.run(
      [{ role: 'user', content: 'Analyze', documents: files }],
      options(kind)
    )
  return {
    settings,
    store,
    ws,
    provider,
    app,
    project,
    options,
    run,
    clock: (value: number) => {
      now = value
    }
  }
}
void test('provider routing and scoped preflight keep local chat unchanged and reject invalid ownership, inputs and missing setup', async () => {
  const s = setup(),
    model = new FakeModel(),
    routed = new WorkbenchModel(model, s.app)
  assert.equal(
    await routed.reply([{ role: 'user', content: 'Hello' }]),
    'Test answer'
  )
  assert.equal(
    await routed.transcribe(new Uint8Array([1]), undefined, 'Hint'),
    'Voice text'
  )
  assert.equal(
    (
      (await routed.reply(
        [{ role: 'user', content: 'Analyze', documents: [file] }],
        s.options()
      )) as { text: string }
    ).text,
    'Analysis ready.'
  )
  assert.equal(s.app.enabled(), true)
  const missing = new Workbench(s.settings, s.ws)
  assert.equal(missing.enabled(), false)
  assert.throws(() => missing.port())
  await assert.rejects(s.app.run([], {}))
  for (const owner of ['42:43', '42:42:1', '99:99'])
    assert.throws(() =>
      s.app.validate(owner, '1', { kind: 'analysis', project: s.project.id })
    )
  assert.throws(() =>
    setup(false).app.validate('42:42', '1', { kind: 'analysis', project: '1' })
  )
  s.settings.statePath = ':memory:'
  assert.throws(() =>
    s.app.validate('42:42', '1', { kind: 'analysis', project: s.project.id })
  )
  s.settings.statePath = 'state.sqlite'
  assert.throws(() =>
    s.app.validate('42:42', '1', { kind: 'analysis', project: null })
  )
  assert.throws(() =>
    s.app.validate('42:42', '1', {
      kind: 'connection',
      project: s.project.id,
      connection: 'missing'
    })
  )
  for (const files of [
    [],
    Array.from({ length: 11 }, (_, i) => ({ ...file, name: `file${i}.csv` })),
    [{ ...file, name: 'program.exe' }],
    [{ ...file, data: '' }],
    [
      {
        ...file,
        data: Buffer.alloc(s.settings.maxDocumentBytes + 1).toString('base64')
      }
    ]
  ])
    assert.throws(() =>
      s.app.preflight(
        '42:42',
        '1',
        { kind: 'analysis', project: s.project.id },
        files
      )
    )
  s.settings.maxProjectBytes = 1
  assert.throws(() =>
    s.app.preflight('42:42', '1', { kind: 'analysis', project: s.project.id }, [
      file
    ])
  )
  s.settings.maxProjectBytes = 20000000
  assert.throws(() =>
    s.app.preflight('42:42', '1', { kind: 'index', project: s.project.id }, [])
  )
  assert.throws(() =>
    s.app.preflight(
      '42:42',
      '1',
      { kind: 'knowledge', project: s.project.id },
      []
    )
  )
  s.app.preflight('42:42', '1', { kind: 'analysis', project: s.project.id }, [
    file
  ])
  const state = s.ws.get('42:42')
  state.projects = []
  s.ws.save('42:42', state)
  assert.throws(() =>
    s.app.validate('42:42', '1', { kind: 'analysis', project: s.project.id })
  )
  s.ws.configure('42:42', '1', { project: null })
  assert.throws(() =>
    s.app.validate('42:42', '1', { kind: 'index', project: null })
  )
})
void test('analysis tracks temporary uploads, cleans success/failure resources and never retries paid work automatically', async () => {
  const s = setup()
  await s.app.run(
    [
      { role: 'user', content: 'Analyze', documents: [file] },
      { role: 'assistant', content: 'Reference', documents: [file] }
    ],
    s.options()
  )
  assert.equal(
    s.provider.calls.filter(item => item.method === 'upload').length,
    1
  )
  assert.equal(s.app.journal.entries('42:42').length, 0)
  for (const files of [
    [],
    Array.from({ length: 11 }, (_, i) => ({ ...file, name: `file${i}.csv` })),
    [{ ...file, name: 'bad.exe' }]
  ])
    await assert.rejects(s.run('analysis', files))
  s.provider.failure = 'analysis'
  await assert.rejects(s.run())
  assert.equal(s.app.journal.entries('42:42').length, 0)
  s.provider.failure = 'remove'
  s.provider.analysis = () => Promise.reject(new Error('Paid failure'))
  await assert.rejects(s.run())
  assert.equal(s.app.journal.entries('42:42').length, 2)
  s.provider.failure = ''
  s.clock(61001)
  await s.app.tick()
  assert.equal(s.app.journal.entries('42:42').length, 0)
  const failure = setup()
  const put = failure.store.putRecord.bind(failure.store)
  failure.store.putRecord = () => {
    throw new Error('Disk')
  }
  await assert.rejects(failure.run())
  assert.ok(failure.provider.calls.some(item => item.method === 'remove'))
  failure.store.putRecord = put
  const held = setup()
  let release!: (id: string) => void
  held.provider.upload = () =>
    new Promise(resolve => {
      release = resolve
    })
  const active = held.run()
  await assert.rejects(held.run(), /running/)
  await held.app.tick()
  release('held-file')
  await active
})
void test('cloud indexing stores isolated IDs, reports readiness, filters foreign evidence and enforces retention/capacity', async () => {
  const s = setup()
  assert.match(await s.app.status('42:42', s.project.id), /No cloud files/)
  await assert.rejects(s.run('index', []))
  await assert.rejects(s.run('index', [{ ...file, data: '' }]))
  await assert.rejects(
    s.run('index', [
      {
        ...file,
        data: Buffer.alloc(s.settings.maxDocumentBytes + 1).toString('base64')
      }
    ])
  )
  s.provider.status = 'indexing'
  await s.run('index')
  const library = s.app.get('42:42').projects[s.project.id]!,
    id = library.files[0]!.id
  assert.equal(library.files[0]!.bytes, Buffer.from(file.data, 'base64').length)
  const before = s.provider.calls.length
  await s.run('index')
  assert.equal(s.provider.calls.length, before)
  await assert.rejects(s.run('knowledge', []), /No completed/)
  s.provider.status = 'completed'
  assert.match(await s.app.status('42:42', s.project.id), /completed/)
  s.provider.hits = [
    { file: 'foreign', name: 'Secret', text: 'Never expose', score: 1 },
    { file: id, name: 'Sales', text: 'Total 12', score: 0.9 },
    { file: id, name: 'Empty', text: ' ', score: 0.5 }
  ]
  s.app.preflight(
    '42:42',
    '1',
    { kind: 'knowledge', project: s.project.id },
    []
  )
  const answer = await s.run('knowledge', [])
  assert.equal(answer.evidence!.length, 1)
  assert.equal(answer.evidence![0]!.label, 'K1')
  assert.ok(!JSON.stringify(answer).includes('Never expose'))
  s.provider.hits = []
  await assert.rejects(s.run('knowledge', []), /No matching/)
  s.settings.maxProjectBytes = 1
  await assert.rejects(
    s.run('index', [
      { ...file, data: Buffer.from('different').toString('base64') }
    ])
  )
  s.settings.maxProjectBytes = 20000000
  const full = s.app.get('42:42')
  full.projects[s.project.id]!.files = Array.from(
    { length: 20 },
    (_, index) => ({
      ...library.files[0]!,
      id: String(index),
      hash: String(index)
    })
  )
  s.store.putRecord('provider-workbench', '42:42', full)
  s.app.refresh('42:42')
  await assert.rejects(s.run('index', [{ ...file, data: 'ZGlmZmVyZW50' }]))
  s.store.putRecord('provider-workbench', '42:42', {
    ...full,
    projects: { [s.project.id]: library }
  })
  s.app.refresh('42:42')
  s.clock(604801001)
  assert.match(await s.app.status('42:42', s.project.id), /expired/)
  await assert.rejects(s.run('knowledge', []), /No completed/)
  const noLibrary = setup()
  await assert.rejects(noLibrary.run('knowledge', []))
  const failed = setup()
  failed.provider.failure = 'attach'
  await assert.rejects(failed.run('index'))
  assert.equal(
    failed.app.get('42:42').projects[failed.project.id]!.files[0]!.status,
    'failed'
  )
})
void test('cloud removal, ownership-bound approvals and recording previews survive restart without replaying work', async () => {
  const s = setup()
  await s.run('index')
  const id = s.app.get('42:42').projects[s.project.id]!.files[0]!.id
  assert.throws(() => s.app.clear('42:42', 'missing'))
  assert.throws(() => s.app.clear('42:42', s.project.id, 'foreign'))
  s.app.clear('42:42', s.project.id, id)
  assert.match(await s.app.status('42:42', s.project.id), /No cloud files/)
  await s.run('index')
  s.app.clear('42:42', s.project.id)
  await s.app.tick()
  assert.equal(s.app.journal.entries('42:42').length, 0)
  await s.run('index')
  s.ws.deleteProject('42:42', s.project.id)
  await s.app.tick()
  assert.equal(s.app.get('42:42').projects[s.project.id], undefined)
  const approval: ToolApproval = {
    connection: 'mail',
    continuation: 'private snapshot',
    calls: [{ id: 'call', name: 'search', arguments: '{}' }]
  }
  let token = s.app.approval('42:42', '1', 'r', approval)
  for (const [owner, thread, revision, value] of [
    ['43:43', '1', 'r', token],
    ['42:42', '2', 'r', token],
    ['42:42', '1', 'changed', token],
    ['42:42', '1', 'r', 'wrong']
  ])
    assert.throws(() => s.app.takeApproval(owner!, thread!, revision, value!))
  assert.equal(s.app.takeApproval('42:42', '1', 'r', token).connection, 'mail')
  assert.throws(() => s.app.takeApproval('42:42', '1', 'r', token))
  token = s.app.approval('42:42', '1', undefined, approval)
  s.app.deleteThread('42:42', 'other')
  assert.ok(s.app.get('42:42').approval)
  s.app.deleteThread('42:42', '1')
  assert.equal(s.app.get('42:42').approval, null)
  s.app.approval('42:42', '1', undefined, approval)
  s.clock(605401002)
  assert.equal(s.app.get('42:42').approval, null)
  assert.throws(() =>
    s.app.approval('42:42', '1', undefined, {
      ...approval,
      continuation: 'x'.repeat(1000001)
    })
  )
  s.settings.workbench.connections = [
    {
      id: 'mail',
      owner: 42,
      title: 'Mail',
      server: 'https://mcp.example.com',
      tools: ['search'],
      authorization: 'secret'
    }
  ]
  s.ws.configure('42:42', '1', { project: null })
  const result = await s.app.run([{ role: 'user', content: 'Find draft' }], {
    scope: { owner: '42:42', thread: '1', project: null },
    workbench: { kind: 'connection', connection: 'mail', project: null }
  })
  assert.ok(result.approval)
  const recording = {
    file: 'telegram-file',
    name: 'meeting.mp3',
    mime: 'audio/mpeg',
    seconds: 60,
    bytes: 1000
  }
  assert.throws(() =>
    s.app.stageRecording('42:42', '1', undefined, recording, true)
  )
  for (const bad of [
    { ...recording, seconds: s.settings.workbench.meetingSeconds + 1 },
    { ...recording, bytes: s.settings.workbench.meetingBytes + 1 }
  ])
    assert.throws(() =>
      s.app.stageRecording('42:42', '1', undefined, bad, false)
    )
  let record = s.app.stageRecording('42:42', '1', undefined, recording, false)
  for (const [thread, revision, value] of [
    ['2', undefined, record],
    ['1', 'different', record],
    ['1', undefined, 'wrong']
  ])
    assert.throws(() => s.app.takeRecording('42:42', thread!, revision, value!))
  assert.equal(
    s.app.takeRecording('42:42', '1', undefined, record).file.file,
    'telegram-file'
  )
  record = s.app.stageRecording(
    '42:42',
    '1',
    undefined,
    { ...recording, bytes: null, seconds: null },
    false
  )
  s.app.deleteThread('42:42', '1')
  assert.throws(() => s.app.takeRecording('42:42', '1', undefined, record))
  s.app.stageRecording('42:42', '1', undefined, recording, false)
  s.clock(606001003)
  assert.equal(s.app.get('42:42').recording, null)
  s.app.erase('42:42')
  assert.equal(s.store.getRecord('provider-workbench', '42:42'), undefined)
  assert.ok(s.app.journal.entries('42:42').length >= 0)
  const local = new Workbench(s.settings, s.ws, new FakeWorkbench())
  local.erase('42:42')
  await local.tick()
})
void test('provider resource failures preserve cleanup intent and worker isolation across active projects', async t => {
  const s = setup()
  s.settings.maxDocumentBytes = 1
  assert.throws(
    () => s.app.preflight('42:42', '1', s.options().workbench!, [file]),
    /byte limits/
  )
  s.settings.maxDocumentBytes = 20000000
  s.settings.maxProjectBytes = 1
  assert.throws(
    () => s.app.preflight('42:42', '1', s.options().workbench!, [file]),
    /byte limits/
  )
  s.settings.maxProjectBytes = 20000000
  await s.app.run(
    [
      { role: 'user', content: 'Context' },
      { role: 'user', content: 'Analyze', documents: [file] }
    ],
    s.options()
  )
  await s.run('index')
  await s.app.tick()
  assert.equal(s.app.get('42:42').projects[s.project.id]!.files.length, 1)
  const state = s.app.get('42:42')
  state.projects[s.project.id]!.files[0]!.status = 'indexing'
  s.store.putRecord('provider-workbench', '42:42', state)
  s.app.refresh('42:42')
  s.clock(604801001)
  assert.match(await s.app.status('42:42', s.project.id), /expired/)
  const broken = setup()
  t.mock.method(broken.provider, 'remove', () =>
    Promise.reject(new Error('provider'))
  )
  t.mock.method(broken.app.journal, 'remember', () => {
    throw new Error('journal')
  })
  await assert.rejects(broken.run())
  const cleanup = setup()
  t.mock.method(cleanup.app.journal, 'removeNow', () =>
    Promise.reject(new Error('disk'))
  )
  await cleanup.run()
  assert.equal(cleanup.app.journal.entries('42:42').length, 2)
  const busy = setup()
  await busy.run('index')
  busy.provider.analysis = async () => {
    await busy.app.tick()
    return { text: 'done', images: [] }
  }
  await busy.run()
})
