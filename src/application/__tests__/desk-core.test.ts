import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deskSetup, deskPNG, owner, scope } from '../../__tests__/desk.js'
import { Desk, deskHash, photoRegion, tableData } from '../desk.js'
import { routineSource } from '../../__tests__/routines.js'
void test('Canvas selected edits preserve surroundings, reject stale scopes and retain recoverable manual/model versions', () => {
  const s = deskSetup(),
    doc = s.data.create(owner, scope, 'Draft', 'text', 'One two three')
  assert.equal(s.data.get('43:43').documents.length, 0)
  let p = s.data.editPreview(owner, scope, 'edit', doc.id, 1, 4, 7, 'better')
  assert.equal((JSON.parse(p.value) as { before: string }).before, 'two')
  s.actions.confirm(owner, scope, p.token, 1)
  assert.equal(s.data.document(owner, doc.id, scope).text, 'One better three')
  assert.throws(() => s.actions.confirm(owner, scope, p.token, 1))
  assert.throws(() => s.data.document(owner, doc.id, { ...scope, thread: '2' }))
  assert.throws(() =>
    s.data.document(owner, doc.id, { ...scope, project: '2' })
  )
  assert.throws(() => s.data.document(owner, 'missing', scope))
  const second = s.data.write(owner, scope, doc.id, 2, 'Manual')
  s.data.restore(owner, scope, doc.id, 3, second.versions[0]!.id)
  assert.equal(s.data.document(owner, doc.id, scope).text, 'One two three')
  assert.throws(() => s.data.write(owner, scope, doc.id, 1, 'old'))
  assert.throws(() => s.data.restore(owner, scope, doc.id, 4, 'missing'))
  for (const [revision, start, end] of [
    [0, 0, 1],
    [4, NaN, 1],
    [4, 0, NaN],
    [4, -1, 1],
    [4, 1, 1],
    [4, 0, 999]
  ])
    assert.throws(() =>
      s.data.selection(owner, scope, doc.id, revision!, start!, end!)
    )
  for (const replacement of ['', 'x'.repeat(60001)])
    assert.throws(() =>
      s.data.editPreview(owner, scope, 'bad', doc.id, 4, 0, 1, replacement)
    )
  p = s.data.editPreview(owner, scope, 'next', doc.id, 4, 0, 1, 'X')
  s.data.write(owner, scope, doc.id, 4, 'Changed')
  assert.throws(() => s.actions.confirm(owner, scope, p.token, 1), /Source/)
  p = s.data.editPreview(owner, scope, 'expire', doc.id, 5, 0, 1, 'X')
  s.time(s.now() + 600001)
  assert.equal(s.data.get(owner).pending, null)
  assert.throws(() => s.data.review(owner, scope, p.token, 1))
  assert.throws(() =>
    s.data.create(owner, scope, 'Bad', 'bad language', 'Text')
  )
  assert.throws(() => s.data.create(owner, scope, 'Bad', 'text', ''))
})
void test('assistant permissions and copied source knowledge remain explicit and owner isolated', () => {
  const s = deskSetup(),
    id = s.data.assistant(owner, 'Editor', 'Use plain language', null, [
      'search',
      'analysis',
      'connection:mail'
    ])
  s.data.assistantSources(owner, id, [routineSource])
  assert.equal(s.data.assistantItem(owner, id).revision, 2)
  s.data.use(owner, '1', id)
  assert.equal(s.data.get(owner).active['1'], id)
  s.data.use(owner, '1', 'none')
  assert.equal(s.data.get(owner).active['1'], undefined)
  assert.throws(() => s.data.assistantItem('43:43', id))
  assert.throws(() =>
    s.data.assistant(owner, 'Bad', 'Instruction', 'bad model', [])
  )
  assert.throws(() =>
    s.data.assistant(owner, 'Bad', 'Instruction', null, ['other'])
  )
  assert.throws(() =>
    s.data.assistant(owner, 'Bad', 'Instruction', null, ['search', 'search'])
  )
  assert.throws(() =>
    s.data.assistantSources(
      owner,
      id,
      Array.from({ length: 21 }, () => routineSource)
    )
  )
  assert.throws(() =>
    s.data.assistantSources(owner, id, [{ ...routineSource, text: '' }])
  )
  s.data.use(owner, '1', id)
  s.data.remove(owner, scope, 'assistants', id)
  assert.equal(s.data.get(owner).active['1'], undefined)
})
void test('tables preserve text/null values, source provenance, strict cell revisions, versions and spreadsheet-safe exports', () => {
  const s = deskSetup(),
    p = s.data.tablePreview(
      owner,
      scope,
      'table',
      'Totals',
      ['Item', 'Value'],
      [
        ['A', '2'],
        ['B', null]
      ],
      'Explicit file'
    )
  s.actions.confirm(owner, scope, p.token, 1)
  let table = s.data.get(owner).tables[0]!
  s.data.cell(owner, scope, table.id, 1, 0, 1, '3')
  s.data.tableRestore(owner, scope, table.id, 2, table.versions[0]!.id)
  table = s.data.table(owner, table.id, scope)
  assert.equal(table.rows[0]![1], '2')
  const file = s.actions.file(
    owner,
    scope,
    'table',
    table.id,
    table.versions[0]!.id
  )
  assert.match(Buffer.from(file.data, 'base64').toString(), /Item/)
  for (const [rev, row, col, value] of [
    [0, 0, 0, 'x'],
    [3, NaN, 0, 'x'],
    [3, 0, NaN, 'x'],
    [3, -1, 0, 'x'],
    [3, 999, 0, 'x'],
    [3, 0, -1, 'x'],
    [3, 0, 999, 'x'],
    [3, 0, 0, 'x'.repeat(2001)]
  ] as const)
    assert.throws(() =>
      s.data.cell(owner, scope, table.id, rev, row, col, value)
    )
  s.data.cell(owner, scope, table.id, 3, 1, 1, null)
  assert.throws(() => s.data.tableRestore(owner, scope, table.id, 1, 'missing'))
  assert.throws(() => s.data.table(owner, 'missing', scope))
  for (const [columns, rows] of [
    [[], []],
    [['A', 'A'], []],
    [[''], []],
    [['A'], [['x', 'y']]],
    [['A'], [[1]]]
  ] as unknown as [string[], (string | null)[][]][])
    assert.throws(() => tableData(columns, rows))
})
void test('photo projects retain originals and append accepted variants only after an exact scoped review', () => {
  const s = deskSetup(),
    id = s.data.photoAdd(owner, scope, 'Project', [deskPNG()]),
    original = s.data.photo(owner, id, scope),
    p = s.data.photoPreview(owner, scope, 'photo', id, [deskPNG()])
  assert.equal(s.data.photo(owner, id, scope).images.length, 1)
  s.actions.confirm(owner, scope, p.token, 1)
  assert.equal(s.data.photo(owner, id, scope).images.length, 2)
  assert.equal(
    s.actions.file(owner, scope, 'photo', id, original.images[0]!.id).mime,
    'image/png'
  )
  assert.throws(() => s.data.photo(owner, 'missing', scope))
  assert.throws(() => s.data.photoAdd(owner, scope, 'Empty', []))
  assert.throws(() =>
    s.data.photoAdd(
      owner,
      scope,
      'Many',
      Array.from({ length: 9 }, () => deskPNG())
    )
  )
  assert.throws(() =>
    s.data.photoAdd(owner, scope, 'Empty data', [
      { mime: 'image/png', data: '' }
    ])
  )
  assert.throws(() => s.data.photoPreview(owner, scope, 'none', id, []))
  assert.throws(() =>
    s.data.photoPreview(
      owner,
      scope,
      'many',
      id,
      Array.from({ length: 5 }, () => deskPNG())
    )
  )
  s.settings.maxImageBytes = 1
  assert.throws(() => s.data.photoAdd(owner, scope, 'Big', [deskPNG()]))
  assert.throws(() => s.data.photoPreview(owner, scope, 'big', id, [deskPNG()]))
  s.settings.maxImageBytes = 10000000
  s.data.update(owner, state => {
    state.photos[0]!.images = Array.from({ length: 20 }, (_, i) => ({
      ...original.images[0]!,
      id: String(i)
    }))
  })
  const full = s.data.photoPreview(owner, scope, 'full', id, [deskPNG()])
  assert.throws(() => s.actions.confirm(owner, scope, full.token, 1), /20/)
  for (const rectangle of [
    { x: -1, y: 0, width: 1, height: 1 },
    { x: 0, y: -1, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: 1, height: 0 },
    { x: 2, y: 0, width: 1, height: 1 },
    { x: 0, y: 2, width: 1, height: 1 },
    { x: NaN, y: 0, width: 1, height: 1 }
  ])
    assert.throws(() => photoRegion(rectangle, 2, 2))
})
void test('Desk persistence bounds, duplicate acceptance, scoped cancellation and deletion are atomic', () => {
  const s = deskSetup(),
    local = new Desk(s.settings, undefined, s.now)
  local.create(owner, scope, 'Local', 'text', 'Text')
  assert.equal(local.get(owner).documents.length, 1)
  local.erase(owner)
  for (const [field, size] of [
    ['documents', 31],
    ['assistants', 21],
    ['tables', 21],
    ['photos', 11],
    ['browsers', 11]
  ] as const)
    assert.throws(() =>
      s.data.update(owner, state => {
        state[field].length = size
      })
    )
  s.settings.maxProjectBytes = 1
  assert.throws(() => s.data.create(owner, scope, 'Big', 'text', 'Text'))
  s.settings.maxProjectBytes = 20000000
  let p = s.data.preview(owner, scope, 'voice', 'duplicate', 'base', {})
  s.data.update(owner, state => {
    state.accepted.push('duplicate')
  })
  assert.throws(() => s.data.accept(owner, scope, p.token, 1, 'base', () => {}))
  assert.throws(() =>
    s.data.preview(owner, scope, 'voice', 'duplicate', 'base', {})
  )
  p = s.data.preview(owner, scope, 'voice', 'cancel', 'base', {})
  assert.throws(() => s.data.review(owner, scope, p.token, 2))
  assert.throws(() =>
    s.data.accept(owner, scope, p.token, 1, 'changed', () => {})
  )
  s.data.cancel(owner, scope, p.token, 1)
  s.data.preview(owner, scope, 'voice', 'thread', 'base', {})
  s.data.deleteThread(owner, '2')
  assert.ok(s.data.get(owner).pending)
  s.data.deleteThread(owner, '1')
  assert.equal(s.data.get(owner).pending, null)
  assert.throws(() => s.data.remove(owner, scope, 'bad', 'id'))
  assert.throws(() => s.data.remove(owner, scope, 'documents', 'missing'))
  const doc = s.data.create(owner, scope, 'Draft', 'text', 'Text')
  assert.equal(
    s.actions.file(owner, scope, 'canvas', doc.id, doc.versions[0]!.id).name,
    'Draft.txt'
  )
  assert.throws(() => s.actions.file(owner, scope, 'canvas', doc.id, 'missing'))
  s.data.remove(owner, scope, 'documents', doc.id)
  s.data.erase(owner)
  assert.equal(s.data.get(owner).documents.length, 0)
  assert.equal(typeof deskHash({ a: 1 }), 'string')
})
void test('explicit source deletion prunes scoped material and copied assistant knowledge while reset preserves retained documents', () => {
  const s = deskSetup(),
    project = s.ws.create(owner, 'Work'),
    otherScope = { ...scope, project: project.id },
    doc = s.data.create(owner, scope, 'Retained', 'text', 'Text'),
    assistant = s.data.assistant(owner, 'Editor', 'Help', null, [])
  s.data.assistantSources(owner, assistant, [
    routineSource,
    { ...routineSource, id: 'project-source', thread: '2', project: project.id }
  ])
  s.data.use(owner, '1', assistant)
  s.data.deleteThread(owner, '1')
  assert.equal(s.data.document(owner, doc.id, scope).text, 'Text')
  const p = s.data.tablePreview(
    owner,
    otherScope,
    'table',
    'Table',
    ['A'],
    [['1']],
    'Explicit'
  )
  s.actions.confirm(owner, otherScope, p.token, 1)
  s.data.photoAdd(owner, otherScope, 'Photo', [deskPNG()])
  s.data.preview(owner, otherScope, 'voice', 'pending', 'base', {})
  s.data.deleteMaterialScope(owner, 'project', project.id)
  assert.equal(s.data.get(owner).tables.length, 0)
  assert.equal(s.data.get(owner).photos.length, 0)
  assert.equal(s.data.get(owner).pending, null)
  assert.equal(s.data.assistantItem(owner, assistant).sources.length, 1)
  s.data.use(owner, '1', assistant)
  s.data.preview(owner, scope, 'voice', 'thread', 'base', {})
  s.data.deleteMaterialScope(owner, 'thread', '1')
  assert.equal(s.data.get(owner).documents.length, 0)
  assert.equal(s.data.assistantItem(owner, assistant).sources.length, 0)
  assert.equal(s.data.get(owner).active['1'], undefined)
  s.data.deleteMaterialScope(owner, 'project', 'missing')
})
