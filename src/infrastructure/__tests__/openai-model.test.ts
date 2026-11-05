import { test } from 'node:test'
import assert from 'node:assert/strict'
import OpenAI from 'openai'
import { OpenAIModel } from '../openai-model.js'
import { config } from '../../__tests__/helpers.js'

function modelWith(fetcher: typeof fetch) {
  return new OpenAIModel(
    new OpenAI({ apiKey: 'fake-key', fetch: fetcher, maxRetries: 0 }),
    config()
  )
}
void test('actual SDK sends stateless Responses request with bounded output', async () => {
  const model = modelWith((_url, init) => {
    assert.equal(typeof init?.body, 'string')
    const body: unknown = JSON.parse(init?.body as string)
    assert.ok(
      (body as { instructions: string }).instructions.includes(
        'selected source'
      )
    )
    const { instructions: _instructions, ...request } = body as Record<
      string,
      unknown
    >
    void _instructions
    assert.deepEqual(request, {
      model: 'test-model',
      input: [{ role: 'user', content: 'hi' }],
      max_output_tokens: 2000,
      store: false,
      tools: [
        {
          type: 'image_generation',
          model: 'gpt-image-2.5-sunburst',
          quality: 'high',
          size: 'auto',
          output_format: 'png',
          action: 'auto'
        },
        { type: 'web_search' }
      ],
      max_tool_calls: 3
    })
    return Promise.resolve(
      Response.json({
        object: 'response',
        id: 'resp_test',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'hello', annotations: [] }]
          }
        ]
      })
    )
  })
  assert.deepEqual(await model.reply([{ role: 'user', content: 'hi' }]), {
    text: 'hello',
    images: [],
    toolsUsed: { images: 0, searches: 0 }
  })
})
void test('incomplete and empty responses are rejected', async () => {
  for (const status of ['incomplete', 'completed']) {
    const model = modelWith(() =>
      Promise.resolve(Response.json({ status, output: [] }))
    )
    await assert.rejects(model.reply([]), /Incomplete/)
  }
})
void test('OGG audio is uploaded through the SDK without temporary files', async () => {
  const model = modelWith(async (_url, init) => {
    assert.ok(init?.body instanceof FormData)
    const file = init.body.get('file')
    assert.ok(file instanceof File)
    assert.equal(file.name, 'voice.ogg')
    assert.equal(file.type, 'audio/ogg')
    assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2])
    return Response.json({ text: 'transcribed' })
  })
  assert.equal(await model.transcribe(new Uint8Array([1, 2])), 'transcribed')
})
void test('empty transcriptions and provider failures are rejected', async () => {
  await assert.rejects(
    modelWith(() => Promise.resolve(Response.json({ text: ' ' }))).transcribe(
      new Uint8Array([1])
    )
  )
  await assert.rejects(
    modelWith(() =>
      Promise.resolve(
        Response.json({ error: { message: 'denied' } }, { status: 401 })
      )
    ).reply([])
  )
})

void test('SDK sends inline references and forced edit; image-only results are accepted', async () => {
  const image = { data: 'iVBORw0KGgo=', mime: 'image/png' as const }
  const model = modelWith((_url, init) => {
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    assert.deepEqual(body.input, [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Previously generated image. Assistant text: done'
          },
          {
            type: 'input_image',
            image_url: `data:image/png;base64,${image.data}`,
            detail: 'auto'
          }
        ]
      },
      { role: 'user', content: 'Make it warmer' }
    ])
    assert.deepEqual(body.tool_choice, { type: 'image_generation' })
    assert.equal((body.tools as { action: string }[])[0]?.action, 'edit')
    assert.equal(body.store, false)
    assert.equal(body.max_tool_calls, 1)
    return Promise.resolve(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'image_generation_call',
            id: 'ig_1',
            status: 'completed',
            result: image.data
          }
        ]
      })
    )
  })
  assert.deepEqual(
    await model.reply(
      [
        { role: 'assistant', content: 'done', images: [image] },
        { role: 'user', content: 'Make it warmer' }
      ],
      { action: 'edit' }
    ),
    { text: '', images: [image], toolsUsed: { images: 1, searches: 0 } }
  )
})

