import { test } from 'node:test'
import assert from 'node:assert/strict'
import OpenAI from 'openai'
import {
  OpenAIWorkbench,
  artifactName,
  completedText,
  providerBytes
} from '../openai-workbench.js'
import { config } from '../../__tests__/helpers.js'
import type { Response as ModelResponse } from 'openai/resources/responses/responses.js'
const file = {
  name: 'sales.csv',
  mime: 'text/csv',
  data: Buffer.from('name,total\nA,10').toString('base64')
}
const message = (text = 'Computed total: 10', annotations: unknown[] = []) => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations }]
})
const complete = (output: unknown[]) => ({
  id: 'resp_test',
  object: 'response',
  status: 'completed',
  output
})
const citation = (
  id = 'cfile_1',
  container = 'cnt_1',
  filename = 'result.csv'
) => ({
  type: 'container_file_citation',
  file_id: id,
  container_id: container,
  filename,
  start_index: 0,
  end_index: 1
})
function setup() {
  const settings = config(),
    calls: { path: string; method: string; body: unknown }[] = []
  const fixture = {
    response: complete([
      {
        type: 'code_interpreter_call',
        id: 'ci',
        container_id: 'cnt_1',
        status: 'completed',
        outputs: [],
        code: 'print(10)'
      },
      message('Computed total: 10', [citation()])
    ]),
    transcript: {
      text: 'Meeting transcript',
      segments: [{ speaker: 'A', text: 'Agreed work', start: 0, end: 2 }]
    },
    status: 'completed',
    binary: 'name,total\nA,10',
    location: '/v1/realtime/calls/rtc_1',
    sdp: 'v=0\r\nanswer',
    failure: 0
  }
  const client = new OpenAI({
    apiKey: 'test-key',
    maxRetries: 0,
    fetch: (url, init) => {
      const parsed = new URL(url instanceof Request ? url.url : String(url)),
        path = parsed.pathname,
        method = init?.method ?? 'GET',
        body =
          init?.body instanceof FormData
            ? init.body
            : typeof init?.body === 'string'
              ? (JSON.parse(init.body) as unknown)
              : null
      calls.push({ path, method, body })
      if (fixture.failure)
        return Promise.resolve(
          new Response('{"error":{"message":"private-provider-error"}}', {
            status: fixture.failure,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      const json = (value: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(value), {
            headers: { 'Content-Type': 'application/json' }
          })
        )
      if (path === '/v1/files' && method === 'POST')
        return json({ id: 'file_1' })
      if (path === '/v1/containers' && method === 'POST')
        return json({ id: 'cnt_1' })
      if (path === '/v1/responses') return json(fixture.response)
      if (path.endsWith('/content'))
        return Promise.resolve(new Response(fixture.binary))
      if (path === '/v1/vector_stores' && method === 'POST')
        return json({ id: 'vs_1' })
      if (path === '/v1/vector_stores/vs_1/search')
        return json({
          object: 'list',
          data: [
            {
              file_id: 'file_1',
              filename: 'Sales',
              score: 0.9,
              content: [{ type: 'text', text: 'Total 10' }]
            }
          ],
          has_more: false
        })
      if (
        path === '/v1/vector_stores/vs_1/files' ||
        path === '/v1/vector_stores/vs_1/files/file_1'
      )
        return json({ id: 'file_1', status: fixture.status })
      if (path === '/v1/audio/transcriptions') return json(fixture.transcript)
      if (path === '/v1/realtime/calls' && method === 'POST')
        return Promise.resolve(
          new Response(fixture.sdp, {
            status: 201,
            headers: { Location: fixture.location }
          })
        )
      return json({ deleted: true })
    }
  })
  return {
    settings,
    calls,
    fixture,
    provider: new OpenAIWorkbench(client, settings)
  }
}
void test('analysis uploads expiring files, disables sandbox networking and returns bounded generated artifacts using the real SDK with a fake transport', async () => {
  const s = setup(),
    signal = new AbortController().signal
  assert.equal(await s.provider.upload(file, signal, 604800), 'file_1')
  const uploaded = s.calls.at(-1)!.body as FormData
  assert.equal(uploaded.get('purpose'), 'user_data')
  assert.equal(uploaded.get('expires_after[seconds]'), '604800')
  await assert.rejects(s.provider.upload({ ...file, data: '' }))
  s.settings.maxDocumentBytes = 1
  await assert.rejects(s.provider.upload(file))
  s.settings.maxDocumentBytes = 10000000
  assert.equal(await s.provider.container(['file_1'], signal), 'cnt_1')
  assert.deepEqual(
    (s.calls.at(-1)!.body as Record<string, unknown>).network_policy,
    { type: 'disabled' }
  )
  const result = await s.provider.analysis('cnt_1', 'Analyze', {
    signal,
    instructions: 'Be concise',
    references: 'Reference',
    summary: 'Recap',
    memories: ['Note']
  })
  assert.equal(result.files![0]!.name, 'result.csv')
  assert.equal(result.images.length, 0)
  s.fixture.response.output.push({
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'refusal', refusal: 'No' }]
  })
  await s.provider.analysis('cnt_1', 'Analyze', {})
  const body = s.calls.find(call => call.path === '/v1/responses')!
    .body as Record<string, unknown>
  assert.equal(body.store, false)
  assert.deepEqual(body.tools, [
    { type: 'code_interpreter', container: 'cnt_1' }
  ])
  assert.equal(body.max_tool_calls, 3)
  assert.match(String(body.input), /Reference/)
  s.fixture.response = complete([
    {
      type: 'code_interpreter_call',
      id: 'ci',
      container_id: 'cnt_1',
      status: 'completed'
    },
    message('', [citation(), citation()])
  ])
  assert.equal(
    (await s.provider.analysis('cnt_1', 'Analyze', {})).text,
    'Analysis files are ready.'
  )
  for (const output of [
    [message('No Python')],
    [
      {
        type: 'code_interpreter_call',
        container_id: 'other',
        status: 'completed'
      },
      message('Wrong')
    ],
    [
      {
        type: 'code_interpreter_call',
        container_id: 'cnt_1',
        status: 'failed'
      },
      message('Failed')
    ],
    [
      {
        type: 'code_interpreter_call',
        container_id: 'cnt_1',
        status: 'completed'
      },
      message('', [])
    ],
    [
      {
        type: 'code_interpreter_call',
        container_id: 'cnt_1',
        status: 'completed'
      },
      message(
        'Too many',
        Array.from({ length: 6 }, (_, i) => citation(`file_${i}`))
      )
    ],
    [
      {
        type: 'code_interpreter_call',
        container_id: 'cnt_1',
        status: 'completed'
      },
      message('Foreign', [citation('file', 'foreign')])
    ]
  ]) {
    s.fixture.response = complete(output)
    await assert.rejects(s.provider.analysis('cnt_1', 'Analyze', {}))
  }
  s.fixture.response = complete([
    {
      type: 'code_interpreter_call',
      container_id: 'cnt_1',
      status: 'completed'
    },
    message('Large', [citation()])
  ])
  s.settings.maxExportBytes = 1
  await assert.rejects(s.provider.analysis('cnt_1', 'Analyze', {}))
})
void test('provider download and filename guards reject empty, oversized, failed or unsupported output without executing it', async () => {
  assert.deepEqual(artifactName('../../report.xlsx'), {
    name: 'report.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  for (const extension of ['csv', 'json', 'png', 'pdf', 'txt', 'md'])
    assert.ok(artifactName(`file.${extension}`).mime)
  assert.throws(() => artifactName('program.exe'))
  assert.equal(
    completedText(
      complete([
        message('Text filecite'),
        { type: 'reasoning', summary: [] }
      ]) as ModelResponse
    ),
    'Text'
  )
  assert.equal(
    completedText(
      complete([
        { type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }
      ]) as ModelResponse
    ),
    ''
  )
  assert.throws(() => completedText({ status: 'incomplete' } as ModelResponse))
  for (const response of [
    new Response('error', { status: 500 }),
    new Response(null),
    new Response(''),
    new Response('abc', { headers: { 'content-length': '10' } }),
    new Response('abc')
  ])
    await assert.rejects(providerBytes(response, 2))
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
    },
    cancel() {
      throw new Error('Cancel failure')
    }
  })
  await assert.rejects(providerBytes(new Response(body), 1))
  assert.deepEqual(
    [...(await providerBytes(new Response(new Uint8Array([1, 2])), 10))],
    [1, 2]
  )
})
void test('semantic library SDK calls isolate vector stores and return quoted evidence with tools disabled for grounded generation', async () => {
  const s = setup(),
    signal = new AbortController().signal
  assert.equal(await s.provider.createStore(signal), 'vs_1')
  assert.deepEqual(
    (s.calls.at(-1)!.body as Record<string, unknown>).expires_after,
    { anchor: 'last_active_at', days: 7 }
  )
  for (const [status, expected] of [
    ['completed', 'completed'],
    ['in_progress', 'indexing'],
    ['failed', 'failed']
  ]) {
    s.fixture.status = status!
    assert.equal(await s.provider.attach('vs_1', 'file_1', signal), expected)
    assert.equal(
      await s.provider.fileStatus('vs_1', 'file_1', signal),
      expected
    )
  }
  const hits = await s.provider.search('vs_1', 'refund policy', signal)
  assert.equal(hits[0]!.file, 'file_1')
  assert.equal(hits[0]!.text, 'Total 10')
  const search = s.calls.at(-1)!.body as Record<string, unknown>
  assert.equal(search.rewrite_query, true)
  assert.equal(search.max_num_results, 5)
  const evidence = [{ label: 'K1', title: 'Sales', text: 'Total 10' }]
  s.fixture.response = complete([message('The total is 10 [K1]')])
  const result = await s.provider.grounded(
    [{ role: 'user', content: 'What is the total?' }],
    evidence,
    {
      signal,
      instructions: 'English',
      memories: ['Note'],
      references: 'Reference',
      summary: 'Recap',
      chatModel: 'custom'
    }
  )
  assert.deepEqual(result.evidence, evidence)
  assert.equal(
    (s.calls.at(-1)!.body as Record<string, unknown>).model,
    'custom'
  )
  assert.deepEqual((s.calls.at(-1)!.body as Record<string, unknown>).tools, [])
  s.fixture.response = complete([
    {
      type: 'message',
      id: 'm1',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'refusal', refusal: 'No' }]
    }
  ])
  await assert.rejects(s.provider.analysis('cnt_1', 'Analyze', {}))
  s.fixture.response = complete([])
  await assert.rejects(s.provider.grounded([], evidence, {}))
})
void test('MCP requests always require scoped approvals, preserve stateless continuation and reject changed configuration or credentials in captured output', async () => {
  const s = setup(),
    connection = {
      id: 'mail',
      owner: 42,
      title: 'Mail',
      server: 'https://mcp.example.com',
      authorization: 'protected-token',
      tools: ['search']
    }
  const call = {
    type: 'mcp_approval_request',
    id: 'approval_1',
    server_label: 'mail',
    name: 'search',
    arguments: '{"query":"draft"}'
  }
  s.fixture.response = complete([
    message('Review'),
    { type: 'reasoning', id: 'r1', summary: [] },
    { type: 'mcp_list_tools', id: 'tools1', server_label: 'mail', tools: [] },
    call
  ])
  const initial = await s.provider.connection(
    connection,
    [{ role: 'user', content: 'Find draft' }],
    {}
  )
  assert.equal(initial.approval!.calls.length, 1)
  const emptyReview = setup()
  emptyReview.fixture.response = complete([call])
  assert.match(
    (await emptyReview.provider.connection(connection, [], {})).text,
    /approval is required/
  )
  const body = s.calls.at(-1)!.body as Record<string, unknown>,
    tool = (body.tools as Record<string, unknown>[])[0]!
  assert.equal(tool.require_approval, 'always')
  assert.deepEqual(tool.allowed_tools, ['search'])
  assert.equal(
    JSON.stringify(initial).includes(connection.authorization),
    false
  )
  s.fixture.response = complete([
    {
      type: 'mcp_call',
      name: 'search',
      server_label: 'mail',
      error: null,
      output: 'Found'
    },
    message('Found draft')
  ])
  await s.provider.connection(
    connection,
    [],
    { instructions: 'Concise' },
    initial.approval!.continuation
  )
  const continued = (
    s.calls.at(-1)!.body as { input: Record<string, unknown>[] }
  ).input
  assert.ok(
    continued.some(
      item => item.type === 'mcp_approval_response' && item.approve === true
    )
  )
  await assert.rejects(
    s.provider.connection(
      { ...connection, server: 'https://changed.example.com' },
      [],
      {},
      initial.approval!.continuation
    ),
    /changed/
  )
  for (const output of [
    [{ ...call, server_label: 'foreign' }],
    [{ ...call, name: 'send_email' }],
    [{ ...call, arguments: 'x'.repeat(12001) }],
    Array.from({ length: 4 }, () => call),
    [{ type: 'mcp_call', error: 'Denied' }, message('Error')],
    [call, message(connection.authorization)],
    [call, message('x'.repeat(200001))],
    []
  ]) {
    s.fixture.response = complete(output)
    await assert.rejects(s.provider.connection(connection, [], {}))
  }
  s.fixture.response = complete([call, message('Review this request')])
  assert.equal(
    (
      await s.provider.connection(connection, [], {
        summary: 'Recap',
        memories: ['Note'],
        references: 'Ref'
      })
    ).text,
    'Review this request'
  )
})
void test('recorded meetings use the current ordinary workflow and opt-in speaker labeling with bounded validated segments', async () => {
  const s = setup(),
    bytes = new Uint8Array([1, 2]),
    signal = new AbortController().signal
  const transcript = await s.provider.meeting(
    bytes,
    'recording.mp3',
    'audio/mpeg',
    false,
    signal
  )
  assert.equal(transcript.speakers, false)
  assert.equal(transcript.text, 'Meeting transcript')
  await assert.rejects(
    s.provider.meeting(bytes, 'recording.mp3', 'audio/mpeg', true)
  )
  s.settings.workbench.diarizationModel = 'configured-speaker-model'
  assert.equal(
    (
      await s.provider.meeting(
        bytes,
        'recording.mp3',
        'audio/mpeg',
        true,
        signal
      )
    ).segments[0]!.speaker,
    'A'
  )
  const good = { speaker: 'A', text: 'Agreed', start: 0, end: 1 }
  for (const segment of [
    null,
    [],
    { ...good, speaker: 1 },
    { ...good, speaker: '' },
    { ...good, speaker: 'x'.repeat(81) },
    { ...good, text: 1 },
    { ...good, text: 'x'.repeat(6001) },
    { ...good, start: '0' },
    { ...good, end: '1' },
    { ...good, start: Infinity },
    { ...good, end: Infinity },
    { ...good, start: -1 },
    { ...good, end: -1 },
    { ...good, end: 7201 }
  ]) {
    s.fixture.transcript = {
      text: 'Transcript',
      segments: [segment]
    } as typeof s.fixture.transcript
    await assert.rejects(s.provider.meeting(bytes, 'r.mp3', 'audio/mpeg', true))
  }
  for (const value of [
    { text: ' ', segments: [] },
    { text: 'x'.repeat(60001), segments: [] },
    { text: 'ok', segments: Array(1001).fill(good) },
    {
      text: 'ok',
      segments: Array(11).fill({ ...good, text: 'x'.repeat(6000) })
    },
    { text: 'ok' }
  ]) {
    s.fixture.transcript = value as typeof s.fixture.transcript
    await assert.rejects(s.provider.meeting(bytes, 'r.mp3', 'audio/mpeg', true))
  }
  s.fixture.transcript = { text: '', segments: [] }
  await assert.rejects(s.provider.meeting(bytes, 'r.mp3', 'audio/mpeg', false))
})
void test('live SDP stays server-authenticated and provider-resource deletion treats only missing resources as already deleted', async () => {
  const s = setup(),
    signal = new AbortController().signal
  const call = await s.provider.live('v=0\r\noffer', 'Practice English', signal)
  assert.equal(call.id, 'rtc_1')
  assert.ok(call.sdp.startsWith('v=0'))
  const live = s.calls.at(-1)!.body as FormData
  assert.ok(live instanceof FormData)
  const session = JSON.parse(
    await (live.get('session') as File).text()
  ) as Record<string, unknown>
  assert.deepEqual(session.tools, [])
  assert.equal(session.tool_choice, 'none')
  assert.equal(session.tracing, null)
  s.fixture.location = ''
  await assert.rejects(s.provider.live('v=0', 'Instructions'))
  s.fixture.location = '/v1/realtime/calls/invalid?query'
  await assert.rejects(s.provider.live('v=0', 'Instructions'))
  s.fixture.location = '/v1/realtime/calls/rtc_1'
  s.fixture.sdp = 'invalid'
  await assert.rejects(s.provider.live('v=0', 'Instructions'))
  for (const kind of ['file', 'store', 'container', 'call'] as const)
    await s.provider.remove({ kind, id: 'test' })
  s.fixture.failure = 404
  await s.provider.remove({ kind: 'file', id: 'missing' })
  s.fixture.failure = 500
  await assert.rejects(s.provider.remove({ kind: 'file', id: 'failed' }))
})
