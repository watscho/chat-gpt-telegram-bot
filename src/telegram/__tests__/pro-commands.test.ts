import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config, FakeModel, MemoryStateStore } from '../../__tests__/helpers.js'
import type { Document } from '../../domain/conversation.js'
import { Profiles } from '../../application/profiles.js'
import { Conversations } from '../../application/conversations.js'
import { Workspaces } from '../../application/workspaces.js'
import { UsageLedger } from '../../application/usage.js'
import { ResponseControls } from '../../application/response-controls.js'
import { Jobs } from '../../application/jobs.js'
import { ProCommands, type CommandContext } from '../pro-commands.js'

const file: Document = { name: 'a.txt', mime: 'text/plain', data: 'YQ==' }
function setup() {
  const settings = config(),
    store = new MemoryStateStore(),
    model = new FakeModel()
  const profiles = new Profiles(settings, store)
  const conversations = new Conversations(model, settings, () => 0, store)
  const ws = new Workspaces(settings, store)
  const usage = new UsageLedger(settings, ws, store, () => 0)
  const controls = new ResponseControls()
  const delivered: string[] = []
  const jobs = new Jobs(
    settings,
    {
      allowed: () => true,
      available: () => true,
      input: (_owner, _thread, prompt) => ({
        prompt,
        images: [],
        documents: [],
        instructions: '',
        memories: []
      }),
      execute: () => Promise.resolve({ text: 'Result', images: [] }),
      deliver: (owner, job) => {
        delivered.push(`${owner}:${job.id}`)
        return Promise.resolve()
      }
    },
    store,
    () => 0
  )
  const text: string[] = [],
    files: { name: string; data: string }[] = []
  let reply: Document | undefined
  let references: Document[] = []
  const ctx: CommandContext = {
    owner: '42:42',
    thread: '1',
    text: value => {
      text.push(value)
      return Promise.resolve()
    },
    file: (bytes, name) => {
      files.push({ name, data: Buffer.from(bytes).toString() })
      return Promise.resolve()
    },
    repliedDocument: () => Promise.resolve(reply),
    input: prompt => ({
      prompt,
      documents: references,
      images: [],
      instructions: '',
      memories: []
    })
  }
  const exporters = {
    markdown: (title: string) => Buffer.from(title),
    json: (value: unknown) => Buffer.from(JSON.stringify(value)),
    pdf: (title: string) => Promise.resolve(Buffer.from(`PDF ${title}`))
  }
  const commands = new ProCommands(
    profiles,
    conversations,
    ws,
    usage,
    controls,
    jobs,
    exporters,
    store
  )
  return {
    commands,
    ctx,
    text,
    files,
    store,
    profiles,
    conversations,
    ws,
    usage,
    controls,
    jobs,
    model,
    delivered,
    reply: (value?: Document) => {
      reply = value
    },
    references: (value: Document[]) => {
      references = value
    },
    run: (value: string) => commands.handle(ctx, value)
  }
}
void test('Pro commands configure per-conversation settings and bounded daily limits', async () => {
  const app = setup()
  assert.equal(await app.run('plain message'), false)
  assert.equal(await app.run('/unrecognized'), false)
  await app.run('/usage')
  assert.match(app.text.at(-1)!, /UTC day/)
  await app.run('/budget')
  assert.match(app.text.at(-1)!, /10\.000000/)
  await app.run('/budget 1.25')
  assert.equal(app.ws.get(app.ctx.owner).budget, 1250000)
  await assert.rejects(app.run('/budget bad'))
  await app.run('/limits')
  for (const kind of ['image', 'search', 'voice'])
    await app.run(`/limits ${kind} 1`)
  for (const value of ['other 1', 'voice -1', 'image 1 extra', 'image'])
    await assert.rejects(app.run(`/limits ${value}`))
  await app.run('/timezone')
  assert.match(app.text.at(-1)!, /UTC/)
  await app.run('/timezone Asia/Tbilisi')
  assert.match(app.text.at(-1)!, /Asia\/Tbilisi/)
  await app.run('/mode')
  await app.run('/mode developer')
  assert.equal(app.ws.thread(app.ctx.owner, '1').mode, 'developer')
  await app.run('/instructions')
  await app.run('/instructions Be precise')
  assert.equal(app.ws.thread(app.ctx.owner, '1').instructions, 'Be precise')
  await app.run('/instructions clear')
  assert.equal(app.ws.thread(app.ctx.owner, '1').instructions, '')
  await app.run('/quality')
  await app.run('/quality medium')
  await app.run('/size')
  await app.run('/size 1536x1024')
  await app.run('/retention')
  await app.run('/retention 60')
  await app.run('/retention default')
  await app.conversations.reply('42:42:1', 'retained')
  await app.run('/retention 60')
  assert.equal(app.store.sessions()[0]?.[1].expiresAt, 60000)
})
void test('project commands manage scoped reference files, instructions and notes', async () => {
  const app = setup()
  await app.run('/projects')
  assert.match(app.text.at(-1)!, /No projects/)
  await assert.rejects(app.run('/project info'), /Select a project/)
  await app.run('/project new Work')
  await app.run('/projects')
  assert.match(app.text.at(-1)!, /1: Work/)
  await app.run('/project')
  await app.run('/project info')
  await app.run('/project instructions Be accurate')
  await app.run('/project instructions clear')
  await app.run('/project remember Scope note')
  await app.run('/project info')
  assert.match(app.text.at(-1)!, /Scope note/)
  await app.run('/project forget 1')
  await app.run('/project remember Another')
  await app.run('/project forget all')
  await assert.rejects(app.run('/project attach'), /Reply to a document/)
  app.reply(file)
  await app.run('/project attach')
  await app.run('/project info')
  assert.match(app.text.at(-1)!, /a\.txt/)
  await app.run('/project remove a.txt')
  await assert.rejects(app.run('/project invalid'), /Project actions/)
  await app.run('/project use none')
  assert.equal(app.ws.project(app.ctx.owner, '1'), undefined)
  await app.run('/project use 1')
  await app.run('/project delete 1')
  assert.equal(app.ws.get(app.ctx.owner).projects.length, 0)
})
void test('history, exports, comparison and image-source commands respect ownership and retained data', async () => {
  const app = setup()
  await assert.rejects(app.run('/export'), /no retained/)
  await app.conversations.reply('42:42:1', 'Find this decision')
  await app.conversations.reply('43:43:1', 'other-owner-secret')
  await app.run('/find decision')
  assert.match(app.text.at(-1)!, /Conversation 1/)
  await app.run('/find missing')
  assert.match(app.text.at(-1)!, /No retained/)
  for (const format of ['', 'pdf', 'json']) await app.run(`/export ${format}`)
  assert.deepEqual(
    app.files.map(item => item.name),
    ['conversation-1.md', 'conversation-1.pdf', 'conversation-1.json']
  )
  await assert.rejects(app.run('/export invalid'), /Usage/)
  await app.run('/data')
  assert.equal(app.files.at(-1)?.name, 'my-data.json')
  assert.ok(!app.files.at(-1)?.data.includes('other-owner-secret'))
  await assert.rejects(app.run('/compare'), /two reference/)
  app.references([file, { ...file, name: 'b.txt', data: 'Yg==' }])
  const comparison = await app.run('/compare Focus on obligations')
  assert.equal(typeof comparison, 'object')
  assert.ok(
    typeof comparison === 'object' &&
      comparison.analysisOnly &&
      comparison.prompt.includes('evidence')
  )
  const defaultComparison = await app.run('/compare')
  assert.ok(
    typeof defaultComparison === 'object' &&
      defaultComparison.prompt.includes('Identify substantive')
  )
  await app.run('/versions')
  assert.match(app.text.at(-1)!, /No generated/)
  app.model.answer = {
    text: '',
    images: [{ data: 'iVBORw0KGgo=', mime: 'image/png' }]
  }
  await app.conversations.respond('42:42:1', 'create image')
  await app.run('/versions')
  const version = app.conversations.versions('42:42:1')[0]!.id
  await assert.rejects(app.run('/revert other-owner-version'), /not retained/)
  await app.run(`/revert ${version}`)
  assert.equal(app.ws.thread('42:42', '1').imageVersion, version)
})
void test('background work, schedule inspection and full-content erasure are explicit and scoped', async () => {
  const app = setup()
  await app.run('/jobs')
  assert.match(app.text.at(-1)!, /No jobs/)
  await assert.rejects(app.run('/job'), /Usage/)
  await assert.rejects(app.run('/job compare versions'), /two reference/)
  app.references([file, { ...file, name: 'b.txt' }])
  for (const prompt of [
    'research Find sources',
    'compare Describe changes',
    'summary Decisions',
    'A background question'
  ])
    await app.run(`/job ${prompt}`)
  await app.run('/jobs')
  assert.match(app.text.at(-1)!, /queued/)
  const first = app.jobs.get(app.ctx.owner).jobs[0]!.id
  await app.run(`/cancel ${first}`)
  await app.run(`/job delete ${first}`)
  const second = app.jobs.get(app.ctx.owner).jobs[0]!.id
  await app.jobs.tick()
  await app.run(`/result ${second}`)
  assert.equal(app.delivered.length, 2)
  await app.run('/schedules')
  assert.match(app.text.at(-1)!, /No schedules/)
  await assert.rejects(app.run('/remind invalid'), /Usage/)
  await app.run('/remind every 1m | Check progress')
  await app.run('/summary every 1h | Decisions')
  await app.run('/schedules')
  assert.match(app.text.at(-1)!, /every 60 minutes/)
  await app.run('/remind 2030-01-01 12:00 | One-off')
  await app.run('/schedules')
  assert.match(app.text.at(-1)!, /2030-01-01/)
  await app.run(`/unschedule ${app.jobs.get(app.ctx.owner).schedules[0]!.id}`)
  app.profiles.remember(app.ctx.owner, 'private note')
  await app.conversations.reply('42:42:1', 'private history')
  app.usage.reserve(app.ctx.owner, 'chat').finish()
  await app.run('/erase')
  assert.equal(app.profiles.get(app.ctx.owner).memories.length, 1)
  const active = app.controls.begin(app.ctx.owner, '1')
  await app.run('/erase confirm')
  assert.equal(active.signal.aborted, false)
  assert.equal(app.profiles.get(app.ctx.owner).memories.length, 0)
  assert.equal(app.jobs.get(app.ctx.owner).jobs.length, 0)
  assert.equal(app.conversations.history('42:42:1').length, 0)
  assert.equal(app.usage.get(app.ctx.owner).requests, 1)
})