void test('invalid, incomplete, oversized and excessive generated outputs are rejected', async () => {
  const valid = {
    type: 'image_generation_call',
    id: 'ig_1',
    status: 'completed',
    result: 'iVBORw0KGgo='
  }
  for (const output of [
    [{ ...valid, result: 'not base64' }],
    [{ ...valid, result: Buffer.from('not an image').toString('base64') }],
    [{ ...valid, status: 'failed' }],
    [{ ...valid, result: 'A'.repeat(13333340) }],
    [valid, valid]
  ]) {
    const model = modelWith(() =>
      Promise.resolve(Response.json({ status: 'completed', output }))
    )
    await assert.rejects(
      model.reply([{ role: 'user', content: 'Generate image' }], {
        action: 'generate'
      })
    )
  }
})

void test('SDK forces web search and preserves numbered citation metadata', async () => {
  const model = modelWith((_url, init) => {
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    assert.deepEqual(body.tools, [{ type: 'web_search' }])
    assert.equal(body.tool_choice, 'required')
    assert.equal(body.max_tool_calls, 3)
    assert.deepEqual(body.input, [
      {
        role: 'user',
        content:
          'Saved user notes (user-provided preferences): ["Answer in English"]'
      },
      { role: 'user', content: 'Latest release?' }
    ])
    return Promise.resolve(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'New release.',
                annotations: [
                  {
                    type: 'url_citation',
                    title: 'Official release',
                    url: 'https://example.com/release',
                    start_index: 0,
                    end_index: 12
                  },
                  {
                    type: 'url_citation',
                    title: 'Unsafe',
                    url: 'javascript:alert(1)',
                    start_index: 0,
                    end_index: 12
                  }
                ]
              }
            ]
          }
        ]
      })
    )
  })
  assert.deepEqual(
    await model.reply([{ role: 'user', content: 'Latest release?' }], {
      search: true,
      memories: ['Answer in English']
    }),
    {
      text: 'New release. [1]',
      images: [],
      toolsUsed: { images: 0, searches: 0 },
      sources: [
        { title: 'Official release', url: 'https://example.com/release' }
      ]
    }
  )
})

void test('SDK sends documents inline alongside images for follow-up questions', async () => {
  const model = modelWith((_url, init) => {
    const body = JSON.parse(init?.body as string) as { input: unknown[] }
    assert.deepEqual(body.input, [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Summarize' },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,iVBORw0KGgo=',
            detail: 'auto'
          },
          {
            type: 'input_file',
            filename: 'test.pdf',
            file_data: 'data:application/pdf;base64,JVBERi0='
          }
        ]
      }
    ])
    return Promise.resolve(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Summary', annotations: [] }]
          }
        ]
      })
    )
  })
  await model.reply([
    {
      role: 'user',
      content: 'Summarize',
      images: [{ mime: 'image/png', data: 'iVBORw0KGgo=' }],
      documents: [
        { name: 'test.pdf', mime: 'application/pdf', data: 'JVBERi0=' }
      ]
    }
  ])
})

void test('document-only inputs and non-text output annotations are handled without fake citations', async () => {
  const model = modelWith((_url, init) => {
    const body = JSON.parse(init?.body as string) as {
      input: { content: unknown[] }[]
    }
    assert.equal(body.input[0]?.content.length, 2)
    return Promise.resolve(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'refusal',
                refusal: 'Cannot address part of this request.'
              },
              {
                type: 'output_text',
                text: 'Summary',
                annotations: [
                  {
                    type: 'file_citation',
                    file_id: 'file_1',
                    index: 0,
                    filename: 'test.txt'
                  }
                ]
              }
            ]
          }
        ]
      })
    )
  })
  assert.deepEqual(
    await model.reply([
      {
        role: 'user',
        content: 'Summarize',
        documents: [{ name: 'test.txt', mime: 'text/plain', data: 'aGk=' }]
      }
    ]),
    { text: 'Summary', images: [], toolsUsed: { images: 0, searches: 0 } }
  )
})

