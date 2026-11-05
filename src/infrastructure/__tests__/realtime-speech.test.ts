import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import OpenAI from 'openai'
import type { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket'
import { RealtimeSpeech } from '../realtime-speech.js'
import { config } from '../../__tests__/helpers.js'

function setup(
  onSend: (events: EventEmitter, socket: EventTarget) => void,
  overrides = {}
) {
  const events = new EventEmitter()
  const socket = new EventTarget()
  const requests: unknown[] = []
  let closed = 0
  let encoded = 0
  const settings = { ...config(), requestTimeoutMs: 500, ...overrides }
  const connection = {
    socket,
    on: events.on.bind(events),
    send: (request: unknown) => {
      requests.push(request)
      onSend(events, socket)
    },
    close: () => {
      closed++
      socket.dispatchEvent(new Event('close'))
    }
  } as unknown as Pick<
    OpenAIRealtimeWebSocket,
    'on' | 'send' | 'close' | 'socket'
  >
  const speech = new RealtimeSpeech(
    new OpenAI({ apiKey: 'fake' }),
    settings,
    () => {
      queueMicrotask(() => socket.dispatchEvent(new Event('open')))
      return connection
    },
    (pcm, executable, maxBytes, timeout) => {
      encoded++
      assert.equal(pcm.length, 4)
      assert.equal(executable, settings.ffmpegPath)
      assert.equal(maxBytes, settings.maxSpeechBytes)
      assert.ok(timeout > 0)
      return Promise.resolve(Buffer.from('OggSvoice'))
    }
  )
  return { speech, requests, closed: () => closed, encoded: () => encoded }
}

void test('Realtime narrates a bounded text input and closes its connection before encoding', async () => {
  const app = setup(events => {
    events.emit('response.output_audio.delta', { delta: 'AAABAA==' })
    events.emit('response.done', { response: { status: 'completed' } })
    events.emit('response.output_audio.delta', { delta: 'late' })
  })
  assert.equal(
    Buffer.from(await app.speech.synthesize('Hello 🌍')).toString(),
    'OggSvoice'
  )
  assert.equal(app.closed(), 1)
  assert.equal(app.encoded(), 1)
  const request = app.requests[0] as {
    type: string
    response: {
      conversation: string
      audio: { output: { format: unknown } }
      input: unknown
    }
  }
  assert.equal(request.type, 'response.create')
  assert.equal(request.response.conversation, 'none')
  assert.deepEqual(request.response.audio.output.format, {
    type: 'audio/pcm',
    rate: 24000
  })
  assert.deepEqual(request.response.input, [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Hello 🌍' }]
    }
  ])
})

void test('speech rejects input, partial output, provider/network failures and closes on timeout', async () => {
  for (const scenario of [
    (events: EventEmitter) =>
      events.emit('error', new Error('provider-secret')),
    (_events: EventEmitter, socket: EventTarget) =>
      socket.dispatchEvent(new Event('close')),
    (_events: EventEmitter, socket: EventTarget) =>
      socket.dispatchEvent(new Event('error')),
    (events: EventEmitter) =>
      events.emit('response.done', { response: { status: 'incomplete' } }),
    (events: EventEmitter) => {
      events.emit('response.output_audio.delta', { delta: 'AA==' })
      events.emit('response.done', { response: { status: 'completed' } })
    }
  ]) {
    const app = setup(scenario)
    await assert.rejects(
      app.speech.synthesize('test'),
      error => error instanceof Error && !error.message.includes('secret')
    )
    assert.equal(app.closed(), 1)
    assert.equal(app.encoded(), 0)
  }
  const timed = setup(() => {}, { requestTimeoutMs: 10 })
  await assert.rejects(timed.speech.synthesize('test'), /timed out/)
  assert.equal(timed.closed(), 1)
  const invalid = setup(() => {})
  await assert.rejects(invalid.speech.synthesize(''))
  await assert.rejects(invalid.speech.synthesize('x'.repeat(3001)))
  assert.equal(invalid.requests.length, 0)
})

void test('speech enforces both per-delta and aggregate decoded output limits', async () => {
  for (const deltas of [['AAAAAAAAAAAA'], ['AAAA', 'AAAA', 'AAAA']]) {
    const app = setup(
      events => {
        for (const delta of deltas)
          events.emit('response.output_audio.delta', { delta })
      },
      { maxSpeechBytes: 4 }
    )
    await assert.rejects(app.speech.synthesize('test'), /too large/)
    assert.equal(app.closed(), 1)
  }
})

void test('speech does not start an encoder if its total deadline is exhausted', async t => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const app = setup(events => {
    events.emit('response.output_audio.delta', { delta: 'AAABAA==' })
    now = 501
    events.emit('response.done', { response: { status: 'completed' } })
  })
  await assert.rejects(app.speech.synthesize('test'), /timed out/)
  assert.equal(app.encoded(), 0)
})

void test('actual native Realtime SDK transport sends the configured model and audio request', async t => {
  class FakeSocket extends EventTarget {
    static OPEN = 1
    readyState = 1
    constructor(url: string | URL, protocols?: unknown) {
      super()
      assert.equal(
        new URL(url).searchParams.get('model'),
        'gpt-realtime-2.1-mini'
      )
      assert.ok(Array.isArray(protocols))
      queueMicrotask(() => this.dispatchEvent(new Event('open')))
    }
    send(payload: string) {
      const request = JSON.parse(payload) as { type: string }
      assert.equal(request.type, 'response.create')
      for (const data of [
        { type: 'response.output_audio.delta', delta: 'AAABAA==' },
        { type: 'response.done', response: { status: 'completed' } }
      ])
        this.dispatchEvent(
          new MessageEvent('message', { data: JSON.stringify(data) })
        )
    }
    close() {
      this.readyState = 3
      this.dispatchEvent(new Event('close'))
    }
  }
  const original = globalThis.WebSocket
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  t.after(() => {
    globalThis.WebSocket = original
  })
  const speech = new RealtimeSpeech(
    new OpenAI({ apiKey: 'fake-key' }),
    config(),
    undefined,
    () => Promise.resolve(Buffer.from('OggS'))
  )
  assert.equal(Buffer.from(await speech.synthesize('hello')).toString(), 'OggS')
})

void test('Realtime speech closes on caller cancellation and rejects already-cancelled requests', async () => {
  const controller = new AbortController()
  const cancelled = setup(() => {
    controller.abort()
  })
  await assert.rejects(
    cancelled.speech.synthesize('hello', controller.signal),
    /stopped/
  )
  assert.equal(cancelled.closed(), 1)
  const already = setup(() => {})
  await assert.rejects(
    already.speech.synthesize('hello', controller.signal),
    /stopped/
  )
  assert.equal(already.requests.length, 0)
})
