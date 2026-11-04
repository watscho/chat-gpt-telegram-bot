import { test, mock, afterEach } from 'node:test'
import { Telegram } from 'telegraf'
afterEach(() => mock.restoreAll())
import assert from 'node:assert/strict'
import type { Update, Voice } from 'telegraf/types'
import { createBot, splitReply } from '../src/telegram/bot.js'
import { config, FakeModel } from './helpers.js'

function setup(model = new FakeModel(), maxConcurrentRequests = 10) {
  const replies: string[] = []
  let errors = 0
  const bot = createBot({
    config: { ...config(), maxConcurrentRequests },
    model,
    downloadAudio: () => Promise.resolve(new Uint8Array([1, 2])),
    reportError: () => {
      errors++
    }
  })
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Test',
    username: 'test_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false
  }
  // Intercept the real Telegraf transport. No Telegram requests leave the process.
  mock.method(
    Telegram.prototype,
    'callApi',
    (method: string, payload: { text?: string }) => {
      if (method === 'sendMessage') replies.push(payload.text ?? '')
      if (method === 'getFile')
        return Promise.resolve({ file_path: 'voice.oga' })
      return Promise.resolve(true)
    }
  )
  return { bot, replies, model, errors: () => errors }
}
let sequence = 0
function update(text: string, user = 42, group = false): Update {
  return {
    update_id: ++sequence,
    message: {
      message_id: sequence,
      date: 1,
      from: { id: user, is_bot: false, first_name: 'User' },
      chat: group
        ? { id: -1, type: 'group', title: 'Group' }
        : { id: user, type: 'private', first_name: 'User' },
      text,
      ...(text.startsWith('/')
        ? {
            entities: [
              { type: 'bot_command' as const, offset: 0, length: text.length }
            ]
          }
        : {})
    }
  }
}

void test('real Telegraf update flow responds and resets history', async () => {
  const { bot, model, replies } = setup()
  await bot.handleUpdate(update('hello'))
  await bot.handleUpdate(update('/reset'))
  await bot.handleUpdate(update('again'))
  assert.equal(model.calls[1]?.length, 1)
  assert.deepEqual(replies, [
    'Test answer',
    'Conversation cleared. Send a text or voice message. Use /help for details.',
    'Test answer'
  ])
})
void test('unauthorized users and group chats never invoke OpenAI', async () => {
  const { bot, model, replies } = setup()
  await bot.handleUpdate(update('hello', 99))
  await bot.handleUpdate(update('hello', 42, true))
  assert.equal(model.calls.length, 0)
  assert.deepEqual(replies, [])
})
void test('safe errors hide provider secrets and release the request lock', async () => {
  const { bot, model, replies, errors } = setup()
  model.failure = true
  await bot.handleUpdate(update('hello'))
  assert.equal(errors(), 1)
  assert.ok(!replies.join().includes('secret-token'))
  model.failure = false
  await bot.handleUpdate(update('again'))
  assert.equal(replies.at(-1), 'Test answer')
  assert.equal(model.calls.at(-1)?.length, 1)
})
void test('same-user overlap, reset during request, and global capacity are rejected', async () => {
  let resolve!: (text: string) => void
  const model = new FakeModel()
  model.reply = () =>
    new Promise<string>(done => {
      resolve = done
    })
  const { bot, replies } = setup(model, 1)
  const first = bot.handleUpdate(update('first'))
  // Let the middleware enter the pending provider call.
  await new Promise(done => setImmediate(done))
  await bot.handleUpdate(update('/reset'))
  await bot.handleUpdate(update('other user', 43))
  assert.equal(replies.length, 2)
  assert.ok(replies.every(reply => reply.startsWith('Busy.')))
  resolve('done')
  await first
  assert.equal(replies.at(-1), 'done')
})
void test('voice update transcribes and enters the same conversation pipeline', async () => {
  const { bot, model, replies } = setup()
  const voice = update('placeholder')
  if (!('message' in voice) || !voice.message) throw new Error('fixture')
  const { text: _text, ...base } = voice.message as typeof voice.message & {
    text: string
  }
  void _text
  await bot.handleUpdate({
    update_id: voice.update_id,
    message: {
      ...base,
      voice: {
        file_id: 'voice',
        file_unique_id: 'unique',
        duration: 1,
        file_size: 2
      }
    }
  })
  assert.equal(model.calls[0]?.[0]?.content, 'Voice text')
  assert.deepEqual(replies, ['Transcript: Voice text', 'Test answer'])
})
void test('reply chunks preserve surrogate pairs and content', () => {
  const text = 'a'.repeat(3999) + '😀' + 'b'.repeat(5000)
  const chunks = splitReply(text)
  assert.equal(chunks.join(''), text)
  assert.ok(chunks.every(chunk => chunk.length <= 4000))
  assert.ok(chunks[1]?.startsWith('😀'))
})

function voiceUpdate(voice: Partial<Voice> = {}): Update {
  return {
    update_id: ++sequence,
    message: {
      message_id: sequence,
      date: 1,
      from: { id: 42, is_bot: false, first_name: 'User' },
      chat: { id: 42, type: 'private', first_name: 'User' },
      voice: {
        file_id: 'voice',
        file_unique_id: 'unique',
        duration: 1,
        file_size: 2,
        ...voice
      }
    }
  }
}

void test('oversized voice and invalid transcription never reach chat completion', async () => {
  const { bot, model, replies, errors } = setup()
  await bot.handleUpdate(voiceUpdate({ duration: 301 }))
  await bot.handleUpdate(voiceUpdate({ file_size: 10000001 }))
  model.transcribe = () => Promise.resolve('')
  await bot.handleUpdate(voiceUpdate())
  model.transcribe = () => Promise.resolve('a'.repeat(8001))
  await bot.handleUpdate(voiceUpdate())
  assert.equal(model.calls.length, 0)
  assert.equal(replies.length, 4)
  assert.equal(errors(), 0)
})

void test('help and unknown commands never call the provider', async () => {
  const { bot, model, replies } = setup()
  await bot.handleUpdate(update('/help'))
  await bot.handleUpdate(update('/unknown'))
  assert.ok(replies[0]?.includes('OpenAI'))
  assert.equal(replies[1], 'Unknown command. Use /help.')
  assert.equal(model.calls.length, 0)
})

void test('failed transcription is sanitized and releases the concurrency slot', async () => {
  const { bot, model, replies, errors } = setup()
  model.transcribe = () => Promise.reject(new Error('secret-token'))
  await bot.handleUpdate(voiceUpdate())
  await bot.handleUpdate(update('text still works'))
  assert.equal(model.calls.length, 1)
  assert.equal(errors(), 1)
  assert.ok(!replies.join().includes('secret-token'))
})