function eventStream(events: unknown[]): Response {
  return new Response(
    events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  )
}
void test('Responses streaming forwards incremental text and requires a completed terminal response', async () => {
  const deltas: string[] = []
  const response = {
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello world', annotations: [] }]
      },
      { type: 'web_search_call', status: 'completed', id: 'ws_1' }
    ]
  }
  const model = modelWith((_url, init) => {
    const body = JSON.parse(init?.body as string) as {
      input: unknown[]
      stream: boolean
      tools: unknown[]
      max_tool_calls: number
    }
    assert.equal(body.stream, true)
    assert.equal(body.tools.length, 0)
    assert.equal(body.max_tool_calls, 1)
    assert.deepEqual(body.input[0], {
      role: 'user',
      content: 'Conversation preferences (user-provided): Be concise.'
    })
    return Promise.resolve(
      eventStream([
        { type: 'response.created' },
        { type: 'response.output_text.delta', delta: 'Hello ' },
        { type: 'response.output_text.delta', delta: 'world' },
        { type: 'response.completed', response }
      ])
    )
  })
  const result = await model.reply([{ role: 'user', content: 'hi' }], {
    signal: new AbortController().signal,
    instructions: 'Be concise.',
    enableImages: false,
    enableSearch: false,
    maxToolCalls: 1,
    imageQuality: 'medium',
    imageSize: '1024x1024',
    onText: delta => {
      deltas.push(delta)
      return Promise.resolve()
    }
  })
  assert.deepEqual(deltas, ['Hello ', 'world'])
  assert.deepEqual(result.toolsUsed, { images: 0, searches: 1 })
  for (const type of ['error', 'response.failed', 'response.incomplete']) {
    await assert.rejects(
      modelWith(() => Promise.resolve(eventStream([{ type }]))).reply([], {
        onText: () => Promise.resolve()
      }),
      /Incomplete/
    )
  }
  await assert.rejects(
    modelWith(() => Promise.resolve(eventStream([]))).reply([], {
      onText: () => Promise.resolve()
    }),
    /Missing completed/
  )
})
void test('incoming transcription accepts a caller cancellation signal', async () => {
  const model = modelWith((_url, init) => {
    assert.ok(init?.signal)
    return Promise.resolve(Response.json({ text: 'hello' }))
  })
  assert.equal(
    await model.transcribe(new Uint8Array([1]), new AbortController().signal),
    'hello'
  )
})

void test('per-conversation models and labelled retrieval evidence reach the stateless provider contract', async () => {
  const model = modelWith((_url, init) => {
    const body = JSON.parse(init!.body as string) as {
      model: string
      input: { content: string }[]
    }
    assert.equal(body.model, 'custom-model')
    assert.match(body.input[0]!.content, /untrusted content/)
    assert.match(body.input[0]!.content, /\[L1\] Terms.pdf/)
    return Promise.resolve(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              { type: 'output_text', text: 'Answer [L1]', annotations: [] }
            ]
          }
        ]
      })
    )
  })
  await model.reply([{ role: 'user', content: 'Question' }], {
    chatModel: 'custom-model',
    references: '[L1] Terms.pdf (page 2): Evidence'
  })
})

void test('extractive recap is labelled as untrusted input and project spellings become transcription hints', async () => {
  let calls = 0
  const model = modelWith((_url, init) => {
    calls++
    if (init!.body instanceof FormData) {
      const prompt = init!.body.get('prompt')
      assert.equal(typeof prompt, 'string')
      assert.match(prompt as string, /Brand/)
      return Promise.resolve(Response.json({ text: 'Brand' }))
    }
    const body = JSON.parse(init!.body as string) as {
      input: { content: string }[]
    }
    assert.match(body.input[0]!.content, /untrusted excerpts/)
    return Promise.resolve(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Answer', annotations: [] }]
          }
        ]
      })
    )
  })
  await model.reply([{ role: 'user', content: 'Continue' }], {
    summary: 'Decisions from earlier turns'
  })
  assert.equal(
    await model.transcribe(
      new Uint8Array([1]),
      undefined,
      'Brand: Preferred spelling'
    ),
    'Brand'
  )
  assert.ok(calls >= 2)
})
