import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ExperienceCommands,
  type ExperienceContext
} from '../experience-commands.js'
import { Experience } from '../../application/experience.js'
import { Jobs } from '../../application/jobs.js'
import { Workflow } from '../../application/workflow.js'
import { Workspaces } from '../../application/workspaces.js'
import { UsageLedger } from '../../application/usage.js'
import { Conversations } from '../../application/conversations.js'
import { config, FakeModel, MemoryStateStore } from '../../__tests__/helpers.js'
function setup() {
  const store = new MemoryStateStore(),
    settings = config(),
    data = new Experience(store, () => 0),
    ws = new Workspaces(settings, store),
    usage = new UsageLedger(settings, ws, store, () => 0),
    workflow = new Workflow(store, () => 0),
    model = new FakeModel(),
    chat = new Conversations(model, settings, () => 0, store),
    messages: string[] = []
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
    store,
    () => 0
  )
  const ctx: ExperienceContext = {
    owner: 'a',
    thread: '1',
    text: value => {
      messages.push(value)
      return Promise.resolve()
    },
    quote: () => 'Quoted passage\nUseful text',
    prepare: prompt => ({
      prompt,
      history: [],
      images: [],
      documents: [],
      memories: [],
      instructions: '',
      references: '',
      analysisOnly: false
    }),
    flush: () => Promise.resolve(2)
  }
  const commands = new ExperienceCommands(data, jobs, workflow, ws, usage, chat)
  return {
    commands,
    ctx,
    data,
    jobs,
    workflow,
    ws,
    usage,
    chat,
    model,
    messages,
    handle: (value: string) => commands.handle(ctx, value),
    callback: (value: string) => commands.callback(ctx, value)
  }
}
void test('delivery and language commands validate inputs and keep answer preferences independent', async () => {
  const s = setup()
  assert.equal(await s.handle('hello'), false)
  assert.equal(await s.handle('/unknown'), false)
  assert.equal(await s.callback('unknown:x'), false)
  await s.handle('/quiet')
  await s.handle('/quiet 22:00-08:00')
  await s.handle('/quiet off')
  await s.handle('/digest')
  await s.handle('/digest 5m')
  await s.handle('/digest 1h')
  await s.handle('/digest off')
  await s.handle('/digest now')
  assert.match(s.messages.at(-1)!, /2/)
  await assert.rejects(s.handle('/digest bad'))
  await s.handle('/language')
  await s.handle('/language ui ru')
  await s.handle('/language answer es')
  assert.equal(s.data.get('a').language, 'ru')
  assert.equal(s.ws.thread('a', '1').answerLanguage, 'es')
  for (const value of [
    '/language bad',
    '/language ui',
    '/language answer xx',
    '/language ui en extra'
  ])
    await assert.rejects(s.handle(value))
  await s.handle('/language answer auto')
})
void test('bookmarks expose private tag search, pagination, edits and source/answer saves', async () => {
  const s = setup()
  await s.handle('/bookmarks')
  assert.match(s.messages.at(-1)!, /No bookmarks/)
  for (const value of [
    '/bookmark',
    '/bookmark add',
    '/bookmark show missing',
    '/bookmark tags missing | tag',
    '/bookmark delete missing',
    '/bookmarks | 0',
    '/bookmarks | 2'
  ])
    await assert.rejects(s.handle(value))
  await s.handle('/bookmark add Title | https://example.com | work, docs')
  const first = s.data.get('a').bookmarks[0]!
  await s.handle(`/bookmark show ${first.id}`)
  assert.match(s.messages.at(-1)!, /example.com/)
  await s.handle(`/bookmark tags ${first.id} | personal`)
  await s.handle('/bookmarks #personal')
  assert.match(s.messages.at(-1)!, /Title/)
  await s.handle('/bookmark reply | work')
  await s.handle('/bookmark reply')
  await s.handle(`/bookmark delete ${first.id}`)
  for (let i = 0; i < 8; i++) s.data.bookmark('a', `Title ${i}`, `Body ${i}`)
  await s.handle('/bookmarks | 2')
  await assert.rejects(s.callback('card:missing:0'))
  await s.chat.respond('a:1', 'Question', [], {
    evidence: [{ label: 'L1', title: 'Terms page 2', text: 'Evidence' }]
  })
  const revision = s.chat.history('a:1').at(-1)!.id!
  await s.callback(`card:${revision}:0`)
  await assert.rejects(s.callback(`card:${revision}:9`))
  await s.callback(`bookmark:answer:${revision}`)
  await s.callback(`bookmark:source:${revision}:0`)
  await assert.rejects(s.callback(`bookmark:source:${revision}:9`))
  await assert.rejects(s.callback(`bookmark:bad:${revision}`))
  await s.handle('/sources')
  s.ctx.thread = '2'
  await assert.rejects(s.handle('/sources'))
  await assert.rejects(s.callback(`card:${revision}:0`))
  s.ctx.thread = '1'
  s.model.answer = {
    text: 'Web answer',
    images: [],
    sources: [{ title: 'Web', url: 'https://example.com' }]
  }
  await s.chat.reply('a:1', 'Web question')
  await s.callback(`bookmark:source:${s.chat.history('a:1').at(-1)!.id!}:0`)
  s.model.answer = { text: '', images: [{ mime: 'image/png', data: 'YQ==' }] }
  await s.chat.reply('a:1', 'Image')
  await assert.rejects(
    s.callback(`bookmark:answer:${s.chat.history('a:1').at(-1)!.id!}`)
  )
})
void test('project budgets, deferred priority queues and validated output requests preserve local scope', async () => {
  const s = setup()
  await assert.rejects(s.handle('/project_usage'))
  const project = s.ws.create('a', 'Work')
  s.ws.configure('a', '1', { project: project.id })
  await s.handle('/project_usage')
  await s.handle('/project_budget 1.25')
  assert.equal(s.ws.get('a').projects[0]!.dailyBudget, 1250000)
  await s.handle('/project_budget')
  await assert.rejects(s.handle('/project_budget bad'))
  await s.handle('/queue')
  assert.match(s.messages.at(-1)!, /No queued/)
  const job = s.jobs.enqueue('a', '1', 'summary', {
    prompt: 'Summary',
    documents: [],
    images: [],
    memories: [],
    instructions: ''
  })
  await s.handle(`/priority ${job.id} 9`)
  await s.handle('/queue')
  assert.match(s.messages.at(-1)!, /priority 9/)
  await s.handle(`/defer ${job.id} | 2099-01-01 09:00`)
  await s.handle(`/defer ${job.id} | now`)
  for (const value of [
    '/priority',
    '/priority id 1 extra',
    '/priority id NaN',
    '/defer id',
    '/output',
    '/output csv name',
    '/output csv name | ',
    '/output bad name | question'
  ])
    await assert.rejects(s.handle(value))
  const prepared = await s.handle(
    '/output json name,amount | Extract these values'
  )
  assert.ok(typeof prepared === 'object')
  assert.deepEqual(prepared.structured, {
    format: 'json',
    fields: ['name', 'amount']
  })
  assert.equal(prepared.analysisOnly, true)
})
void test('notification controls suppress only delivery, rearm retries and retrieve existing results without a model call', async () => {
  const s = setup()
  await s.handle('/notifications')
  assert.match(s.messages.at(-1)!, /No pending/)
  const job = s.jobs.enqueue('a', '1', 'research', {
    prompt: 'Research',
    documents: [],
    images: [],
    memories: [],
    instructions: ''
  })
  s.data.enqueue('a', {
    kind: 'job',
    target: job.id,
    thread: '1',
    title: 'Result'
  })
  await s.handle('/notifications')
  await s.handle(`/notifications retry job-${job.id}`)
  await s.handle(`/notifications drop job-${job.id}`)
  assert.equal(s.jobs.get('a').jobs[0]!.delivery, 'suppressed')
  const task = s.workflow.addTask('a', '1', 'Task', null)
  s.data.enqueue('a', {
    kind: 'task',
    target: task.id,
    thread: '1',
    title: 'Due'
  })
  await s.handle(`/notifications drop task-${task.id}`)
  assert.equal(s.workflow.get('a').tasks[0]!.delivery, 'suppressed')
  for (const value of [
    '/notifications bad',
    '/notifications drop missing',
    '/notifications retry missing'
  ])
    await assert.rejects(s.handle(value))
  await assert.rejects(s.callback('notice:result:missing'))
  await s.jobs.tick()
  await s.callback(`notice:result:${job.id}`)
})

