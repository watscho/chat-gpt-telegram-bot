import { test } from 'node:test'
import assert from 'node:assert/strict'
import OpenAI from 'openai'
import { OpenAIModel } from '../src/infrastructure/openai-model.js'
import { config } from './helpers.js'

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
    assert.deepEqual(body, {
      model: 'test-model',
      input: [{ role: 'user', content: 'hi' }],
      max_output_tokens: 2000,
      store: false
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
  assert.equal(await model.reply([{ role: 'user', content: 'hi' }]), 'hello')
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
