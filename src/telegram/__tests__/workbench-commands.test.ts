import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WorkbenchCommands,
  type WorkbenchContext
} from '../workbench-commands.js'
import { Workbench } from '../../application/workbench.js'
import { Workspaces } from '../../application/workspaces.js'
import { Conversations } from '../../application/conversations.js'
import { config, FakeModel, MemoryStateStore } from '../../__tests__/helpers.js'
import { FakeWorkbench } from '../../__tests__/workbench.js'
import type { Document } from '../../domain/conversation.js'
import type { Recording, ToolApproval } from '../../domain/workbench.js'
import type { Keyboard } from '../productivity-commands.js'
import type { PreparedRequest } from '../../domain/productivity.js'
function setup(enabled = true) {
  const settings = config(),
    store = new MemoryStateStore(),
    ws = new Workspaces(settings, store),
    provider = new FakeWorkbench(),
    data = new Workbench(settings, ws, enabled ? provider : undefined, store),
    chat = new Conversations(new FakeModel(), settings)
  const text: string[] = [],
    keys: Keyboard[] = [],
    files: string[] = [],
    urls: string[] = []
  let document: Document | undefined = {
      name: 'data.csv',
      mime: 'text/csv',
      data: Buffer.from('a,b\n1,2').toString('base64')
    },
    recording: Recording | undefined = {
      file: 'audio',
      name: 'meeting.ogg',
      mime: 'audio/ogg',
      bytes: 10,
      seconds: 60
    }
  const ctx: WorkbenchContext = {
    owner: '42:42',
    thread: '1',
    signal: new AbortController().signal,
    text: (value, key) => {
      text.push(value)
      if (key) keys.push(key)
      return Promise.resolve()
    },
    file: (_bytes, name) => {
      files.push(name)
      return Promise.resolve()
    },
    prepare: prompt => ({
      prompt,
      images: [],
      documents: [],
      memories: [],
      instructions: '',
      references: '',
      history: [],
      analysisOnly: false
    }),
    document: () => Promise.resolve(document),
    recording: () => recording,
    transcribe: () => Promise.resolve(provider.transcript),
    liveButton: url => {
      urls.push(url)
      return Promise.resolve()
    }
  }
  const commands = new WorkbenchCommands(data, ws, chat, settings)
  return {
    settings,
    ws,
    provider,
    data,
    chat,
    ctx,
    commands,
    text,
    keys,
    files,
    urls,
    document: (value: Document | undefined) => {
      document = value
    },
    recording: (value: Recording | undefined) => {
      recording = value
    },
    token: () => keys.at(-1)!.inline_keyboard[0]![0]!.callback_data
  }
}
void test('provider navigation explains setup and scopes authenticated connections without exposing credentials', async () => {
  for (const enabled of [true, false]) {
    const s = setup(enabled)
    assert.equal(await s.commands.handle(s.ctx, 'hello'), false)
    await s.commands.handle(s.ctx, '/pro')
    await s.commands.handle(s.ctx, '/live')
    assert.match(s.text.join(' '), /configured/)
  }
  const s = setup()
  s.settings.workbench.miniAppURL = 'https://voice.example.com'
  await s.commands.handle(s.ctx, '/live')
  assert.equal(s.urls.length, 1)
  await s.commands.handle(s.ctx, '/connections')
  assert.match(s.text.at(-1)!, /No external services/)
  s.settings.workbench.connections = [
    {
      id: 'mail',
      owner: 42,
      title: 'Mail',
      tools: ['search'],
      server: 'https://mcp.example.com',
      authorization: 'secret'
    },
    {
      id: 'other',
      owner: 43,
      title: 'Other',
      tools: ['search'],
      server: 'https://other.example.com',
      authorization: 'other-secret'
    }
  ]
  await s.commands.handle(s.ctx, '/connections')
  assert.match(s.text.at(-1)!, /Mail/)
  assert.ok(!s.text.at(-1)!.includes('secret'))
  assert.ok(!s.text.at(-1)!.includes('Other'))
  for (const arg of ['', 'mail', '| request', 'mail |'])
    await assert.rejects(s.commands.handle(s.ctx, `/connect ${arg}`), /Usage/)
  const request = (await s.commands.handle(
    s.ctx,
    '/connect mail | Find draft'
  )) as PreparedRequest
  assert.deepEqual(request.workbench, {
    kind: 'connection',
    connection: 'mail',
    project: null
  })
  assert.deepEqual(request.documents, [])
  await assert.rejects(s.commands.handle(s.ctx, '/connect other | Search'))
  await s.commands.handle(s.ctx, '/cloud_cleanup')
  assert.match(s.text.at(-1)!, /No tracked/)
  await assert.rejects(s.commands.handle(s.ctx, '/cloud_cleanup bad'))
  s.data.journal.remember(s.ctx.owner, { kind: 'file', id: 'f1' })
  s.data.journal.remember(s.ctx.owner, { kind: 'store', id: 's1' }, true)
  await s.commands.handle(s.ctx, '/cloud_cleanup retry')
  assert.match(s.text.at(-1)!, /cleanup queued/)
  assert.match(s.text.at(-1)!, /referenced/)
})
void test('analysis and semantic library commands prepare only explicit reviewed requests and cleanup detaches locally', async () => {
  const s = setup()
  await assert.rejects(
    s.commands.handle(s.ctx, '/knowledge'),
    /Select a project/
  )
  s.document(undefined)
  await assert.rejects(s.commands.handle(s.ctx, '/analyze'), /Attach or reply/)
  const project = s.ws.create(s.ctx.owner, 'Work')
  s.ws.configure(s.ctx.owner, s.ctx.thread, { project: project.id })
  await s.commands.handle(s.ctx, '/knowledge')
  assert.match(s.text.at(-1)!, /separate/)
  await assert.rejects(s.commands.handle(s.ctx, '/knowledge add'), /Reply/)
  s.document({
    name: 'data.csv',
    mime: 'text/csv',
    data: Buffer.from('a').toString('base64')
  })
  const analysis = (await s.commands.handle(
    s.ctx,
    '/analyze totals'
  )) as PreparedRequest
  assert.equal(analysis.prompt, 'totals')
  assert.equal(analysis.documents.length, 1)
  assert.equal(analysis.analysisOnly, true)
  const index = (await s.commands.handle(
    s.ctx,
    '/knowledge add'
  )) as PreparedRequest
  await s.data.run(
    [{ role: 'user', content: index.prompt, documents: index.documents }],
    {
      scope: { owner: s.ctx.owner, thread: s.ctx.thread, project: project.id },
      workbench: index.workbench!
    }
  )
  await s.commands.handle(s.ctx, '/knowledge status')
  assert.match(s.text.at(-1)!, /data.csv/)
  const query = (await s.commands.handle(
    s.ctx,
    '/knowledge ask What is this?'
  )) as PreparedRequest
  assert.equal(query.workbench!.kind, 'knowledge')
  assert.deepEqual(query.documents, [])
  for (const arg of ['ask', 'ask  ', 'remove x', 'clear', 'unknown'])
    await assert.rejects(s.commands.handle(s.ctx, `/knowledge ${arg}`))
  const id = s.data.get(s.ctx.owner).projects[project.id]!.files[0]!.id
  await s.commands.handle(s.ctx, `/knowledge remove ${id} confirm`)
  assert.match(s.text.at(-1)!, /detached/)
  await s.commands.handle(s.ctx, '/knowledge clear confirm')
  assert.match(s.text.at(-1)!, /detached locally/)
})
void test('MCP approvals and meeting recordings are single-use, owner-bound and independently reviewed', async () => {
  const s = setup(),
    approval: ToolApproval = {
      connection: 'mail',
      continuation: 'private-state',
      calls: [{ id: 'a1', name: 'search', arguments: '{"query":"draft"}' }]
    }
  assert.equal(await s.commands.callback(s.ctx, 'other'), false)
  await assert.rejects(s.commands.callback(s.ctx, 'provider:unknown:x'))
  await s.commands.approval(s.ctx, approval)
  const rejected = s.token().replace(':approve:', ':reject:')
  assert.equal(await s.commands.callback(s.ctx, rejected), true)
  await assert.rejects(s.commands.callback(s.ctx, rejected))
  await s.commands.approval(s.ctx, approval)
  const prepared = (await s.commands.callback(
    s.ctx,
    s.token()
  )) as PreparedRequest
  assert.equal(prepared.workbench!.kind, 'connection')
  assert.deepEqual(prepared.memories, [])
  assert.equal(prepared.references, '')
  await assert.rejects(s.commands.handle(s.ctx, '/meeting bad'))
  s.recording(undefined)
  await assert.rejects(s.commands.handle(s.ctx, '/meeting'), /Reply/)
  s.recording({
    file: 'audio',
    name: 'meeting.ogg',
    mime: 'audio/ogg',
    bytes: null,
    seconds: null
  })
  await s.commands.handle(s.ctx, '/meeting')
  assert.match(s.text.at(-1)!, /unknown/)
  const meeting = (await s.commands.callback(
    s.ctx,
    s.token()
  )) as PreparedRequest
  assert.equal(meeting.reviewTasks, true)
  assert.deepEqual(meeting.structured!.fields, ['summary', 'task', 'due'])
  assert.equal(s.files.at(-1), 'meeting-transcript.txt')
  assert.match(meeting.references, /do not infer/)
  await assert.rejects(s.commands.callback(s.ctx, s.token()))
  s.settings.workbench.diarizationModel = 'legacy-model'
  s.provider.transcript = {
    text: 'Hi',
    speakers: true,
    segments: [{ speaker: 'A\nB', text: 'Hi', start: 0, end: 1 }]
  }
  s.recording({
    file: 'audio',
    name: 'meeting.ogg',
    mime: 'audio/ogg',
    bytes: 5,
    seconds: 60
  })
  await s.commands.handle(s.ctx, '/meeting speakers')
  const diarized = (await s.commands.callback(
    s.ctx,
    s.token()
  )) as PreparedRequest
  assert.match(
    Buffer.from(diarized.documents[0]!.data, 'base64').toString(),
    /A B: Hi/
  )
  assert.match(diarized.references, /not verified/)
})
void test('analysis includes retained files and cleanup retry preserves an unexpired live session', async () => {
  const s = setup()
  await s.chat.respond('42:42:1', 'Earlier', [], {
    documents: [{ name: 'ref.pdf', mime: 'application/pdf', data: 'JVBERg==' }]
  })
  s.document(undefined)
  const request = (await s.commands.handle(
    s.ctx,
    '/analyze'
  )) as PreparedRequest
  assert.ok(request.documents.length)
  s.data.journal.remember(
    s.ctx.owner,
    { kind: 'call', id: 'live' },
    false,
    Date.now() + 60000
  )
  s.data.journal.remember(s.ctx.owner, { kind: 'call', id: 'due' }, false, 0)
  await s.commands.handle(s.ctx, '/cloud_cleanup retry')
  assert.ok(
    s.data.journal.entries(s.ctx.owner).find(item => item.id === 'live')!
      .nextAttempt > Date.now()
  )
  assert.equal(
    s.data.journal.entries(s.ctx.owner).find(item => item.id === 'due')!
      .nextAttempt,
    0
  )
})
