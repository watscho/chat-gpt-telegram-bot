import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suiteSetup, suiteSource } from '../../__tests__/suite.js'
import { suiteCatalog } from '../../application/suite-workflows.js'
import type { WorkflowId } from '../../domain/suite.js'
const owner = '42:42',
  file = {
    name: 'reference.docx',
    mime: 'application/octet-stream',
    data: 'QQ=='
  },
  record = (kind: 'course' | 'rehearsal' | 'form' | 'decision' = 'form') => ({
    kind,
    title: 'Saved record',
    thread: '1',
    project: null,
    fields: {},
    rows: [{ field: 'email', label: 'Email', value: null }],
    sources: [suiteSource]
  })
void test('Suite command directory and search keep explicit source selection separate from paid workflow plans', async () => {
  const s = suiteSetup(),
    handle = (text: string) => s.suiteCommands.handle(s.ctx, text)
  assert.equal(await handle('hello'), false)
  assert.equal(await handle('/unknown'), false)
  await handle('/suite')
  assert.match(s.messages.at(-1)!, /Pro Suite/)
  await handle('/suite models')
  assert.match(s.messages.at(-1)!, /surcharge/)
  await handle('/suite search report')
  assert.match(s.messages.at(-1)!, /source|note/)
  const hit = s.search.search(owner, 'report')[0]!
  await handle(`/suite select ${hit.id}`)
  await handle('/suite sources')
  assert.match(Buffer.from(s.files.at(-1)!.bytes).toString(), /Meeting notes/)
  await handle('/suite clear')
  assert.equal(s.suite.get(owner).selected.length, 0)
  await handle('/suite search impossible')
  assert.match(s.messages.at(-1)!, /No retained/)
  await handle('/suite records')
  assert.match(s.messages.at(-1)!, /No confirmed/)
  assert.equal(s.model.calls.length, 0)
  await assert.rejects(handle('/suite not-a-workflow | goal'), /Unknown/)
})
void test('all model workflows produce reviewed inert plans with source context, explicit reviewer and video consent', async () => {
  for (const id of Object.keys(suiteCatalog) as WorkflowId[]) {
    const s = suiteSetup()
    s.suite.select(owner, suiteSource)
    s.suite.criterion(owner, null, 'Clarity', 'Use plain language')
    s.ctx.input = prompt =>
      Promise.resolve({
        prompt,
        project: null,
        images: [{ mime: 'image/png', data: 'QQ==' }],
        documents: [file],
        instructions: '',
        memories: []
      })
    s.setVideo({
      file: 'video-id',
      name: 'clip.mp4',
      bytes: 100,
      seconds: 30,
      start: 0,
      audio: false
    })
    const suffix =
      id === 'referee'
        ? ' gpt-6-astra'
        : id === 'brand'
          ? ' default pptx'
          : id === 'video'
            ? ' 2 yes'
            : ''
    await s.suiteCommands.handle(
      s.ctx,
      `/suite ${id}${suffix} | Prepare useful work`
    )
    const mission = s.studio.get(owner).missions[0]!
    assert.equal(mission.state, 'draft')
    assert.match(mission.input.instructions, /Use plain language/)
    assert.equal(s.model.calls.length, 0)
    assert.equal(mission.steps[0]!.workflow?.id, id)
    if (id === 'video') assert.equal(mission.input.video!.audio, true)
  }
  const s = suiteSetup(),
    handle = (text: string) => s.suiteCommands.handle(s.ctx, text)
  await assert.rejects(handle('/suite screen | Goal'), /screenshot/)
  await assert.rejects(handle('/suite quality | Goal'), /criteria/)
  await assert.rejects(handle('/suite decision | Goal'), /source excerpt/)
  await assert.rejects(
    handle('/suite brand default invalid | Goal'),
    /Choose docx/
  )
  for (const command of [
    '/suite video 0 yes | Goal',
    '/suite video -1 yes | Goal',
    '/suite video NaN yes | Goal',
    '/suite video 0 invalid | Goal'
  ]) {
    if (command !== '/suite video 0 yes | Goal')
      s.setVideo({
        file: 'v',
        name: 'v.mp4',
        bytes: null,
        seconds: null,
        start: 0,
        audio: false
      })
    await assert.rejects(handle(command), /Reply to an MP4/)
  }
  s.setQuote('Explicit replied text')
  await handle('/suite decision')
  assert.equal(
    s.studio.get(owner).missions[0]!.input.sources!.at(-1)!.text,
    'Explicit replied text'
  )
  s.setQuote('')
  await handle('/suite brand | Goal')
  assert.equal(
    s.studio.get(owner).missions.at(-1)!.steps[0]!.workflow!.format,
    'docx'
  )
})
void test('record previews require exact confirmations and expose local inspection, correction, exports and reviewed reminder proposals', async () => {
  const s = suiteSetup(),
    handle = (text: string) => s.suiteCommands.handle(s.ctx, text),
    pending = s.suite.stage(
      owner,
      { thread: '1', project: null, sourceRevision: undefined },
      'record',
      { record: record(), existing: null, expectedRevision: null }
    )
  await handle(`/suite confirm ${pending.token} 1`)
  const saved = s.suite.get(owner).records[0]!
  await handle('/suite records')
  assert.match(s.messages.at(-1)!, /revision 1/)
  await handle(`/suite record ${saved.id}`)
  assert.match(s.files.at(-1)!.name, /record-/)
  await handle(`/suite answer ${saved.id} email | user@example.com`)
  assert.equal(
    s.suite.record(owner, saved.id).rows[0]!.value,
    'user@example.com'
  )
  await handle(`/suite export ${saved.id} docx`)
  assert.equal(s.files.at(-1)!.name, 'review.docx')
  await assert.rejects(handle(`/suite export ${saved.id} unknown`))
  let proposed = false
  s.ctx.task = item => {
    proposed = true
    assert.match(item.text, /user@example.com/)
    return Promise.resolve()
  }
  await handle(`/suite remind ${saved.id} 1`)
  assert.ok(proposed)
  await assert.rejects(handle(`/suite remind ${saved.id} 2`))
  await handle(`/suite delete ${saved.id}`)
  assert.throws(() => s.suite.record(owner, saved.id))
})
void test('explicit session listeners accept one form value or propose a new paid feedback plan with retained learning context', async () => {
  for (const kind of ['form', 'course', 'rehearsal'] as const) {
    const s = suiteSetup(),
      saved = s.suite.putRecord(owner, record(kind)),
      handle = (text: string) => s.suiteCommands.handle(s.ctx, text)
    await handle(`/suite session ${saved.id}`)
    assert.match(
      s.messages.at(-1)!,
      kind === 'form' ? /Next field/ : /fresh mission plan/
    )
    await handle('My answer')
    assert.equal(s.suite.listener(owner, '1'), null)
    if (kind === 'form') {
      assert.equal(s.suite.record(owner, saved.id).rows[0]!.value, 'My answer')
      await handle(`/suite session ${saved.id}`)
      assert.match(s.messages.at(-1)!, /No missing/)
      await assert.rejects(handle('Extra answer'), /No missing/)
    } else {
      const mission = s.studio.get(owner).missions[0]!
      assert.equal(mission.steps[0]!.workflow!.record, saved.id)
      assert.match(mission.input.instructions, /Retained session/)
    }
    await handle('/suite stop')
  }
  const s = suiteSetup(),
    decision = s.suite.putRecord(owner, record('decision'))
  await assert.rejects(
    s.suiteCommands.handle(s.ctx, `/suite session ${decision.id}`),
    /course/
  )
  const course = s.suite.putRecord(owner, {
    ...record('course'),
    project: 'other'
  })
  await s.suiteCommands.handle(s.ctx, `/suite session ${course.id}`)
  await assert.rejects(
    s.suiteCommands.handle(s.ctx, 'Answer'),
    /original session/
  )
})
void test('brand templates and quality rules are editable through explicit bounded commands', async () => {
  const s = suiteSetup(),
    handle = (text: string) => s.suiteCommands.handle(s.ctx, text)
  await handle('/suite brand-template')
  await handle(
    '/suite brand-template set company | Company | abcdef | Noto Sans | Review | Summary | Details'
  )
  await handle('/suite brand-template show company')
  assert.match(s.messages.at(-1)!, /ABCDEF/)
  await handle('/suite brand-template remove company')
  await assert.rejects(
    handle('/suite brand-template import company'),
    /Reply to/
  )
  s.setDocument(file)
  await handle('/suite brand-template import company')
  assert.match(s.messages.at(-1)!, /palette/)
  await handle('/suite quality-rule')
  await handle('/suite quality-rule add global | Clarity | Use short sentences')
  const global = s.suite.get(owner).criteria[0]!
  await handle('/suite quality-rule add project | Tone | Be direct')
  await handle(`/suite quality-rule remove ${global.id}`)
  await assert.rejects(handle('/suite brand-template set missing'))
  await assert.rejects(handle('/suite quality-rule add global'))
})
void test('change-watch commands require explicit owned file or public URL and expose controls and retained checks', async () => {
  const s = suiteSetup(),
    handle = (text: string) => s.suiteCommands.handle(s.ctx, text)
  await handle('/suite watch')
  await handle('/suite watch url https://example.com 1 20')
  const watch = s.watches.get(owner)[0]!
  for (const action of ['show', 'check', 'off', 'on'])
    await handle(`/suite watch ${action} ${watch.id}`)
  await handle(`/suite watch remove ${watch.id}`)
  const project = s.ws.create(owner, 'Project')
  s.ws.updateProject(owner, project.id, 'attach', file)
  await handle(`/suite watch file ${project.id} 2 | ${file.name}`)
  await assert.rejects(
    handle('/suite watch file missing 1 | file.txt'),
    /owned/
  )
  await handle('/suite watch')
  assert.match(s.messages.at(-1)!, /reference.docx/)
})
void test('shared-project commands expose targeted invitations, reviewed publication, current access and explicit destructive controls', async () => {
  const s = suiteSetup(),
    handle = (text: string) => s.suiteCommands.handle(s.ctx, text),
    other = { ...s.ctx, owner: '43:43' }
  await handle('/suite team')
  await handle('/suite team create | Team report')
  const team = s.teams.list(owner)[0]!
  await handle(`/suite team show ${team.id}`)
  await handle(`/suite team invite ${team.id} 43 editor`)
  const invitation = s.teams.invitations('43:43')[0]!
  await s.suiteCommands.handle(other, '/suite team invitations')
  await s.suiteCommands.handle(
    other,
    `/suite team accept ${team.id} ${invitation.token}`
  )
  await assert.rejects(handle(`/suite team publish ${team.id}`), /explicit/)
  s.setDocument(file)
  await handle(`/suite team publish ${team.id} | Shared note`)
  const pending = s.suite.get(owner).pending!
  assert.equal(s.teams.inspect(owner, team.id).files.length, 0)
  await handle(`/suite team confirm ${pending.token} ${pending.revision}`)
  let view = s.teams.inspect(owner, team.id)
  await handle(`/suite team file ${team.id} ${view.files[0]!.id}`)
  await handle(`/suite team remove ${team.id} ${view.files[0]!.id}`)
  await handle(`/suite team task ${team.id} 43 | Review report`)
  view = s.teams.inspect(owner, team.id)
  await handle(`/suite team done ${team.id} ${view.tasks[0]!.id}`)
  await assert.rejects(handle(`/suite team done ${team.id} missing`))
  await handle(`/suite team task ${team.id} none | Unassigned task`)
  await handle(`/suite team role ${team.id} 43 reader`)
  await s.suiteCommands.handle(other, `/suite team leave ${team.id}`)
  await handle(`/suite team invite ${team.id} 43 editor`)
  await handle(`/suite team revoke ${team.id} 43`)
  await assert.rejects(handle(`/suite team unknown ${team.id}`))
  await assert.rejects(handle(`/suite team close ${team.id}`))
  await handle(`/suite team close ${team.id} confirm`)
})
void test('ZIP commands preview exact duplicate omission, revise safe names and consume a scoped export confirmation', async () => {
  const s = suiteSetup(),
    handle = (text: string) => s.suiteCommands.handle(s.ctx, text)
  await assert.rejects(handle('/suite zip'), /Reply to/)
  s.setDocument(file)
  await assert.rejects(handle('/suite zip'), /Reply to/)
  s.setDocument({ ...file, name: 'archive.zip' })
  await handle('/suite zip')
  let pending = s.suite.get(owner).pending!
  assert.match(s.messages.at(-1)!, /duplicate of 1/)
  for (const name of ['', '../escape', 'bad/name', '.', '..', 'x'.repeat(161)])
    await assert.rejects(
      handle(
        `/suite zip rename ${pending.token} ${pending.revision} 1 | ${name}`
      ),
      /safe basename/
    )
  await assert.rejects(
    handle(
      `/suite zip rename ${pending.token} ${pending.revision} missing | safe.txt`
    )
  )
  await assert.rejects(
    handle(
      `/suite zip rename ${pending.token} ${pending.revision} 1 | 002-a.txt`
    ),
    /unique/
  )
  await handle(
    `/suite zip rename ${pending.token} ${pending.revision} 1 | reviewed.txt`
  )
  pending = s.suite.get(owner).pending!
  await handle(`/suite zip confirm ${pending.token} ${pending.revision}`)
  assert.equal(s.files.at(-1)!.name, 'organized.zip')
  assert.equal(s.suite.get(owner).pending, null)
  await assert.rejects(handle('/suite zip unknown'))
  const wrong = s.suite.stage(
    owner,
    { thread: '1', project: null, sourceRevision: undefined },
    'share',
    {}
  )
  await assert.rejects(
    handle(`/suite zip confirm ${wrong.token} 1`),
    /ZIP preview/
  )
})
void test('complete recipes retain portable plan instructions and bind fresh sources and variables on every run', async () => {
  const s = suiteSetup(),
    handle = (text: string) => s.suiteCommands.handle(s.ctx, text)
  await handle('/suite recipe')
  const mission = s.plan('brief')
  await handle(`/suite recipe save briefing ${mission.id}`)
  await handle('/suite recipe show briefing')
  await handle('/suite recipe export briefing')
  await handle('/suite recipe run briefing')
  await handle('/suite recipe run briefing | {}')
  assert.equal(s.studio.get(owner).missions.at(-1)!.state, 'draft')
  await assert.rejects(handle('/suite recipe run briefing | invalid'), /JSON/)
  const plain = s.studio.plan(owner, '1', 'autopilot', {
    prompt: 'Hello {{name}}',
    images: [],
    documents: [],
    memories: [],
    instructions: ''
  })
  await handle(`/suite recipe save simple ${plain.id}`)
  await handle('/suite recipe run simple | {"name":"Alex"}')
  const video = s.plan('video')
  video.input.video = {
    file: 'secret-file',
    name: 'v.mp4',
    bytes: null,
    seconds: null,
    start: 0,
    audio: false
  }
  // Re-save this owned plan through the persistence port to exercise the command boundary.
  const state = s.studio.get(owner)
  state.missions.find(item => item.id === video.id)!.input.video =
    video.input.video
  s.store.putRecord('studio', owner, state)
  s.studio.refresh(owner)
  await assert.rejects(
    handle(`/suite recipe save forbidden ${video.id}`),
    /video IDs/
  )
  const bound = s.plan('learn')
  const stored = s.studio.get(owner)
  stored.missions.find(
    item => item.id === bound.id
  )!.steps[0]!.workflow!.record = 'bound-record'
  s.store.putRecord('studio', owner, stored)
  s.studio.refresh(owner)
  await assert.rejects(
    handle(`/suite recipe save bound ${bound.id}`),
    /live record/
  )
  const saved = s.suite.recipe(owner, 'briefing')
  saved.steps[0]!.workflow!.fields = []
  s.suite.saveRecipe(owner, 'invalid', saved.goal, saved.steps)
  await assert.rejects(handle('/suite recipe run invalid'), /nonportable/)
  await handle('/suite recipe remove briefing')
  assert.throws(() => s.suite.recipe(owner, 'briefing'))
})
void test('expired record previews can be reopened locally from retained model results, with duplicate acceptance rejected', async () => {
  const s = suiteSetup(),
    mission = s.plan('learn')
  await assert.rejects(
    s.suiteCommands.handle(s.ctx, `/suite review ${mission.id}`),
    /completed record/
  )
  s.model.answer = { text: JSON.stringify(s.rows('learn')), images: [] }
  s.ports.execute = (owner, mission, step, signal) =>
    s.suiteExecutor.execute(owner, mission, step, signal)
  await s.finish(mission)
  const pending = s.suite.get(owner).pending!
  s.suite.takePending(
    owner,
    { thread: '1', project: null, sourceRevision: undefined },
    pending.token,
    1,
    'record'
  )
  const calls = s.model.calls.length
  await s.suiteCommands.handle(s.ctx, `/suite review ${mission.id}`)
  assert.equal(s.model.calls.length, calls)
  const fresh = s.suite.get(owner).pending!
  await s.suiteCommands.handle(s.ctx, `/suite confirm ${fresh.token} 1`)
  await assert.rejects(
    s.suiteCommands.handle(s.ctx, `/suite review ${mission.id}`),
    /already accepted/
  )
  const brand = s.suite.template(owner, 'default')
  s.suite.saveTemplate(owner, brand)
  await s.suiteCommands.handle(s.ctx, '/suite brand-template')
  s.suite.saveRecipe(owner, 'existing', 'Goal', [
    { kind: 'compose', title: 'Step', prompt: 'Write', connection: null }
  ])
  await s.suiteCommands.handle(s.ctx, '/suite recipe')
  s.setVideo({
    file: 'v',
    name: 'v.mp4',
    bytes: null,
    seconds: null,
    start: 0,
    audio: false
  })
  await s.suiteCommands.handle(s.ctx, '/suite video | Goal')
  await assert.rejects(
    s.suiteCommands.handle(s.ctx, '/suite referee | Goal'),
    /different allowlisted/
  )
})
void test('incomplete optional command arguments reject locally and note-only publication includes no implicit files', async () => {
  const s = suiteSetup(),
    handle = (text: string) => s.suiteCommands.handle(s.ctx, text)
  const saved = s.suite.putRecord(owner, record())
  await handle(`/suite export ${saved.id} docx`)
  const watch = s.watches.add(
    owner,
    '1',
    { kind: 'url', url: 'https://example.com' },
    3600000,
    0
  )
  s.watches.enable(owner, watch.id, false)
  await handle('/suite watch')
  await assert.rejects(handle('/suite watch file project 1'), /owned project/)
  await assert.rejects(handle('/suite team create'))
  const team = s.teams.create(owner, 'Notes')
  await handle(`/suite team publish ${team.id} | Only this note`)
  assert.match(s.messages.at(-1)!, /Files: none/)
  await assert.rejects(handle(`/suite team task ${team.id} none`))
  s.setDocument({ ...file, name: 'archive.zip' })
  await handle('/suite zip')
  const pending = s.suite.get(owner).pending!
  await assert.rejects(
    handle(`/suite zip rename ${pending.token} 1 1`),
    /safe basename/
  )
})