void test('optional command arguments and deferred queue status remain explicit and bounded', async () => {
  const s = setup()
  for (const value of [
    '/notifications retry',
    '/bookmark tags',
    '/bookmark delete',
    '/bookmark show'
  ])
    await assert.rejects(s.handle(value))
  const item = s.data.bookmark('a', 'Title', 'Text', ['old'])
  await s.handle(`/bookmark tags ${item.id}`)
  assert.deepEqual(s.data.get('a').bookmarks[0]!.tags, [])
  const job = s.jobs.enqueue('a', '1', 'summary', {
    prompt: 'Summary',
    documents: [],
    images: [],
    instructions: '',
    memories: []
  })
  s.jobs.defer('a', job.id, Date.parse('2099-01-01T09:00:00Z'))
  await s.handle('/queue')
  assert.match(s.messages.at(-1)!, /2099/)
  await s.chat.reply('a:1', 'No evidence')
  await assert.rejects(s.handle('/sources'))
  await s.chat.respond('a:1', 'Web', [], {
    evidence: [
      {
        label: 'W1',
        title: 'Web',
        text: 'Evidence',
        url: 'https://example.com'
      }
    ]
  })
  const revision = s.chat.history('a:1').at(-1)!.id!
  await s.callback(`card:${revision}:0`)
})
