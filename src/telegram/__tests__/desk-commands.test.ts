import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deskSetup, deskPNG, owner, scope } from '../../__tests__/desk.js'
import { routineSource } from '../../__tests__/routines.js'
void test('Desk navigation and canvas commands expose usable local editing, selected proposals, versions and scoped exports', async () => {
  const s = deskSetup(),
    run = (text: string) => s.deskCommands.handle(s.ctx, text)
  assert.equal(await run('hello'), false)
  assert.equal(await s.deskCommands.callback(s.ctx, 'other'), false)
  await run('/hub')
  for (const action of ['ask', 'create', 'materials', 'assistants', 'services'])
    await s.deskCommands.callback(s.ctx, 'desk:' + action)
  await assert.rejects(s.deskCommands.callback(s.ctx, 'desk:other'))
  await run('/desk')
  await run('/canvas')
  await run('/canvas add Draft | text | One two three')
  const doc = s.data.get(owner).documents[0]!
  await run('/canvas')
  await run(`/canvas show ${doc.id}`)
  await run(`/canvas save ${doc.id} 1 | Changed`)
  await run(`/canvas restore ${doc.id} 2 ${doc.versions[0]!.id}`)
  await run(`/canvas edit ${doc.id} 3 0 3 | Improve`)
  await run(`/canvas export ${doc.id} ${doc.versions[0]!.id}`)
  s.ctx.quote = () => 'Explicit quote'
  await run('/canvas add Quoted')
  assert.equal(s.data.get(owner).documents[1]!.text, 'Explicit quote')
  let p = s.data.editPreview(owner, scope, 'edit', doc.id, 3, 0, 3, 'Better')
  await run('/desk preview')
  await run(`/desk cancel ${p.token} 1`)
  await assert.rejects(run('/desk preview'))
  p = s.data.editPreview(owner, scope, 'edit2', doc.id, 3, 0, 3, 'Better')
  await run(`/desk confirm ${p.token} 1`)
  await run('/desk export')
  await run(`/canvas remove ${doc.id} confirm`)
  await assert.rejects(run('/canvas other'))
  await assert.rejects(run('/canvas remove missing'))
  assert.ok(s.files.some(file => file.name === 'desk.json'))
  assert.equal(s.model.calls.length, 0)
})
void test('personal assistant commands copy explicit sources, select active profiles and create inert tool-limited missions', async () => {
  const s = deskSetup(),
    run = (text: string) => s.deskCommands.handle(s.ctx, text)
  await run('/assistant')
  await run(
    '/assistant add Editor | Be concise | default | search,analysis,connection:mail'
  )
  await run('/assistant add Named | Help | custom-model | ')
  const id = s.data.get(owner).assistants[0]!.id
  s.suite.select(owner, routineSource)
  await run(`/assistant sources ${id}`)
  await run(`/assistant use ${id}`)
  await s.deskCommands.callback(s.ctx, `desk:use:${id}`)
  await run('/assistant')
  await run(`/assistant show ${id}`)
  await run(`/assistant ask ${id} | Work`)
  await run(`/assistant ask ${id} search | Research`)
  await run(`/assistant remove ${id} confirm`)
  await run('/assistant use none')
  await assert.rejects(run('/assistant other'))
  await assert.rejects(run('/assistant add'))
  assert.ok(s.studio.get(owner).missions.every(item => item.state === 'draft'))
  assert.equal(s.model.calls.length, 0)
})
void test('table and photo commands work from explicit attachments and retain separate acceptance and version exports', async () => {
  const s = deskSetup(),
    run = (text: string) => s.deskCommands.handle(s.ctx, text)
  await run('/sheet')
  await assert.rejects(run('/sheet import Table'))
  s.ctx.document = () =>
    Promise.resolve({
      name: 'table.csv',
      mime: 'text/csv',
      data: Buffer.from('A,B\nOne,1').toString('base64')
    })
  await run('/sheet import Table')
  let p = s.data.get(owner).pending!
  await run(`/desk confirm ${p.token} 1`)
  const table = s.data.get(owner).tables[0]!
  await run(`/sheet show ${table.id}`)
  await run(`/sheet cell ${table.id} 1 1 2 | 2`)
  await run(`/sheet restore ${table.id} 2 ${table.versions[0]!.id}`)
  await run(`/sheet export ${table.id} ${table.versions[0]!.id}`)
  s.ctx.materials = async () => ({
    images: [],
    documents: [(await s.ctx.document())!]
  })
  await run('/sheet analyze Workbook')
  const analysis = s.studio.get(owner).missions[0]!
  await assert.rejects(run(`/sheet from ${analysis.id} table.csv`))
  await run(`/sheet remove ${table.id} confirm`)
  await assert.rejects(run('/sheet other'))
  s.ctx.materials = () =>
    Promise.resolve({ images: [deskPNG()], documents: [] })
  await run('/photos')
  await run('/photos add Images')
  const photo = s.data.get(owner).photos[0]!,
    image = photo.images[0]!
  await run(`/photos show ${photo.id}`)
  await run(`/photos edit ${photo.id} ${image.id} 0 0 1 1 | Change color`)
  await run(`/photos export ${photo.id} ${image.id}`)
  p = s.data.photoPreview(owner, scope, 'photo', photo.id, [deskPNG()])
  await run(`/desk confirm ${p.token} 1`)
  await run(`/photos remove ${photo.id} confirm`)
  await assert.rejects(run('/photos other'))
  assert.equal(s.model.calls.length, 0)
})
void test('browser and connection commands expose configured permissions and require explicit disconnection', async () => {
  const s = deskSetup(),
    run = (text: string) => s.deskCommands.handle(s.ctx, text)
  await run('/browser')
  await assert.rejects(run('/browser add'))
  await run('/browser add Browser | mail | https://example.com | send')
  const id = s.data.get(owner).browsers[0]!.id
  await run('/browser')
  await run(`/browser run ${id} https://example.com/path | Inspect`)
  await run(`/browser remove ${id} confirm`)
  await assert.rejects(run('/browser other'))
  await run('/services')
  await run('/services disconnect mail confirm')
  await run('/services')
  await run('/services enable mail')
  s.oauth()
  await run('/services authorize mail')
  assert.match(s.messages.at(-1)!, /auth.example.com/)
  await assert.rejects(run('/services disconnect mail'))
  await assert.rejects(run('/services other'))
})
void test('local Desk mission reviews reopen retained model output without another paid request', async () => {
  const s = deskSetup(),
    run = (text: string) => s.deskCommands.handle(s.ctx, text),
    doc = s.data.create(owner, scope, 'Draft', 'text', 'One two'),
    mission = s.plans.edit(owner, '1', doc.id, 1, 0, 3, 'Improve')
  await assert.rejects(run(`/desk review ${mission.id}`))
  mission.state = 'done'
  mission.steps[0]!.state = 'done'
  mission.steps[0]!.output = { text: '[{"replacement":"Better"}]', images: [] }
  const state = s.studio.get(owner)
  state.missions[0] = mission
  s.store.putRecord('studio', owner, state)
  s.studio.refresh(owner)
  await run(`/desk review ${mission.id}`)
  assert.ok(s.files.some(file => file.name === 'desk-review.json'))
  assert.equal(s.model.calls.length, 0)
})
void test('table imports from retained analysis enforce source scope and selected filenames before proposing local acceptance', async () => {
  const s = deskSetup(),
    run = (text: string) => s.deskCommands.handle(s.ctx, text),
    mission = s.plans.ask(owner, '1', 'Analyze', 'chat'),
    state = s.studio.get(owner)
  mission.state = 'done'
  mission.versions = [
    {
      id: 'version',
      parent: null,
      label: 'Output',
      createdAt: s.now(),
      reply: {
        text: 'Analysis',
        images: [],
        files: [
          {
            name: 'table.csv',
            mime: 'text/csv',
            data: Buffer.from('A\n1').toString('base64')
          }
        ]
      }
    }
  ]
  mission.selected = 'version'
  state.missions[0] = mission
  s.store.putRecord('studio', owner, state)
  s.studio.refresh(owner)
  await run(`/sheet from ${mission.id} table.csv | Table`)
  let p = s.data.get(owner).pending!
  await run(`/desk cancel ${p.token} 1`)
  await run(`/sheet from ${mission.id} table.csv`)
  p = s.data.get(owner).pending!
  await run(`/desk confirm ${p.token} 1`)
  await assert.rejects(run(`/sheet from ${mission.id} missing.csv`))
  const project = s.ws.create(owner, 'Other')
  s.ws.configure(owner, '1', { project: project.id })
  await assert.rejects(run(`/sheet from ${mission.id} table.csv`), /scope/)
  s.ws.configure(owner, '1', { project: null })
  delete mission.versions[0]!.reply.files
  state.missions[0] = mission
  s.store.putRecord('studio', owner, state)
  s.studio.refresh(owner)
  await assert.rejects(run(`/sheet from ${mission.id} table.csv`))
})
void test('reopened local Desk review can display a text-only adapter result without inventing files', async t => {
  const s = deskSetup(),
    doc = s.data.create(owner, scope, 'Draft', 'text', 'Text'),
    mission = s.plans.edit(owner, '1', doc.id, 1, 0, 1, 'Improve')
  mission.state = 'done'
  const state = s.studio.get(owner)
  state.missions[0] = mission
  s.store.putRecord('studio', owner, state)
  s.studio.refresh(owner)
  t.mock.method(s.deskExecutor, 'execute', () =>
    Promise.resolve({ text: 'Local reviewed result', images: [] })
  )
  await s.deskCommands.handle(s.ctx, `/desk review ${mission.id}`)
  assert.equal(s.messages.at(-1), 'Local reviewed result')
})
