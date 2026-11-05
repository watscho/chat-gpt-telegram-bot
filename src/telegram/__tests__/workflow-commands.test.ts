import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WorkflowCommands, type WorkflowContext } from '../workflow-commands.js'
import { Workflow } from '../../application/workflow.js'
import { Jobs } from '../../application/jobs.js'
import { Workspaces } from '../../application/workspaces.js'
import { Conversations } from '../../application/conversations.js'
import { ArchiveImport } from '../../application/archive.js'
import { config, FakeModel, MemoryStateStore } from '../../__tests__/helpers.js'
import type { Keyboard } from '../productivity-commands.js'
import type { Document } from '../../domain/conversation.js'
function setup(durable = true) {
  const settings = { ...config(), confirmExpensiveRequests: true },
    store = new MemoryStateStore(),
    flow = new Workflow(store),
    ws = new Workspaces(settings, store),
    chat = new Conversations(new FakeModel(), settings),
    messages: string[] = [],
    keyboards: Keyboard[] = [],
    files: string[] = []
  const jobs = new Jobs(
    settings,
    {
      allowed: () => true,
      available: () => true,
      input: () => {
        throw new Error('unused')
      },
      execute: () => Promise.resolve({ text: 'Result', images: [] }),
      deliver: () => Promise.resolve()
    },
    store
  )
  let document: Document | undefined,
    quoted = 'Quoted bot response\nFollow up',
    references: Document[] = [],
    imported = 0
  const ctx: WorkflowContext = {
    owner: 'a',
    thread: '1',
    text: (value, keyboard) => {
      messages.push(value)
      if (keyboard) keyboards.push(keyboard)
      return Promise.resolve()
    },
    file: (_data, name) => {
      files.push(name)
      return Promise.resolve()
    },
    document: () => Promise.resolve(document),
    quote: () => quoted,
    input: prompt => ({
      prompt,
      documents: references,
      images: [],
      memories: [],
      instructions: ''
    }),
    imported: () => {
      imported++
    }
  }
  const service = new WorkflowCommands(
    flow,
    jobs,
    ws,
    chat,
    settings,
    durable ? new ArchiveImport(settings, store) : undefined
  )
  return {
    settings,
    store,
    flow,
    ws,
    chat,
    jobs,
    ctx,
    service,
    messages,
    keyboards,
    files,
    handle: (value: string) => service.handle(ctx, value),
    callback: (value: string) => service.callback(ctx, value),
    approval: () => flow.get('a').approval!,
    document: (value?: Document) => {
      document = value
    },
    references: (value: Document[]) => {
      references = value
    },
    quote: (value: string) => {
      quoted = value
    },
    imported: () => imported
  }
}
const file = { name: 'a.txt', mime: 'text/plain', data: 'YQ==' }
void test('guide and task controls explain navigation, deadlines, status and explicit completion', async () => {
  const s = setup()
  assert.equal(await s.handle('text'), false)
  assert.equal(await s.handle('/unknown'), false)
  assert.equal(await s.callback('unknown:x'), false)
  await s.handle('/guide')
  await s.handle('/guide unknown')
  await s.callback('guide:tasks')
  await s.handle('/tasks')
  assert.match(s.messages.at(-1)!, /No tasks/)
  for (const value of [
    '/task',
    '/task bad',
    '/task due id',
    '/task done',
    '/recap bad'
  ])
    await assert.rejects(s.handle(value))
  await s.handle('/task add Review draft')
  const task = s.flow.get('a').tasks[0]!
  await s.handle(`/task done ${task.id}`)
  await s.handle('/tasks all')
  await s.handle(`/task open ${task.id}`)
  await s.handle(`/task due ${task.id} | 2099-01-01 09:00`)
  await s.handle('/tasks')
  assert.match(s.messages.at(-1)!, /2099/)
  await s.callback(`task:done:${task.id}`)
  await assert.rejects(s.callback(`task:wrong:${task.id}`))
  await s.handle(`/task due ${task.id} | none`)
  await s.handle(`/task delete ${task.id}`)
  await s.handle('/task add Future | 2099-01-02 09:00')
  await s.handle('/task fromreply')
  const state = s.flow.get('a')
  state.tasks[0]!.attempts = 3
  s.flow.save('a', state)
  await s.handle('/tasks')
  assert.match(s.messages.join('\n'), /delivery exhausted/)
  s.flow.delivered('a', state.tasks[0]!.id)
  await s.handle('/tasks')
  assert.match(s.messages.at(-1)!, /Delivery: sent/)
  await s.handle('/recap')
  await s.handle('/recap clear')
})
void test('project dictionary applies scoped edits and provides useful validation errors', async () => {
  const s = setup()
  await assert.rejects(s.handle('/glossary list'))
  const project = s.ws.create('a', 'Project')
  s.ws.configure('a', '1', { project: project.id })
  await s.handle('/glossary')
  await s.handle('/glossary list')
  await assert.rejects(s.handle('/glossary set term'))
  await assert.rejects(s.handle('/glossary bad'))
  await s.handle('/glossary set Brand | Preferred spelling')
  await s.handle('/glossary list')
  assert.match(s.messages.at(-1)!, /Preferred/)
  await s.handle('/glossary remove Brand')
})
void test('background and batch work require single-use cost approvals before atomic enqueue and expose results', async () => {
  const s = setup()
  for (const value of [
    '/batch',
    '/batch bad',
    '/batch summarize',
    '/job',
    '/job compare prompt',
    '/batch status missing',
    '/batch export missing'
  ])
    await assert.rejects(s.handle(value))
  await s.handle('/job research Find sources')
  let approval = s.approval()
  assert.equal(s.jobs.get('a').jobs.length, 0)
  assert.ok(approval.estimate > 0)
  await s.callback(`work:${approval.token}:cancel`)
  assert.equal(s.jobs.get('a').jobs.length, 0)
  await s.handle('/job A question')
  approval = s.approval()
  await s.callback(`work:${approval.token}:confirm`)
  assert.equal(s.jobs.get('a').jobs.length, 1)
  await assert.rejects(s.callback(`work:${approval.token}:confirm`))
  await s.handle('/job summary Summarize')
  approval = s.approval()
  await assert.rejects(s.callback(`work:${approval.token}:bad`))
  s.references([file, { ...file, name: 'b.txt' }])
  await s.handle('/job compare Compare')
  approval = s.approval()
  await s.callback(`work:${approval.token}:confirm`)
  for (const action of ['summarize', 'extract', 'table']) {
    await s.handle(`/batch ${action} fields`)
    approval = s.approval()
    await s.callback(`work:${approval.token}:confirm`)
  }
  const group = s.jobs.get('a').jobs.find(job => job.batch)!.batch!.group
  await s.handle(`/batch status ${group}`)
  await s.handle(`/batch export ${group}`)
  assert.equal(s.files.length, 1)
  await s.jobs.tick()
  await s.jobs.tick()
  await s.jobs.tick()
  await s.handle(`/batch export ${group}`)
  s.settings.maxExportBytes = 1
  await assert.rejects(s.handle(`/batch export ${group}`))
  s.references(Array.from({ length: 11 }, () => file))
  await assert.rejects(s.handle('/batch summarize'))
  s.settings.confirmExpensiveRequests = false
  assert.equal(await s.handle('/job question'), false)
  assert.equal(await s.handle('/job delete id'), false)
  s.flow.stage('a', {
    thread: '1',
    revision: undefined,
    kind: 'job',
    input: 'invalid',
    action: 'summary',
    estimate: 0
  })
  await assert.rejects(s.callback(`work:${s.approval().token}:confirm`))
})
void test('archive import previews a merge, rejects unsupported input and refreshes only after a confirmed commit', async () => {
  const noStore = setup(false)
  await assert.rejects(noStore.handle('/import'))
  const s = setup()
  await assert.rejects(s.handle('/import'))
  s.document({ ...file, name: 'a.txt' })
  await assert.rejects(s.handle('/import'))
  const archive = {
    profile: { threads: [{ id: '1', title: 'Work' }], memories: [] },
    workspace: { projects: [] },
    histories: []
  }
  s.document({
    name: 'my-data.json',
    mime: 'application/json',
    data: Buffer.from(JSON.stringify(archive)).toString('base64')
  })
  await s.handle('/import')
  const approval = s.approval()
  assert.match(s.messages.at(-1)!, /Import preview/)
  await s.callback(`work:${approval.token}:confirm`)
  assert.equal(s.imported(), 1)
  assert.equal(s.store.getProfile('a')!.threads.length, 2)
  noStore.flow.stage('a', {
    thread: '1',
    revision: undefined,
    kind: 'import',
    input: '{}',
    action: 'merge',
    estimate: 0
  })
  await assert.rejects(
    noStore.callback(`work:${noStore.approval().token}:confirm`)
  )
})

void test('task lists paginate without flooding the chat and reject invalid page input', async () => {
  const s = setup()
  for (let i = 0; i < 10; i++) s.flow.addTask('a', '1', `Task ${i}`, null)
  await s.handle('/tasks')
  assert.match(s.messages.at(-1)!, /page 1\/2/)
  await s.callback('tasks:thread:2')
  assert.match(s.messages.at(-1)!, /page 2\/2/)
  await s.callback('tasks:all:1')
  await s.callback('tasks:all')
  for (const value of [
    '/tasks bad',
    '/tasks 0',
    '/tasks 3',
    '/tasks 9007199254740992'
  ])
    await assert.rejects(s.handle(value))
})
