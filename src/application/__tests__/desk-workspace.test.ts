import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deskSetup, deskPNG, owner, scope } from '../../__tests__/desk.js'
import { routineSource } from '../../__tests__/routines.js'
import { StudioWorkspace } from '../studio-workspace.js'
void test('signed Desk actions share exact scoped reviews, local version operations and inert paid plans', () => {
  const s = deskSetup(),
    act = (
      action: string,
      id = '',
      value?: unknown,
      revision?: number,
      confirm?: boolean
    ) =>
      s.deskView.action(owner, {
        action: 'desk:' + action,
        id,
        ...(value === undefined
          ? {}
          : {
              value: typeof value === 'string' ? value : JSON.stringify(value)
            }),
        ...(revision === undefined ? {} : { revision }),
        ...(confirm === undefined ? {} : { confirm })
      })
  act('ask', '', { prompt: 'Question', tool: 'chat' })
  act('create', '', { title: 'Draft', language: 'text', text: 'One two three' })
  let doc = s.data.get(owner).documents[0]!
  act('save', doc.id, 'Changed', 1)
  act('restore', doc.id, doc.versions[0]!.id, 2)
  doc = s.data.get(owner).documents[0]!
  assert.ok(
    act('edit', doc.id, { start: 0, end: 3, goal: 'Improve' }, 3).mission
  )
  let p = s.data.editPreview(owner, scope, 'edit', doc.id, 3, 0, 3, 'Better')
  act('cancel', p.token, undefined, 1)
  p = s.data.editPreview(owner, scope, 'edit2', doc.id, 3, 0, 3, 'Better')
  act('confirm', p.token, undefined, 1, true)
  act('assistant-create', '', {
    title: 'Editor',
    instructions: 'Be concise',
    model: null,
    tools: ''
  })
  let assistant = s.data.get(owner).assistants[0]!
  act('assistant-use', assistant.id)
  assert.equal(s.deskView.snapshot(owner).active, assistant.id)
  act('assistant-run', assistant.id, { prompt: 'Work', tool: 'chat' })
  act('assistant-create', '', {
    title: 'Named',
    instructions: 'Help',
    model: 'custom-model',
    tools: 'search'
  })
  assistant = s.data.get(owner).assistants[1]!
  assert.equal(assistant.model, 'custom-model')
  act('table-import', '', {
    title: 'Table',
    json: '{"columns":["A"],"rows":[["1"]]}'
  })
  p = s.data.get(owner).pending!
  act('confirm', p.token, undefined, 1, true)
  const table = s.data.get(owner).tables[0]!
  act('cell', table.id, { row: 0, column: 0, value: '2' }, 1)
  act('cell', table.id, { row: 0, column: 0, value: null }, 2)
  act('table-restore', table.id, table.versions[0]!.id, 3)
  assert.equal(s.data.get(owner).tables[0]!.rows[0]![0], '1')
  const photo = s.data.photoAdd(owner, scope, 'Photo', [deskPNG()]),
    image = s.data.photo(owner, photo, scope).images[0]!
  assert.ok(
    act('photo-edit', photo, {
      image: image.id,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      goal: 'Color'
    }).mission
  )
  act('browser-create', '', {
    title: 'Browser',
    connection: 'mail',
    origins: 'https://example.com',
    tools: 'send'
  })
  const browser = s.data.get(owner).browsers[0]!
  assert.ok(
    act('browser-run', browser.id, {
      url: 'https://example.com/path',
      goal: 'Inspect'
    }).mission
  )
  act('connection-disconnect', 'mail', undefined, undefined, true)
  assert.equal(s.center.list(owner)[0]!.enabled, false)
  act('connection-enable', 'mail')
  s.oauth()
  assert.match(
    act('connection-authorize', 'mail').authorizationURL!,
    /auth.example.com/
  )
  assert.ok(s.deskView.file(owner, 'canvas', doc.id, doc.versions[0]!.id))
  const workspace = new StudioWorkspace(
    s.studio,
    s.profiles,
    s.ws,
    s.workflow,
    s.usage,
    s.jobs,
    undefined,
    undefined,
    s.deskView
  )
  assert.ok(workspace.snapshot(owner).desk)
  assert.ok(
    workspace.action(owner, { action: 'desk:assistant-use', id: 'none' }).desk
  )
  assert.ok(
    workspace.file(
      owner,
      'desk:canvas:' + doc.id,
      doc.versions[0]!.id,
      'ignored'
    )
  )
  assert.throws(() => s.view.action(owner, { action: 'desk:ask', id: '' }))
  assert.throws(() => s.view.file(owner, 'desk:canvas:1', 'version', 'name'))
  act('remove', doc.id, 'documents', undefined, true)
  assert.equal(s.data.get(owner).documents.length, 0)
  assert.equal(s.model.calls.length, 0)
})
void test('Desk action boundary rejects malformed fields, stale revisions, unconfirmed effects and hidden cross-scope material', () => {
  const s = deskSetup(),
    bad = (body: Record<string, unknown>) =>
      assert.throws(() => s.deskView.action(owner, body))
  for (const body of [
    { id: '' },
    { action: 'other', id: '' },
    { action: 'desk:create' },
    { action: 'desk:create', id: 'x'.repeat(121) },
    { action: 'desk:create', id: '', extra: true }
  ])
    bad(body)
  for (const value of [
    undefined,
    {},
    'bad',
    'null',
    '[]',
    'x'.repeat(200001),
    '{}',
    '{"title":3,"language":"text","text":"x"}'
  ])
    bad({ action: 'desk:create', id: '', value })
  for (const body of [
    { action: 'desk:save', id: 'x', revision: '1', value: 'x' },
    { action: 'desk:save', id: 'x', revision: NaN, value: 'x' },
    { action: 'desk:confirm', id: 'x', revision: 1 },
    { action: 'desk:remove', id: 'x', value: 'documents' },
    { action: 'desk:connection-disconnect', id: 'mail' },
    { action: 'desk:unknown', id: '' }
  ])
    bad(body)
  const doc = s.data.create(owner, scope, 'Draft', 'text', 'Text')
  s.data.editPreview(owner, scope, 'edit', doc.id, 1, 0, 1, 'X')
  const project = s.ws.create(owner, 'Other')
  s.ws.configure(owner, '1', { project: project.id })
  assert.equal(s.deskView.snapshot(owner).documents.length, 0)
  assert.equal(s.deskView.snapshot(owner).pending, null)
})
void test('voice proposals stage only local task/search/draft requests, bind a live call and recover task effects without duplicates', () => {
  const s = deskSetup(),
    voice = (kind: string, text = 'Request') =>
      s.actions.voice(
        owner,
        scope,
        'live-call',
        'call-' + kind,
        JSON.stringify({ kind, text })
      )
  let p = voice('task', 'Review proposal')
  assert.equal(s.workflow.get(owner).tasks.length, 0)
  assert.throws(() => s.actions.voiceConfirm(owner, scope, 'other', p.token, 1))
  s.actions.voiceConfirm(owner, scope, 'live-call', p.token, 1)
  assert.equal(s.workflow.get(owner).tasks.length, 1)
  p = s.actions.voice(
    owner,
    scope,
    'live-call',
    'call-recover',
    '{"kind":"task","text":"Recover task"}'
  )
  const original = s.store.putRecord.bind(s.store)
  let fail = true
  s.store.putRecord = (kind, key, value) => {
    if (kind === 'desk' && fail) {
      fail = false
      throw new Error('Interrupted')
    }
    original(kind, key, value)
  }
  assert.throws(() =>
    s.actions.voiceConfirm(owner, scope, 'live-call', p.token, 1)
  )
  s.actions.voiceConfirm(owner, scope, 'live-call', p.token, 1)
  assert.equal(s.workflow.get(owner).tasks.length, 2)
  p = voice('find')
  assert.match(
    s.actions.voiceConfirm(owner, scope, 'live-call', p.token, 1).output,
    /Useful owned/
  )
  s.search.search = () => []
  p = s.actions.voice(
    owner,
    scope,
    'live-call',
    'empty',
    '{"kind":"find","text":"missing"}'
  )
  assert.match(
    s.actions.voiceConfirm(owner, scope, 'live-call', p.token, 1).output,
    /No matching/
  )
  p = voice('draft')
  const draft = s.actions.voiceConfirm(owner, scope, 'live-call', p.token, 1)
  assert.ok(draft.mission)
  assert.equal(s.studio.get(owner).missions[0]!.state, 'draft')
  assert.equal(s.model.calls.length, 0)
  const table = s.data.tablePreview(
    owner,
    scope,
    'table',
    'Table',
    ['A'],
    [['1']],
    'Explicit'
  )
  assert.throws(() =>
    s.actions.voiceConfirm(owner, scope, 'live-call', table.token, 1)
  )
  assert.throws(() =>
    s.actions.confirm(owner, scope, voice('task', 'Another task').token, 1)
  )
  for (const args of [
    'bad',
    'null',
    '[]',
    '{}',
    '{"kind":"send","text":"x"}',
    '{"kind":"task","text":1}',
    '{"kind":"task","text":"x","extra":true}',
    'x'.repeat(6001)
  ])
    assert.throws(() => s.actions.voice(owner, scope, 'live', 'id', args))
  assert.throws(() => s.actions.voice(owner, scope, 'live', 'bad id', '{}'))
  assert.ok(routineSource)
})
void test('Desk import/export boundaries reject unsupported encodings, missing versions and preserve repeated voice draft recovery', () => {
  const s = deskSetup()
  assert.throws(() =>
    s.actions.importTable(owner, scope, 'Bad', {
      name: 'book.xlsx',
      mime: 'application/octet-stream',
      data: 'QQ=='
    })
  )
  assert.throws(() =>
    s.actions.importTable(owner, scope, 'Bad', {
      name: 'table.csv',
      mime: 'text/csv',
      data: Buffer.from([255]).toString('base64')
    })
  )
  const doc = s.data.create(owner, scope, 'Code', 'ts', 'const x=1')
  assert.equal(
    s.actions.file(owner, scope, 'canvas', doc.id, doc.versions[0]!.id).name,
    'Code.ts'
  )
  assert.throws(() => s.actions.file(owner, scope, 'other', doc.id, 'version'))
  const p = s.data.tablePreview(
    owner,
    scope,
    'table',
    'Table',
    ['A'],
    [['1']],
    'Explicit'
  )
  s.actions.confirm(owner, scope, p.token, 1)
  const table = s.data.get(owner).tables[0]!
  assert.throws(() =>
    s.actions.file(owner, scope, 'table', table.id, 'missing')
  )
  const id = s.data.photoAdd(owner, scope, 'Photo', [deskPNG()])
  assert.throws(() => s.actions.file(owner, scope, 'photo', id, 'missing'))
  const voice = s.actions.voice(
      owner,
      scope,
      'live',
      'draft-recover',
      '{"kind":"draft","text":"Write a draft"}'
    ),
    original = s.store.putRecord.bind(s.store)
  let fail = true
  s.store.putRecord = (kind, key, value) => {
    if (kind === 'desk' && fail) {
      fail = false
      throw new Error('Interrupted after draft plan')
    }
    original(kind, key, value)
  }
  assert.throws(() =>
    s.actions.voiceConfirm(owner, scope, 'live', voice.token, 1)
  )
  const recovered = s.actions.voiceConfirm(owner, scope, 'live', voice.token, 1)
  assert.ok(recovered.mission)
  assert.equal(s.studio.get(owner).missions.length, 1)
})
void test('voice draft recovery ignores unrelated missions and rejects an altered source binding before applying an action', () => {
  const s = deskSetup()
  s.plan()
  s.plans.ask(owner, '1', 'Unrelated work', 'chat')
  s.plan()
  const mission = s.studio.get(owner).missions[0]!,
    state = s.studio.get(owner)
  state.missions[0] = {
    ...mission,
    input: {
      ...mission.input,
      sources: [
        {
          id: 'unrelated',
          title: 'Other',
          text: 'Different request',
          thread: '1',
          project: null
        }
      ]
    }
  }
  s.store.putRecord('studio', owner, state)
  s.studio.refresh(owner)
  let p = s.actions.voice(
    owner,
    scope,
    'live',
    'draft-other',
    '{"kind":"draft","text":"Prepare my draft"}'
  )
  assert.ok(s.actions.voiceConfirm(owner, scope, 'live', p.token, 1).mission)
  assert.equal(s.studio.get(owner).missions.length, 4)
  p = s.actions.voice(
    owner,
    scope,
    'live',
    'wrong-base',
    '{"kind":"task","text":"Review"}'
  )
  s.data.update(owner, state => {
    state.pending!.base = 'changed'
  })
  assert.throws(
    () => s.actions.voiceConfirm(owner, scope, 'live', p.token, 1),
    /changed/
  )
})
