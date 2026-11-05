import { test, mock, afterEach } from 'node:test'
import { Telegram } from 'telegraf'
afterEach(() => mock.restoreAll())
import assert from 'node:assert/strict'
import type { Update, Voice, Message } from 'telegraf/types'
import { createBot, splitReply, type BotDependencies } from '../bot.js'
import type { Speech } from '../../domain/speech.js'
import type { StateStore } from '../../domain/state.js'
import { SQLiteStateStore } from '../../infrastructure/state-store.js'
import { config, FakeModel } from '../../__tests__/helpers.js'

function setup(
  model = new FakeModel(),
  maxConcurrentRequests = 10,
  speech?: Speech,
  store?: StateStore,
  overrides: Partial<BotDependencies> = {}
) {
  const replies: string[] = []
  const documents: unknown[] = []
  const voices: unknown[] = []
  const downloads: URL[] = []
  let errors = 0
  const transport = { failMessages: false, failActions: false, actions: 0 }
  const bot = createBot({
    config: { ...config(), maxConcurrentRequests },
    model,
    ...(speech ? { speech } : {}),
    ...(store ? { store } : {}),
    downloadDocument: (_url, name) =>
      name.endsWith('.pdf')
        ? Promise.resolve({ name, mime: 'application/pdf', data: 'JVBERi0=' })
        : Promise.reject(new Error('unsupported')),
    downloadImage: url => {
      downloads.push(url)
      return Promise.resolve({ data: 'iVBORw0KGgo=', mime: 'image/png' })
    },
    downloadAudio: () => Promise.resolve(new Uint8Array([1, 2])),
    reportError: () => {
      errors++
    },
    ...overrides
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
    (
      method: string,
      payload: { text?: string; document?: unknown; voice?: unknown }
    ) => {
      if (method === 'sendChatAction') {
        transport.actions++
        if (transport.failActions)
          return Promise.reject(new Error('telegram-secret'))
      }
      if (method === 'sendMessage') {
        if (transport.failMessages)
          return Promise.reject(new Error('telegram-secret'))
        replies.push(payload.text ?? '')
      }
      if (method === 'sendVoice') voices.push(payload.voice)
      if (method === 'sendDocument') documents.push(payload.document)
      if (method === 'getFile')
        return Promise.resolve({ file_path: 'voice.oga' })
      return Promise.resolve(true)
    }
  )
  return {
    bot,
    replies,
    model,
    documents,
    voices,
    downloads,
    transport,
    errors: () => errors
  }
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
    'Conversation cleared, including photos and documents. Saved notes and other conversations are preserved.',
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

function photoUpdate(caption = '', user = 42, size = 8): Update {
  return {
    update_id: ++sequence,
    message: {
      message_id: sequence,
      date: 1,
      from: { id: user, is_bot: false, first_name: 'User' },
      chat: { id: user, type: 'private', first_name: 'User' },
      photo: [
        { file_id: 'small', file_unique_id: 's', width: 10, height: 10 },
        {
          file_id: 'large',
          file_unique_id: 'l',
          width: 100,
          height: 100,
          file_size: size
        }
      ],
      caption
    }
  }
}

void test('photo captions enter multimodal history; follow-ups retain images', async () => {
  const { bot, model, downloads } = setup()
  await bot.handleUpdate(photoUpdate('What is in this photo?'))
  await bot.handleUpdate(update('Read the text on it'))
  assert.equal(downloads.length, 1)
  assert.equal(model.calls[0]?.[0]?.images?.[0]?.mime, 'image/png')
  assert.equal(model.calls[1]?.[0]?.images?.length, 1)
  await bot.handleUpdate(update('/reset'))
  await bot.handleUpdate(update('/edit remove background'))
  assert.equal(model.calls.length, 2)
})

void test('image generation and editing send originals and retain generated images', async () => {
  const { bot, model, documents, replies } = setup()
  model.answer = {
    text: '',
    images: [{ data: 'iVBORw0KGgo=', mime: 'image/png' }]
  }
  await bot.handleUpdate(update('/image cat on a beach'))
  await bot.handleUpdate(update('/edit change the sky'))
  assert.deepEqual(
    model.options.map(option => option.action),
    ['generate', 'edit']
  )
  assert.equal(model.calls[1]?.[1]?.images?.length, 1)
  assert.equal(documents.length, 2)
  assert.equal(replies.length, 0)
  await bot.handleUpdate(update('/image'))
  assert.ok(replies.at(-1)?.includes('Usage'))
  assert.equal(model.calls.length, 2)
})

void test('photo access, declared limits and edit captions are enforced before model calls', async () => {
  const { bot, model, downloads } = setup()
  await bot.handleUpdate(photoUpdate('secret', 99))
  await bot.handleUpdate(photoUpdate('huge', 42, 10000001))
  assert.equal(downloads.length, 0)
  assert.equal(model.calls.length, 0)
  await bot.handleUpdate(photoUpdate('/edit remove background'))
  assert.equal(model.options.at(-1)?.action, 'edit')
})

void test('replying to an image document selects it; unsupported files are rejected', async () => {
  const { bot, model, downloads, replies } = setup()
  const original = photoUpdate()
  if (!('message' in original) || !original.message) throw new Error('fixture')
  const { photo: _photo, ...base } =
    original.message as typeof original.message & { photo: unknown }
  void _photo
  const document = {
    message_id: base.message_id,
    date: 1,
    chat: { id: 42, type: 'private' as const, first_name: 'User' },
    from: { id: 42, is_bot: false, first_name: 'User' },
    document: {
      file_id: 'png',
      file_unique_id: 'png',
      mime_type: 'image/png',
      file_size: 8
    }
  }
  await bot.handleUpdate({ update_id: ++sequence, message: document })
  const request = update('/edit make it warmer')
  if (!('message' in request) || !request.message) throw new Error('fixture')
  await bot.handleUpdate({
    ...request,
    message: {
      ...request.message,
      reply_to_message: document as unknown as NonNullable<
        Message.CommonMessage['reply_to_message']
      >
    }
  })
  assert.equal(downloads.length, 2)
  assert.equal(model.calls.at(-1)?.at(-1)?.images?.length, 1)
  await bot.handleUpdate({
    update_id: ++sequence,
    message: {
      ...document,
      document: { ...document.document, mime_type: 'application/octet-stream' }
    }
  })
  assert.equal(model.calls.length, 2)
  assert.ok(replies.at(-1)?.includes('Unable to process'))
})

void test('photo albums become one multimodal request and share the concurrency lock', async () => {
  const { bot, model, replies } = setup()
  const make = (caption: string): Update => {
    const item = photoUpdate(caption)
    if (!('message' in item) || !item.message) throw new Error('fixture')
    return { ...item, message: { ...item.message, media_group_id: 'album-1' } }
  }
  const first = bot.handleUpdate(make('Compare these photos'))
  await new Promise(done => setImmediate(done))
  await bot.handleUpdate(make(''))
  await bot.handleUpdate(update('/reset'))
  await first
  assert.equal(model.calls.length, 1)
  assert.equal(model.calls[0]?.[0]?.images?.length, 2)
  assert.equal(model.calls[0]?.[0]?.content, 'Compare these photos')
  assert.ok(replies[0]?.startsWith('Busy'))
})

void test('named conversations keep independent histories and saved memory is user-scoped', async () => {
  const store = new SQLiteStateStore(':memory:')
  const { bot, model, replies } = setup(new FakeModel(), 10, undefined, store)
  await bot.handleUpdate(update('first conversation'))
  await bot.handleUpdate(update('/new Work'))
  await bot.handleUpdate(update('second conversation'))
  assert.equal(model.calls.at(-1)?.length, 1)
  await bot.handleUpdate(update('/remember Answer in English'))
  await bot.handleUpdate(update('/switch 1'))
  await bot.handleUpdate(update('follow-up'))
  assert.equal(model.calls.at(-1)?.length, 3)
  assert.deepEqual(model.options.at(-1)?.memories, ['Answer in English'])
  await bot.handleUpdate(update('other user', 43))
  assert.deepEqual(model.options.at(-1)?.memories, [])
  await bot.handleUpdate(update('/chats'))
  assert.ok(replies.at(-1)?.includes('2: Work'))
  await bot.handleUpdate(update('/rename Personal'))
  await bot.handleUpdate(update('/memory'))
  assert.match(replies.at(-1) ?? '', /1\. Answer in English/)
  await bot.handleUpdate(update('forget:Answer in English'))
  await bot.handleUpdate(update('remember:I am a developer'))
  await bot.handleUpdate(update('forget all'))
  await bot.handleUpdate(update('/delete 2'))
  assert.equal(
    store.sessions().some(([key]) => key === '42:42:2'),
    false
  )
  await bot.handleUpdate(update('/start'))
  assert.ok(replies.at(-1)?.includes('/search'))
  await bot.handleUpdate(update('/reset'))
  assert.equal(
    store.sessions().some(([key]) => key === '42:42:1'),
    false
  )
  store.close()
})

void test('documents enter context; /search forces lookup and returns visible sources', async () => {
  const { bot, model, replies } = setup()
  const photo = photoUpdate('Summarize')
  if (!('message' in photo) || !photo.message) throw new Error('fixture')
  const { photo: _photo, ...base } = photo.message as typeof photo.message & {
    photo: unknown
  }
  void _photo
  await bot.handleUpdate({
    update_id: ++sequence,
    message: {
      ...base,
      document: {
        file_id: 'pdf',
        file_unique_id: 'p',
        file_name: 'test.pdf',
        mime_type: 'application/pdf',
        file_size: 5
      }
    }
  })
  assert.equal(model.calls[0]?.[0]?.documents?.[0]?.name, 'test.pdf')
  model.answer = {
    text: 'Fresh answer [1]',
    images: [],
    sources: [{ title: 'Official docs', url: 'https://example.com/docs' }]
  }
  await bot.handleUpdate(update('/search Latest release?'))
  assert.equal(model.options.at(-1)?.search, true)
  assert.equal(model.calls.at(-1)?.[0]?.documents?.length, 1)
  assert.equal(
    replies.at(-1),
    'Sources:\n1. Official docs\nhttps://example.com/docs'
  )
  await bot.handleUpdate(update('/search'))
  assert.ok(replies.at(-1)?.includes('Usage'))
})

void test('voice modes and /speak preserve text on speech failure and never truncate', async () => {
  const spoken: string[] = []
  let fail = false
  const speech: Speech = {
    synthesize: text => {
      spoken.push(text)
      return fail
        ? Promise.reject(new Error('provider-secret'))
        : Promise.resolve(Buffer.from('OggSvoice'))
    }
  }
  const { bot, model, replies, voices, errors } = setup(
    new FakeModel(),
    10,
    speech
  )
  await bot.handleUpdate(update('/voice on'))
  await bot.handleUpdate(update('hello'))
  assert.equal(voices.length, 1)
  assert.equal(spoken[0], 'Test answer')
  fail = true
  await bot.handleUpdate(update('again'))
  assert.ok(replies.at(-1)?.includes('text answer above'))
  assert.equal(errors(), 1)
  assert.ok(!replies.join('').includes('secret'))
  fail = false
  await bot.handleUpdate(update('/voice auto'))
  await bot.handleUpdate(update('text only'))
  assert.equal(voices.length, 1)
  await bot.handleUpdate(voiceUpdate())
  assert.equal(voices.length, 2)
  await bot.handleUpdate(update('/voice off'))
  await bot.handleUpdate(update('/speak'))
  assert.equal(voices.length, 3)
  await bot.handleUpdate(update('/speak explicit text'))
  assert.equal(spoken.at(-1), 'explicit text')
  model.answer = 'x'.repeat(3001)
  await bot.handleUpdate(update('long text'))
  await bot.handleUpdate(update('/speak'))
  assert.ok(replies.at(-1)?.includes('too long'))
  await bot.handleUpdate(update('/reset'))
  await bot.handleUpdate(update('/speak'))
  assert.ok(replies.at(-1)?.includes('No text'))
})

void test('empty memory and missing/invalid voice output report actionable errors', async () => {
  const app = setup()
  await app.bot.handleUpdate(update('/memory'))
  assert.equal(app.replies.at(-1), 'No saved notes.')
  await app.bot.handleUpdate(update('/speak hello'))
  assert.equal(app.replies.at(-1), 'Voice output is not configured.')
  for (const size of [0, 5]) {
    const invalid = setup(
      new FakeModel(),
      10,
      { synthesize: () => Promise.resolve(Buffer.alloc(size)) },
      undefined,
      { config: { ...config(), maxSpeechBytes: 4 } }
    )
    await invalid.bot.handleUpdate(update('/speak hello'))
    assert.equal(invalid.errors(), 1)
  }
})

void test('default error reporter is content-free and failed error delivery is handled', async t => {
  const app = setup()
  const output: unknown[] = []
  t.mock.method(console, 'error', (value: unknown) => {
    output.push(value)
  })
  const model = new FakeModel()
  model.failure = true
  const bot = createBot({ config: config(), model })
  bot.botInfo = app.bot.botInfo!
  app.transport.failMessages = true
  await bot.handleUpdate(update('secret user prompt'))
  assert.deepEqual(output, ['Telegram update failed', 'Telegram update failed'])
})

void test('progress refresh and action transport errors do not interrupt the response', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const model = new FakeModel()
  let complete!: (value: string) => void
  model.reply = () =>
    new Promise(resolve => {
      complete = resolve
    })
  const app = setup(model)
  app.transport.failActions = true
  const pending = app.bot.handleUpdate(update('slow request'))
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(4000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(app.transport.actions, 2)
  complete('done')
  await pending
  assert.equal(app.replies.at(-1), 'done')
})

void test('automatic voice length validation preserves the full text answer', async () => {
  let calls = 0
  const app = setup(
    new FakeModel(),
    10,
    {
      synthesize: () => {
        calls++
        return Promise.resolve(Buffer.from('OggS'))
      }
    },
    undefined,
    { config: { ...config(), maxSpeechCharacters: 3 } }
  )
  await app.bot.handleUpdate(update('/voice on'))
  await app.bot.handleUpdate(update('hello'))
  assert.ok(app.replies.includes('Test answer'))
  assert.ok(app.replies.at(-1)?.includes('too long'))
  assert.equal(calls, 0)
})

void test('replied documents and non-file replies are selected correctly; bare documents get summaries', async () => {
  const app = setup()
  const request = update('What is the conclusion?')
  if (!('message' in request) || !request.message) throw new Error('fixture')
  const base = {
    message_id: ++sequence,
    date: 1,
    chat: { id: 42, type: 'private' as const, first_name: 'User' },
    from: { id: 42, first_name: 'User', is_bot: false }
  }
  const document = {
    ...base,
    document: { file_id: 'pdf', file_unique_id: 'p', file_name: 'test.pdf' }
  }
  await app.bot.handleUpdate({
    ...request,
    message: {
      ...request.message,
      reply_to_message: document as unknown as NonNullable<
        Message.CommonMessage['reply_to_message']
      >
    }
  })
  assert.equal(app.model.calls[0]?.[0]?.documents?.length, 1)
  await app.bot.handleUpdate({
    ...request,
    message: {
      ...request.message,
      reply_to_message: {
        ...base,
        text: 'earlier text'
      } as unknown as NonNullable<Message.CommonMessage['reply_to_message']>
    }
  })
  await app.bot.handleUpdate({ update_id: ++sequence, message: document })
  assert.ok(app.model.calls.at(-1)?.at(-1)?.content.includes('Summarize'))
  await app.bot.handleUpdate({
    update_id: ++sequence,
    message: {
      ...document,
      document: { file_id: 'unknown', file_unique_id: 'u' }
    }
  })
  assert.equal(app.model.calls.length, 3)
  await app.bot.handleUpdate({
    update_id: ++sequence,
    message: {
      ...document,
      document: {
        file_id: 'img',
        file_unique_id: 'i',
        file_name: 'original.png'
      }
    }
  })
  assert.equal(app.model.calls.at(-1)?.at(-1)?.images?.length, 1)
})

void test('attachment memory and download deadlines reject requests before invoking the provider', async t => {
  const app = setup(new FakeModel(), 10, undefined, undefined, {
    config: { ...config(), maxHistoryImageBytes: 4 }
  })
  await app.bot.handleUpdate(photoUpdate('large encoded payload'))
  assert.equal(app.model.calls.length, 0)
  assert.ok(app.replies.at(-1)?.includes('memory limit'))
  let calls = 0
  t.mock.method(Date, 'now', () => (calls++ === 0 ? 0 : 60001))
  await app.bot.handleUpdate(photoUpdate())
  assert.ok(app.replies.at(-1)?.includes('timed out'))
})

void test('mixed unsupported album entries fail as one batch rather than dropping attachments', async () => {
  const app = setup()
  const first = photoUpdate('compare')
  if (!('message' in first) || !first.message) throw new Error('fixture')
  const pending = app.bot.handleUpdate({
    ...first,
    message: { ...first.message, media_group_id: 'mixed' }
  })
  await new Promise(resolve => setImmediate(resolve))
  const { photo: _photo, ...base } = first.message as typeof first.message & {
    photo: unknown
  }
  void _photo
  await app.bot.handleUpdate({
    update_id: ++sequence,
    message: {
      ...base,
      video: {
        file_id: 'v',
        file_unique_id: 'v',
        width: 10,
        height: 10,
        duration: 1
      },
      media_group_id: 'mixed'
    }
  })
  await pending
  assert.equal(app.model.calls.length, 0)
  assert.ok(app.replies.at(-1)?.includes('supported images or documents'))
})

void test('file metadata lookup shares the download deadline and rejects unavailable files', async t => {
  const app = setup()
  let now = 0
  t.mock.method(Date, 'now', () => now)
  let unavailable = false
  t.mock.method(
    Telegram.prototype,
    'callApi',
    (method: string, _payload: unknown, options?: { signal?: AbortSignal }) => {
      if (method === 'getFile') {
        assert.ok(options?.signal)
        if (unavailable) return Promise.resolve({ file_id: 'missing' })
        now = 60001
        return Promise.resolve({ file_id: 'photo', file_path: 'photo.jpg' })
      }
      return Promise.resolve(true)
    }
  )
  await app.bot.handleUpdate(photoUpdate())
  assert.equal(app.downloads.length, 0)
  assert.equal(app.model.calls.length, 0)
  assert.equal(app.errors(), 0)
  unavailable = true
  await app.bot.handleUpdate(voiceUpdate())
  assert.equal(app.model.calls.length, 0)
  assert.equal(app.errors(), 0)
})
