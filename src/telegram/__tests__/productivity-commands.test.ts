import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ProductivityCommands,
  type Keyboard,
  type ProductivityContext
} from '../productivity-commands.js'
import { Productivity } from '../../application/productivity.js'
import { Library } from '../../application/library.js'
import { Profiles } from '../../application/profiles.js'
import { Workspaces } from '../../application/workspaces.js'
import { Conversations } from '../../application/conversations.js'
import { config, FakeModel, MemoryStateStore } from '../../__tests__/helpers.js'
import type { Document } from '../../domain/conversation.js'
import type { PreparedRequest } from '../../domain/productivity.js'
function setup() {
  const store = new MemoryStateStore(),
    settings = config(),
    model = new FakeModel(),
    profiles = new Profiles(settings, store),
    ws = new Workspaces(settings, store),
    conversations = new Conversations(model, settings, () => 0, store)
  let now = 0,
    reply: Document | undefined
  const data = new Productivity(store, () => now),
    library = new Library(
      () => Promise.resolve([{ location: 'page 1', text: 'Renewal payment' }]),
      store
    )
  const commands = new ProductivityCommands(
    data,
    library,
    profiles,
    ws,
    conversations,
    settings.chatModel,
    () => now
  )
  const text: string[] = [],
    keyboards: Keyboard[] = []
  const ctx: ProductivityContext = {
    owner: 'a',
    thread: '1',
    text: (value, keyboard) => {
      text.push(value)
      if (keyboard) keyboards.push(keyboard)
      return Promise.resolve()
    },
    repliedDocument: () => Promise.resolve(reply),
    prepare: prompt => ({
      prompt,
      images: [],
      documents: [],
      memories: [],
      instructions: '',
      history: conversations.history(`a:${profiles.get('a').active}`),
      references: '',
      analysisOnly: false
    })
  }
  const handle = (value: string) => commands.handle(ctx, value)
  const button = (label: string) =>
    keyboards
      .at(-1)!
      .inline_keyboard.flat()
      .find(item => item.text === label)!.callback_data
  const callback = (value: string) => commands.callback(ctx, value)
  return {
    store,
    settings,
    model,
    profiles,
    ws,
    conversations,
    data,
    library,
    commands,
    ctx,
    text,
    keyboards,
    handle,
    button,
    callback,
    time: (value: number) => {
      now = value
    },
    reply: (file?: Document) => {
      reply = file
    }
  }
}
void test('prompt templates validate command syntax, render exact variables and expose saved content', async () => {
  const s = setup()
  assert.equal(await s.handle('ordinary'), false)
  assert.equal(await s.handle('/unknown'), false)
  assert.equal(await s.callback('other:x:x'), false)
  await s.handle('/templates')
  assert.match(s.text.at(-1)!, /No templates/)
  for (const value of [
    '/template',
    '/template wrong',
    '/template save',
    '/template save t body',
    '/template save t extra | body',
    '/template show missing',
    '/template delete missing',
    '/run',
    '/run t nope',
    '/run t []',
    '/run t null',
    '/run t 42',
    '/run t {"x":3}'
  ])
    await assert.rejects(s.handle(value))
  await s.handle('/template save review | Explain {{code}}')
  await s.handle('/templates')
  assert.match(s.text.at(-1)!, /review/)
  await s.handle('/template show review')
  assert.equal(s.text.at(-1), 'Explain {{code}}')
  assert.equal(
    ((await s.handle('/run review {"code":"hello"}')) as PreparedRequest)
      .prompt,
    'Explain hello'
  )
  await s.handle('/template save fixed | Fixed text')
  assert.equal(
    ((await s.handle('/run fixed')) as PreparedRequest).prompt,
    'Fixed text'
  )
  await s.handle('/template delete fixed')
})
void test('settings callbacks are owner/thread/TTL bound and configure all supported sections without paid calls', async () => {
  const s = setup()
  await assert.rejects(s.callback('menu:no:mode:editor'))
  await s.handle('/menu')
  const expired = s.button('model')
  s.time(600001)
  await assert.rejects(s.callback(expired))
  s.time(0)
  for (const [section, choice] of [
    ['mode', 'editor'],
    ['model', 'GPT-6.1 Sol'],
    ['voice', 'auto'],
    ['limits', 'Estimated budget: $5/day']
  ]) {
    await s.handle('/settings')
    await s.callback(s.button(section!))
    await s.callback(s.button(choice!))
  }
  assert.equal(s.ws.thread('a', '1').mode, 'editor')
  assert.equal(s.profiles.get('a').voice, 'auto')
  assert.equal(s.ws.get('a').budget, 5000000)
  await s.handle('/settings')
  await s.callback(s.button('model'))
  await s.callback(s.button('Operator default'))
  await s.handle('/settings')
  await s.callback(s.button('model'))
  await s.callback(s.button('Custom model: /model ID'))
  await s.handle('/model custom-id')
  await s.handle('/model')
  assert.match(s.text.at(-1)!, /custom-id/)
  await s.handle('/model default')
  await assert.rejects(s.handle('/model bad model'))
  await s.handle('/settings')
  await s.callback(s.button('limits'))
  await s.callback(s.button('Disable image'))
  for (const kind of ['search', 'voice']) {
    await s.handle('/settings')
    await s.callback(s.button('limits'))
    await s.callback(s.button(`${kind}: 1/day`))
  }
  await s.handle('/settings')
  await s.callback(s.button('Context review: off'))
  await s.callback(s.button('Context review: on'))
  const project = s.ws.create('a', 'First')
  for (let i = 0; i < 8; i++) s.ws.create('a', `More${i}`)
  await s.handle('/settings')
  await s.callback(s.button('project'))
  await s.callback(s.button('Next page'))
  await s.callback(s.button('Previous page'))
  await s.callback(s.button(`${project.id}: First`))
  await s.handle('/settings')
  await s.callback(s.button('project'))
  await s.callback(s.button('No project'))
  await s.handle('/settings')
  await s.callback(s.button('mode'))
  await s.callback(s.button('Back to settings'))
  const token = s.button('mode').split(':')[1]!
  await assert.rejects(s.callback(`menu:${token}:unknown:x`))
  await assert.rejects(s.callback(`menu:${token}:limit:bad:1`))
  await assert.rejects(s.callback(`menu:${token}:open:project:-1`))
  s.ctx.thread = '2'
  await assert.rejects(s.callback(`menu:${token}:open:home`))
  assert.equal(s.model.calls.length, 0)
  for (const keyboard of s.keyboards)
    for (const item of keyboard.inline_keyboard.flat())
      assert.ok(Buffer.byteLength(item.callback_data) <= 64)
})
void test('branch and revise preserve original turns and copy preferences with rollback on capacity failures', async () => {
  const s = setup()
  await s.handle('/turns')
  assert.match(s.text.at(-1)!, /No retained/)
  await s.conversations.reply('a:1', 'Original')
  await s.conversations.reply('a:1', 'Second')
  s.ws.configure('a', '1', { mode: 'editor' })
  await s.handle('/turns')
  assert.match(s.text.at(-1)!, /2: Second/)
  for (const value of [
    '/branch 0',
    '/branch 5',
    '/revise 1',
    '/revise 1.5 | text'
  ])
    await assert.rejects(s.handle(value))
  await s.handle('/branch 1 | Alternate')
  assert.equal(s.profiles.get('a').active, '2')
  assert.equal(s.conversations.history('a:2').length, 2)
  assert.equal(s.conversations.history('a:1').length, 4)
  s.profiles.switch('a', '1')
  const revised = (await s.handle('/revise 2 | Replacement')) as PreparedRequest
  assert.equal(revised.prompt, 'Replacement')
  assert.equal(revised.history.length, 2)
  assert.equal(s.ws.thread('a', '3').mode, 'editor')
  const limited = setup()
  limited.settings.maxSessions = 1
  await limited.conversations.reply('a:1', 'Original')
  await assert.rejects(limited.handle('/branch 1'))
  assert.equal(limited.profiles.get('a').threads.length, 1)
  assert.equal(limited.profiles.get('a').active, '1')
  const empty = setup()
  await empty.conversations.respond(
    'a:1',
    'Photo',
    [{ mime: 'image/png', data: 'YQ==' }],
    { documents: [{ name: 'a.txt', mime: 'text/plain', data: 'YQ==' }] }
  )
  const result = (await empty.handle('/revise 1 | Retry')) as PreparedRequest
  assert.equal(result.images.length, 1)
  assert.equal(result.documents.length, 1)
})
void test('forward command lifecycle produces untrusted cited excerpts only on explicit summary', async () => {
  const s = setup()
  for (const value of ['/collect', '/collect summarize'])
    await assert.rejects(s.handle(value))
  await s.handle('/collect show')
  assert.match(s.text.at(-1)!, /No collected/)
  await s.handle('/collect on')
  assert.equal(s.data.get('a').collecting['1'], true)
  s.data.collect('a', '1', 1, 'We agreed to ship on Friday')
  await s.handle('/collect show')
  assert.match(s.text.at(-1)!, /\[F1\]/)
  const summary = (await s.handle(
    '/collect summarize risks'
  )) as PreparedRequest
  assert.match(summary.references, /Friday/)
  assert.match(summary.prompt, /risks/)
  assert.equal(summary.analysisOnly, true)
  await s.handle('/collect off')
  await s.handle('/collect clear')
})
void test('project library commands retrieve locally before grounded analysis and reject missing references', async () => {
  const s = setup()
  await assert.rejects(s.handle('/library'))
  const project = s.ws.create('a', 'Research')
  s.ws.configure('a', '1', { project: project.id })
  await s.handle('/library')
  await s.handle('/library list')
  assert.match(s.text.at(-1)!, /No indexed/)
  for (const value of ['/library nonsense', '/library add', '/ask unknown'])
    await assert.rejects(s.handle(value))
  s.reply({ name: 'terms.pdf', mime: 'application/pdf', data: 'YQ==' })
  await s.handle('/library add')
  await s.handle('/library list')
  assert.match(s.text.at(-1)!, /terms.pdf/)
  await s.handle('/library find payment')
  assert.match(s.text.at(-1)!, /page 1/)
  await s.handle('/library find absent')
  assert.equal(s.text.at(-1), 'No matching passages.')
  const answer = (await s.handle('/ask payment')) as PreparedRequest
  assert.match(answer.references, /\[L1\]/)
  assert.equal(answer.analysisOnly, true)
  const id = s.library.get('a')[0]!.id
  await s.handle(`/library remove ${id}`)
  assert.equal(s.model.calls.length, 0)
})
void test('context controls inspect and exclude snapshots, cancel and reject stale, missing or invalid pages', async () => {
  const s = setup()
  for (const value of ['/context', '/context show 0'])
    await assert.rejects(s.handle(value))
  await s.handle('/context on')
  await s.handle('/context off')
  await s.handle('/context Ask a question')
  let draft = s.data.get('a').draft!
  await assert.rejects(s.handle('/context show 9'))
  await s.callback(`context:${draft.token}:page:0`)
  await assert.rejects(s.callback(`context:${draft.token}:page:-1`))
  await assert.rejects(s.callback(`context:${draft.token}:unknown`))
  await s.callback(`context:${draft.token}:cancel`)
  assert.equal(s.data.get('a').draft, null)
  const prepared = s.ctx.prepare('Inspect')
  prepared.memories = ['Private note']
  prepared.instructions = 'Instructions'
  prepared.references = '[L1] Evidence'
  prepared.history = [
    {
      role: 'user',
      content: 'Earlier',
      documents: [{ name: 'x', mime: 'x', data: 'YQ==' }]
    },
    {
      role: 'assistant',
      content: 'Reply',
      images: [{ mime: 'image/png', data: 'YQ==' }]
    }
  ]
  prepared.images = [{ mime: 'image/png', data: 'YQ==' }]
  prepared.documents = [{ name: 'a.txt', mime: 'text/plain', data: 'YQ==' }]
  for (let i = 0; i < 8; i++) prepared.memories.push(`Extra${i}`)
  await s.commands.review(s.ctx, prepared)
  draft = s.data.get('a').draft!
  for (const part of draft.parts) await s.handle(`/context show ${part.id}`)
  await s.callback(`context:${draft.token}:toggle:0:0`)
  await s.callback(`context:${draft.token}:page:1`)
  const result = (await s.callback(
    `context:${draft.token}:send`
  )) as PreparedRequest
  assert.equal(result.history.length, 0)
  assert.equal(result.documents.length, 2)
  await s.handle('/feedback')
  assert.match(s.text.at(-1)!, /No feedback/)
  s.data.feedback('a', '1', 'id', 'up', 'helpful')
  await s.handle('/feedback')
  assert.match(s.text.at(-1)!, /helpful/)
  await s.handle('/context Stale')
  await s.conversations.reply('a:1', 'Change')
  await assert.rejects(s.handle('/context show 0'))
})
