import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deskSetup, deskPNG, owner, scope } from '../../__tests__/desk.js'
import { routineSource } from '../../__tests__/routines.js'
import type { MissionStep } from '../../domain/studio.js'
void test('Desk plans remain inert, freeze explicit source scope/model and reject unsupported tools and stale materials before charging', async () => {
  const s = deskSetup(),
    doc = s.data.create(owner, scope, 'Draft', 'text', 'One two three'),
    mission = s.plans.edit(owner, '1', doc.id, 1, 4, 7, 'Make clearer')
  assert.equal(mission.state, 'draft')
  assert.equal(s.model.calls.length, 0)
  assert.equal(s.data.get(owner).pending, null)
  assert.match(mission.input.instructions, /"two"/)
  const assistant = s.data.assistant(
    owner,
    'Editor',
    'Be concise',
    'custom-model',
    ['search', 'analysis', 'connection:mail']
  )
  s.data.assistantSources(owner, assistant, [routineSource])
  for (const tool of ['chat', 'search', 'analysis', 'connection:mail']) {
    const plan = s.plans.assistant(owner, '1', assistant, 'Prepare work', tool)
    assert.equal(plan.steps[0]!.desk!.model, 'custom-model')
    assert.equal(plan.input.sources![0]!.id, routineSource.id)
  }
  await assert.rejects(
    s.deskExecutor.execute(
      owner,
      mission,
      mission.steps[0]!,
      AbortSignal.abort()
    )
  )
  assert.throws(() => s.plans.assistant(owner, '1', assistant, 'Work', 'other'))
  assert.throws(() =>
    s.plans.assistant(owner, '1', assistant, 'Work', 'images')
  )
  const browser = s.data.browser(
    owner,
    'Browser',
    'mail',
    ['https://example.com'],
    ['send']
  )
  const browse = s.plans.browser(
    owner,
    '1',
    browser,
    'https://example.com/path',
    'Inspect page'
  )
  assert.equal(browse.steps[0]!.kind, 'connection')
  for (const url of [
    'bad',
    'https://other.example.com',
    'https://u:p@example.com',
    'https://example.com/#fragment'
  ])
    assert.throws(() => s.plans.browser(owner, '1', browser, url, 'Work'))
  assert.throws(() =>
    s.plans.browser(owner, '1', 'missing', 'https://example.com', 'Work')
  )
  assert.throws(() =>
    s.plans.table(owner, '1', 'Table', { images: [], documents: [] })
  )
  const table = s.plans.table(owner, '1', 'Table', {
    images: [],
    documents: [
      { name: 'book.xlsx', mime: 'application/octet-stream', data: 'QQ==' }
    ]
  })
  assert.equal(table.steps[0]!.kind, 'analysis')
  const project = s.data.photoAdd(owner, scope, 'Photos', [deskPNG()]),
    image = s.data.photo(owner, project, scope).images[0]!
  const photo = s.plans.photo(
    owner,
    '1',
    project,
    image.id,
    { x: 0, y: 0, width: 1, height: 1 },
    'Change color'
  )
  assert.equal(
    photo.steps[0]!.estimate,
    s.settings.estimateChat + s.settings.estimateImage
  )
  assert.throws(() =>
    s.plans.photo(
      owner,
      '1',
      project,
      'missing',
      { x: 0, y: 0, width: 1, height: 1 },
      'Work'
    )
  )
  s.plans.ask(owner, '1', 'Question', 'chat')
  s.plans.ask(owner, '1', 'Research', 'search')
  assert.throws(() => s.plans.ask(owner, '1', 'Work', 'other'))
})
void test('Desk executor separates selected-edit generation from exact local acceptance and catches stale revisions', async () => {
  const s = deskSetup(),
    doc = s.data.create(owner, scope, 'Draft', 'text', 'One two three'),
    mission = s.plans.edit(owner, '1', doc.id, 1, 4, 7, 'Improve'),
    compose = mission.steps[0]!,
    local = mission.steps[1]!,
    signal = new AbortController().signal
  const result = await s.deskExecutor.execute(owner, mission, compose, signal)
  assert.ok(result.text)
  assert.deepEqual(s.model.options.at(-1)!.structured!.fields, ['replacement'])
  await assert.rejects(
    s.deskExecutor.execute(owner, mission, local, signal),
    /Complete/
  )
  compose.state = 'done'
  compose.output = {
    text: JSON.stringify([{ replacement: 'better' }]),
    images: []
  }
  const review = await s.deskExecutor.execute(owner, mission, local, signal)
  assert.equal(review.files![0]!.name, 'desk-review.json')
  assert.equal(s.data.document(owner, doc.id, scope).text, 'One two three')
  compose.output.artifact = {
    rows: 1,
    name: 'result.json',
    mime: 'application/json',
    data: Buffer.from(JSON.stringify([{ replacement: 'clearer' }])).toString(
      'base64'
    )
  }
  await s.deskExecutor.execute(owner, mission, local, signal)
  for (const rows of [
    [{ replacement: null }],
    [{ replacement: 'A' }, { replacement: 'B' }]
  ]) {
    compose.output = { text: JSON.stringify(rows), images: [] }
    await assert.rejects(s.deskExecutor.execute(owner, mission, local, signal))
  }
  s.data.write(owner, scope, doc.id, 1, 'Changed')
  await assert.rejects(
    s.deskExecutor.execute(owner, mission, compose, signal),
    /changed/
  )
  const fake = {
    ...local,
    desk: { ...local.desk!, kind: 'bad' }
  } as unknown as MissionStep
  await assert.rejects(s.deskExecutor.execute(owner, mission, fake, signal))
  fake.desk = { ...local.desk!, phase: 'bad' } as unknown as NonNullable<
    MissionStep['desk']
  >
  await assert.rejects(s.deskExecutor.execute(owner, mission, fake, signal))
  const plain = { ...compose }
  delete plain.desk
  assert.match(
    (await s.deskExecutor.execute(owner, mission, plain, signal)).text,
    /Delegated Suite/
  )
})
void test('Desk model adapters carry assistant tools, browser policy and image mask while local table/photo stages only create proposals', async () => {
  const s = deskSetup(),
    signal = new AbortController().signal,
    assistant = s.data.assistant(owner, 'Editor', 'Be concise', null, [
      'connection:mail'
    ])
  const chat = s.plans.assistant(owner, '1', assistant, 'Work')
  await s.deskExecutor.execute(owner, chat, chat.steps[0]!, signal)
  assert.match(s.model.options.at(-1)!.references!, /\[\]/)
  delete chat.input.sources
  await s.deskExecutor.execute(owner, chat, chat.steps[0]!, signal)
  s.data.assistantSources(owner, assistant, [routineSource])
  await assert.rejects(
    s.deskExecutor.execute(owner, chat, chat.steps[0]!, signal),
    /permissions/
  )
  const project = s.data.photoAdd(owner, scope, 'Photos', [deskPNG()]),
    image = s.data.photo(owner, project, scope).images[0]!,
    photo = s.plans.photo(
      owner,
      '1',
      project,
      image.id,
      { x: 0, y: 0, width: 1, height: 1 },
      'Color'
    )
  s.model.answer = { text: 'Edited image', images: [deskPNG()] }
  await s.deskExecutor.execute(owner, photo, photo.steps[0]!, signal)
  assert.equal(s.model.options.at(-1)!.imageMask!.mime, 'image/png')
  assert.equal(s.model.options.at(-1)!.action, 'edit')
  photo.steps[0]!.state = 'done'
  photo.steps[0]!.output = { text: 'Edited', images: [deskPNG()] }
  await s.deskExecutor.execute(owner, photo, photo.steps[1]!, signal)
  assert.equal(s.data.photo(owner, project, scope).images.length, 1)
  s.data.update(owner, state => {
    state.photos[0]!.revision++
  })
  await assert.rejects(
    s.deskExecutor.execute(owner, photo, photo.steps[0]!, signal),
    /source changed/
  )
  await assert.rejects(
    s.deskExecutor.execute(owner, photo, photo.steps[1]!, signal),
    /source changed/
  )
  const table = s.plans.table(owner, '1', 'Table', {
    images: [],
    documents: [
      { name: 'book.xlsx', mime: 'application/octet-stream', data: 'QQ==' }
    ]
  })
  table.steps[0]!.state = 'done'
  table.steps[0]!.output = { text: 'Analysis', images: [] }
  await assert.rejects(
    s.deskExecutor.execute(owner, table, table.steps[1]!, signal),
    /CSV/
  )
  table.steps[0]!.output.files = [
    {
      name: 'table.csv',
      mime: 'text/csv',
      data: Buffer.from('Item,Value\nA,1').toString('base64')
    }
  ]
  await s.deskExecutor.execute(owner, table, table.steps[1]!, signal)
  assert.equal(s.data.get(owner).tables.length, 0)
  const browser = s.data.browser(
      owner,
      'Browser',
      'mail',
      ['https://example.com'],
      ['send']
    ),
    mission = s.plans.browser(
      owner,
      '1',
      browser,
      'https://example.com/',
      'Inspect'
    )
  await s.deskExecutor.execute(owner, mission, mission.steps[0]!, signal)
  s.data.remove(owner, scope, 'browsers', browser)
  await assert.rejects(
    s.deskExecutor.execute(owner, mission, mission.steps[0]!, signal),
    /recipe/
  )
  const invalid = structuredClone(table.steps[1]!)
  invalid.kind = 'compose'
  await assert.rejects(
    s.deskExecutor.execute(owner, table, invalid, signal),
    /local/
  )
  invalid.kind = 'local'
  invalid.desk!.phase = 'model'
  await assert.rejects(
    s.deskExecutor.execute(owner, table, invalid, signal),
    /Table extraction/
  )
  invalid.desk!.kind = 'assistant'
  invalid.desk!.phase = 'apply'
  const changed = { ...table, steps: [table.steps[0]!, invalid] }
  await assert.rejects(
    s.deskExecutor.execute(owner, changed, invalid, signal),
    /no local/
  )
})
