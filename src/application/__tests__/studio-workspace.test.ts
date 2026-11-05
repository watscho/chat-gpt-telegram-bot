import { test } from 'node:test'
import assert from 'node:assert/strict'
import { studioSetup, studioFile } from '../../__tests__/studio.js'
void test('workspace snapshots omit credentials, raw attachments and continuations while actions remain owner/revision scoped', async () => {
  const s = studioSetup(),
    done = await s.finish(s.plan()),
    owner = '42:42',
    project = s.ws.create(owner, 'Work')
  s.ws.updateProject(owner, project.id, 'attach', studioFile)
  const task = s.workflow.addTask(owner, '1', 'Review', null),
    item = s.studio.capture(owner, {
      source: '1',
      thread: '1',
      project: null,
      text: 'Inbox',
      documents: [studioFile],
      images: [],
      recording: null
    })
  const snapshot = s.view.snapshot(owner, done.id)
  assert.equal(
    snapshot.detail!.result!.text,
    'Report based on supplied material.'
  )
  assert.ok(!JSON.stringify(snapshot).includes(studioFile.data))
  assert.ok(!JSON.stringify(snapshot).includes('private-token'))
  assert.throws(() => s.view.snapshot('43:43', done.id))
  for (const body of [
    {},
    { action: 1, id: 'a' },
    { action: 'inspect', id: 1 },
    { action: 'inspect', id: 'a'.repeat(121) },
    { action: 'inspect', id: done.id, owner: '43' }
  ])
    assert.throws(() => s.view.action(owner, body))
  assert.equal(
    s.view.action(owner, { action: 'inspect', id: done.id }).detail!.id,
    done.id
  )
  s.view.action(owner, { action: 'project', id: project.id })
  assert.equal(s.ws.thread(owner, '1').project, project.id)
  s.ws.updateProject(owner, project.id, 'attach', studioFile)
  assert.equal(
    s.view.file(owner, 'project:' + project.id, 'project', studioFile.name)
      .data,
    studioFile.data
  )
  assert.throws(() =>
    s.view.file('43:43', 'project:' + project.id, 'project', studioFile.name)
  )
  s.view.action(owner, { action: 'project', id: 'none' })
  const thread = s.profiles.create(owner, 'Other').active
  s.view.action(owner, { action: 'thread', id: '1' })
  assert.equal(s.profiles.get(owner).active, '1')
  s.view.action(owner, { action: 'thread', id: thread })
  s.view.action(owner, { action: 'task', id: task.id, value: 'done' })
  s.view.action(owner, { action: 'task', id: task.id, value: 'open' })
  assert.throws(() =>
    s.view.action(owner, { action: 'task', id: task.id, value: 'bad' })
  )
  for (const value of [1, 'foreign'])
    assert.throws(() =>
      s.view.action(owner, { action: 'inbox-assign', id: item.id, value })
    )
  s.view.action(owner, {
    action: 'inbox-assign',
    id: item.id,
    value: project.id
  })
  s.view.action(owner, { action: 'inbox-assign', id: item.id, value: 'none' })
  assert.throws(() =>
    s.view.action(owner, { action: 'inbox-delete', id: item.id })
  )
  s.view.action(owner, { action: 'inbox-delete', id: item.id, confirm: true })
  const version = s.studio.result(owner, done.id)
  assert.equal(
    s.view.file(owner, done.id, version.id, studioFile.name).data,
    studioFile.data
  )
  assert.throws(() => s.view.file(owner, done.id, version.id, 'missing'))
  let revision = s.studio.mission(owner, done.id).revision
  s.view.action(owner, {
    action: 'edit',
    id: done.id,
    revision,
    value: 'Edited'
  })
  revision = s.studio.mission(owner, done.id).revision
  s.view.action(owner, {
    action: 'restore',
    id: done.id,
    revision,
    value: version.id
  })
  for (const action of ['edit', 'restore'])
    assert.throws(() =>
      s.view.action(owner, {
        action,
        id: done.id,
        revision: s.studio.mission(owner, done.id).revision,
        value: 1
      })
    )
  assert.throws(() =>
    s.view.action(owner, { action: 'edit', id: done.id, value: 'x' })
  )
  assert.throws(() =>
    s.view.action(owner, { action: 'approve', id: done.id, revision })
  )
  const draft = s.plan()
  s.view.action(owner, {
    action: 'start',
    id: draft.id,
    revision: draft.revision
  })
  revision = s.studio.mission(owner, draft.id).revision
  s.view.action(owner, { action: 'pause', id: draft.id, revision })
  revision = s.studio.mission(owner, draft.id).revision
  s.view.action(owner, { action: 'resume', id: draft.id, revision })
  revision = s.studio.mission(owner, draft.id).revision
  s.view.action(owner, { action: 'cancel', id: draft.id, revision })
  s.view.action(owner, {
    action: 'mission-delete',
    id: draft.id,
    confirm: true
  })
})
void test('workspace details expose scoped action arguments and recording names without cloud continuations', async () => {
  const s = studioSetup(),
    mission = s.plan('chain'),
    owner = '42:42'
  s.studio.start(owner, mission.id, 1)
  await s.studio.tick()
  let current = s.studio.mission(owner, mission.id)
  s.studio.editResult(owner, mission.id, current.revision, 'Edited draft')
  current = s.studio.mission(owner, mission.id)
  s.studio.control(owner, mission.id, current.revision, 'resume')
  s.ports.execute = () =>
    Promise.resolve({
      text: 'Review',
      images: [],
      approval: {
        connection: 'mail',
        continuation: 'private-continuation',
        calls: [
          {
            id: 'a1',
            name: 'send',
            arguments: '{"recipient":"draft@example.com"}'
          }
        ]
      }
    })
  await s.studio.tick()
  const view = s.view.snapshot(owner, mission.id)
  assert.equal(view.detail!.steps[1]!.actions[0]!.name, 'send')
  assert.ok(!JSON.stringify(view).includes('private-continuation'))
  s.studio.capture(owner, {
    source: 'recording',
    thread: '1',
    project: null,
    text: '',
    documents: [studioFile],
    images: [],
    recording: {
      file: 'r1',
      name: 'meeting.ogg',
      mime: 'audio/ogg',
      bytes: null,
      seconds: null
    }
  })
  assert.equal(s.view.snapshot(owner).inbox[0]!.recording, 'meeting.ogg')
  const plain = s.plan('autopilot', {
    prompt: 'Simple',
    project: null,
    documents: [studioFile],
    images: [],
    instructions: '',
    memories: []
  })
  s.studio.control(
    owner,
    mission.id,
    s.studio.mission(owner, mission.id).revision,
    'cancel'
  )
  s.ports.execute = () => Promise.resolve({ text: 'Plain result', images: [] })
  const done = await s.finish(plain)
  assert.deepEqual(s.view.snapshot(owner, done.id).detail!.result!.files, [])
  assert.deepEqual(s.view.snapshot(owner, done.id).detail!.documents, [
    studioFile.name
  ])
  const revision = s.studio.revise(owner, done.id, done.revision, 'Recalculate')
  assert.equal(revision.steps.at(-1)!.kind, 'analysis')
})
