import { test } from 'node:test'
import messages from '../locales/messages.json' with { type: 'json' }
import assert from 'node:assert/strict'
import { DailyCommands, type DailyContext } from '../daily-commands.js'
import { Daily } from '../../application/daily.js'
import { Profiles } from '../../application/profiles.js'
import { Workspaces } from '../../application/workspaces.js'
import { Conversations } from '../../application/conversations.js'
import { Workflow } from '../../application/workflow.js'
import { Jobs } from '../../application/jobs.js'
import { Productivity } from '../../application/productivity.js'
import { Experience } from '../../application/experience.js'
import { referenceId } from '../../application/evidence.js'
import { config, FakeModel, MemoryStateStore } from '../../__tests__/helpers.js'
import type { PreparedRequest } from '../../domain/productivity.js'
import type { Keyboard } from '../productivity-commands.js'
function setup() {
  const store = new MemoryStateStore(),
    settings = config(),
    data = new Daily(store),
    profiles = new Profiles(settings, store),
    ws = new Workspaces(settings, store),
    model = new FakeModel(),
    chat = new Conversations(model, settings),
    flow = new Workflow(store),
    productivity = new Productivity(store),
    experience = new Experience(store)
  const jobs = new Jobs(
    settings,
    {
      allowed: () => true,
      available: () => true,
      input: () => ({
        prompt: 'x',
        documents: [],
        images: [],
        instructions: '',
        memories: []
      }),
      execute: () => Promise.resolve({ text: 'result', images: [] }),
      deliver: () => Promise.resolve()
    },
    store
  )
  const messages: string[] = [],
    keys: Keyboard[] = [],
    reviews: PreparedRequest[] = []
  const ctx: DailyContext = {
    owner: 'a',
    thread: '1',
    text: (text, key) => {
      messages.push(text)
      if (key) keys.push(key)
      return Promise.resolve()
    },
    prepare: prompt => ({
      prompt,
      images: [],
      documents: [],
      memories: [],
      instructions: '',
      history: chat.history(`a:${profiles.get('a').active}`),
      references: '',
      analysisOnly: false
    }),
    review: request => {
      reviews.push(request)
      return Promise.resolve()
    },
    article: url =>
      Promise.resolve({
        url,
        title: 'Article',
        text: 'Readable '.repeat(30),
        truncated: false
      })
  }
  const commands = new DailyCommands(
    data,
    profiles,
    ws,
    chat,
    flow,
    jobs,
    productivity,
    experience
  )
  return {
    store,
    model,
    data,
    profiles,
    ws,
    chat,
    flow,
    jobs,
    productivity,
    experience,
    commands,
    ctx,
    messages,
    keys,
    reviews,
    handle: (text: string) => commands.handle(ctx, text),
    callback: (text: string) => commands.callback(ctx, text)
  }
}
void test('guided setup and local dashboards expose useful defaults without starting a model request', async () => {
  const s = setup()
  assert.equal(await s.handle('hello'), false)
  assert.equal(await s.callback('other:x'), false)
  await s.handle('/onboarding')
  for (const focus of ['work', 'study', 'personal']) {
    await s.callback(`daily:focus:${focus}`)
    await s.callback('daily:language:en')
    const request = await s.callback('daily:example')
    assert.equal(typeof request, 'object')
  }
  assert.equal(s.data.get('a').onboarded, true)
  s.experience.language('a', 'ru')
  assert.ok(s.commands.today('a').text.startsWith(messages.ru.Today))
  s.experience.language('a', 'en')
  await s.handle('/today')
  await s.callback('daily:today')
  await s.callback('daily:skip')
  await s.callback('daily:scenarios')
  await s.handle('/morning')
  await s.handle('/morning 09:00')
  await s.handle('/morning off')
  await s.handle('/notes')
  await s.handle('/notes on')
  await s.handle('/notes off')
  await assert.rejects(s.callback('daily:wrong'))
  assert.match(s.commands.today('a').text, /No open tasks/)
  s.flow.addTask('a', '1', 'Undated', null)
  s.flow.addTask('a', '1', 'Also undated', null)
  s.flow.addTask('a', '1', 'Future', Date.now() + 100000)
  const task = s.flow.addTask('a', '1', 'Due', Date.now() + 10000)
  const state = s.flow.get('a')
  state.tasks.find(item => item.id === task.id)!.dueAt = 1
  s.flow.save('a', state)
  const job = s.jobs.enqueue('a', '1', 'research', {
    prompt: 'Research',
    documents: [],
    images: [],
    instructions: '',
    memories: []
  })
  await s.jobs.tick()
  const view = s.commands.today('a')
  assert.match(view.text, /overdue/)
  assert.match(view.text, /no deadline/)
  assert.match(view.text, new RegExp(job.id))
})
void test('favorite/recent scenarios page templates, validate exact variables and bind pending input to its conversation', async () => {
  const s = setup()
  await s.handle('/favorites')
  await s.handle('/favorite add polish')
  await s.handle('/favorite remove polish')
  for (const command of [
    '/favorite',
    '/favorite wrong polish',
    '/favorite add polish extra',
    '/favorite add missing',
    '/scenarios 0',
    '/scenarios NaN'
  ])
    await assert.rejects(s.handle(command))
  assert.equal(await s.handle('/run legacy {}'), false)
  assert.equal(await s.handle('/run legacy'), false)
  s.productivity.template('a', 'polish', 'Existing template')
  assert.equal(await s.handle('/run polish'), false)
  assert.equal(await s.handle('/run polish {}'), false)
  const result = (await s.handle('/run polish | Draft text')) as PreparedRequest
  assert.match(result.prompt, /Draft text/)
  assert.equal(result.analysisOnly, true)
  const translated = (await s.handle(
    '/run translate | Translate me'
  )) as PreparedRequest
  assert.match(translated.instructions, /use English as explicitly requested/)
  await s.handle('/scenarios')
  assert.match(s.messages.at(-1)!, /Recent: translate, polish/)
  await assert.rejects(s.handle('/run polish | '))
  s.productivity.template('a', 'example', 'Review {{text}}')
  for (const value of ['bad', 'null', '[]', '{"text":1}', '{}'])
    await assert.rejects(s.handle(`/run template:example | ${value}`))
  const template = (await s.handle(
    '/run template:example | {"text":"source"}'
  )) as PreparedRequest
  assert.equal(template.prompt, 'Review source')
  await s.handle('/run plan')
  assert.match(s.messages.at(-1)!, /Send its input/)
  assert.match(s.commands.pending(s.ctx, 'A goal')!.prompt, /A goal/)
  assert.equal(s.commands.pending(s.ctx, 'No pending'), null)
  await s.callback('daily:run:polish')
  await s.handle('/scenario_cancel')
  assert.equal(s.commands.pending(s.ctx, 'No pending'), null)
  for (let i = 0; i < 16; i++) s.productivity.template('a', `extra${i}`, 'Text')
  const state = s.data.get('a')
  state.favorites = ['polish', 'deleted']
  state.recent = ['missing']
  s.data.save('a', state)
  await s.handle('/scenarios')
  const recentOnly = s.data.get('a')
  recentOnly.recent = ['deleted']
  s.data.save('a', recentOnly)
  await s.handle('/scenarios')
  await s.callback('daily:scenarios:2')
  assert.match(s.messages.at(-1)!, /page 2/)
  await s.handle('/favorites')
  for (const id of [
    'polish',
    'translate',
    'invoice',
    'plan',
    ...Array.from({ length: 16 }, (_, i) => `template:extra${i}`)
  ])
    s.data.favorite('a', id, true)
  await s.handle('/favorites 2')
  assert.ok(
    s.keys
      .at(-1)!
      .inline_keyboard.flat()
      .some(
        item =>
          'callback_data' in item && item.callback_data === 'daily:favorites:1'
      )
  )
  await s.callback('daily:favorites:1')
  await s.callback('daily:scenarios:1')
  await assert.rejects(s.callback('daily:run:missing'))
  await assert.rejects(s.callback('daily:run:template:deleted'))
})
void test('reviewed task proposals create only after confirmation and context changes reject old controls', async () => {
  const s = setup()
  const request = s.commands.taskRequest(s.ctx, 'Send the draft tomorrow')
  assert.equal(request.reviewTasks, true)
  assert.deepEqual(request.structured!.fields, ['summary', 'task', 'due'])
  assert.deepEqual(request.history, [])
  await s.commands.taskReview(
    s.ctx,
    JSON.stringify({
      rows: [
        { summary: 'Summary', task: 'Review draft', due: '2099-01-01 09:00' }
      ]
    })
  )
  assert.equal(s.flow.get('a').tasks.length, 0)
  let token = s.data.get('a').plan!.token
  await s.callback(`daily:tasks:${token}`)
  assert.equal(s.flow.get('a').tasks.length, 1)
  await assert.rejects(s.callback(`daily:tasks:${token}`))
  await s.commands.taskReview(
    s.ctx,
    JSON.stringify({
      rows: [{ summary: null, task: 'No deadline', due: null }]
    })
  )
  token = s.data.get('a').plan!.token
  await s.callback(`daily:cancel:${token}`)
  await s.commands.taskReview(
    s.ctx,
    JSON.stringify({
      rows: [{ summary: 'Only summary', task: null, due: null }]
    })
  )
  assert.match(s.messages.at(-1)!, /No tasks proposed/)
  assert.equal(
    s.keys
      .at(-1)!
      .inline_keyboard.flat()
      .some(
        item =>
          'callback_data' in item &&
          item.callback_data.startsWith('daily:tasks:')
      ),
    false
  )
  await s.commands.taskReview(
    s.ctx,
    JSON.stringify({
      rows: [{ summary: null, task: 'Needs date', due: 'invalid' }]
    })
  )
  assert.match(s.messages.at(-1)!, /Deadline needs review/)
})
void test('source-reading, contextual actions and project continuation use retained owner-bound evidence and mandatory review', async () => {
  const s = setup()
  assert.throws(() => s.commands.action(s.ctx, 'act:risks:missing'))
  const article = (await s.handle(
    '/read https://example.com/article | Focus on risks'
  )) as PreparedRequest
  assert.equal(article.documents[0]!.name, 'article.txt')
  assert.equal(article.evidence![0]!.label, 'A1')
  assert.match(article.prompt, /Focus on risks/)
  assert.equal(
    ((await s.handle('https://example.com')) as PreparedRequest).analysisOnly,
    true
  )
  const image = { mime: 'image/png' as const, data: 'aQ==' }
  const document = { name: 'test.txt', mime: 'text/plain', data: 'VGVzdA==' }
  await s.chat.respond('a:1', 'Question', [image], { documents: [document] })
  const revision = s.chat.history('a:1').at(-1)!.id!,
    ref = referenceId(revision)
  for (const action of [
    'tasks',
    'risks',
    'compare',
    'checklist',
    'translate',
    'explain',
    'background'
  ])
    assert.equal(
      typeof s.commands.action(s.ctx, `act:${action}:${ref}`),
      'object'
    )
  s.experience.language('a', 'ru')
  const translated = s.commands.action(
    s.ctx,
    `act:translate:${ref}`
  ) as PreparedRequest
  assert.match(translated.instructions, /target language: ru/)
  assert.throws(() => s.commands.action(s.ctx, `act:unknown:${ref}`))
  for (const [images, documents, multiple] of [
    [true, false, false],
    [false, true, true],
    [false, true, false],
    [false, false, false]
  ])
    assert.ok(
      s.commands.answerButtons(revision, images!, documents!, multiple!).flat()
        .length >= 2
    )
  await s.handle('/continue')
  assert.match(s.messages.at(-1)!, /Last answer excerpt/)
  const project = s.ws.create('a', 'Work')
  s.ws.configure('a', '1', { project: project.id })
  s.flow.addTask('a', '1', 'Next step', null)
  const second = s.profiles.create('a', 'Other')
  s.ws.configure('a', second.active, { project: project.id })
  await s.callback('daily:continue')
  assert.match(s.messages.at(-1)!, /Next step/)
  await s.callback('daily:resume:1')
  assert.equal(s.reviews.length, 1)
  await assert.rejects(s.callback('daily:resume:missing'))
  await s.chat.respond('a:1', 'New question')
  assert.throws(() => s.commands.action(s.ctx, `act:risks:${ref}`))
  const current = referenceId(s.chat.history('a:1').at(-1)!.id!)
  assert.equal(
    typeof s.commands.action(s.ctx, `act:checklist:${current}`),
    'object'
  )
  assert.match(
    (s.commands.action(s.ctx, `act:translate:${current}`) as PreparedRequest)
      .prompt,
    /selected answer/
  )
  const generated = setup()
  generated.model.answer = { text: 'Generated', images: [image] }
  await generated.chat.respond('a:1', 'Generate')
  const imageRef = referenceId(generated.chat.history('a:1').at(-1)!.id!)
  const imageRequest = generated.commands.action(
    generated.ctx,
    `act:explain:${imageRef}`
  ) as PreparedRequest
  assert.deepEqual(imageRequest.images, [image])
  const docs = setup()
  await docs.chat.respond('a:1', 'Read', [], { documents: [document] })
  const docRef = referenceId(docs.chat.history('a:1').at(-1)!.id!)
  assert.match(
    (
      docs.commands.action(
        docs.ctx,
        `act:translate:${docRef}`
      ) as PreparedRequest
    ).prompt,
    /selected document/
  )
  const empty = setup()
  await empty.handle('/continue')
  assert.match(empty.messages.at(-1)!, /No retained/)
})
