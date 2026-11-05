import { test, mock, afterEach } from 'node:test'
import { Telegram } from 'telegraf'
afterEach(() => mock.restoreAll())
import assert from 'node:assert/strict'
import type { Update, Voice, Message } from 'telegraf/types'
import { createBot, splitReply, type BotDependencies } from '../bot.js'
import type { Speech } from '../../domain/speech.js'
import type { StateStore } from '../../domain/state.js'
import { Profiles } from '../../application/profiles.js'
import { Jobs } from '../../application/jobs.js'
import { config, FakeModel, MemoryStateStore } from '../../__tests__/helpers.js'

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
  const edits: string[] = []
  const callbacks: string[] = []
  const keyboards: {
    inline_keyboard: {
      text: string
      callback_data?: string
      web_app?: { url: string }
    }[][]
  }[] = []
  let errors = 0
  const transport = {
    failMessages: false,
    failActions: false,
    failEdits: 0,
    actions: 0,
    onCallback: undefined as (() => void) | undefined
  }
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
      payload: {
        text?: string
        document?: unknown
        voice?: unknown
        reply_markup?: {
          inline_keyboard: {
            text: string
            callback_data?: string
            web_app?: { url: string }
          }[][]
        }
      }
    ) => {
      if (payload.reply_markup) keyboards.push(payload.reply_markup)
      if (method === 'answerCallbackQuery') {
        callbacks.push(payload.text ?? '')
        transport.onCallback?.()
      }
      if (method === 'editMessageText') {
        edits.push(payload.text ?? '')
        if (transport.failEdits > 0) {
          transport.failEdits--
          return Promise.reject(new Error('edit failed'))
        }
      }
      if (method === 'sendChatAction') {
        transport.actions++
        if (transport.failActions)
          return Promise.reject(new Error('telegram-secret'))
      }
      if (method === 'sendMessage') {
        if (transport.failMessages)
          return Promise.reject(new Error('telegram-secret'))
        replies.push(payload.text ?? '')
        return Promise.resolve({
          message_id: ++sequence,
          date: 1,
          chat: { id: 42, type: 'private' },
          text: payload.text
        })
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
    edits,
    callbacks,
    keyboards,
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
  assert.equal(replies.at(-1), 'Unknown command. Use /help.')
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

void test('photo albums become one multimodal request and share the concurrency lock', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
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
  t.mock.timers.tick(750)
  await first
  assert.equal(model.calls.length, 1)
  assert.equal(model.calls[0]?.[0]?.images?.length, 2)
  assert.equal(model.calls[0]?.[0]?.content, 'Compare these photos')
  assert.ok(replies[0]?.startsWith('Busy'))
})

void test('named conversations keep independent histories and saved memory is user-scoped', async () => {
  const store = new MemoryStateStore()
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
  assert.ok(replies.at(-1)?.includes('/settings'))
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

void test('mixed unsupported album entries fail as one batch rather than dropping attachments', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
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
  t.mock.timers.tick(750)
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

function callback(data: string, user = 42): Update {
  return {
    update_id: ++sequence,
    callback_query: {
      id: `callback-${sequence}`,
      from: { id: user, is_bot: false, first_name: 'User' },
      chat_instance: 'unit',
      data,
      message: {
        message_id: 1,
        date: 1,
        from: { id: 1, is_bot: true, first_name: 'Bot' },
        chat: { id: user, type: 'private', first_name: 'User' },
        text: 'Answer'
      }
    }
  }
}
function button(app: ReturnType<typeof setup>, prefix: string): string {
  const data = app.keyboards
    .findLast(keyboard =>
      keyboard.inline_keyboard
        .flat()
        .some(item => item.callback_data?.startsWith(prefix))
    )
    ?.inline_keyboard.flat()
    .find(item => item.callback_data?.startsWith(prefix))?.callback_data
  assert.ok(data, `Missing button ${prefix}`)
  return data
}
function documentUpdate(name: string, caption = ''): Update {
  return {
    update_id: ++sequence,
    message: {
      message_id: sequence,
      date: 1,
      from: { id: 42, is_bot: false, first_name: 'User' },
      chat: { id: 42, type: 'private', first_name: 'User' },
      caption,
      document: {
        file_id: name,
        file_unique_id: name,
        file_name: name,
        mime_type: 'application/pdf',
        file_size: 5
      }
    }
  }
}
void test('Stop rejects foreign/stale controls and prevents cancelled partial output from entering history', async () => {
  const model = new FakeModel()
  model.reply = (messages, options) => {
    model.calls.push(structuredClone([...messages]))
    return new Promise((_resolve, reject) =>
      options!.signal!.addEventListener(
        'abort',
        () => reject(new Error('provider-secret')),
        { once: true }
      )
    )
  }
  const app = setup(model, 10, undefined, undefined, {
    config: { ...config(), streamResponses: true }
  })
  const pending = app.bot.handleUpdate(update('slow request'))
  await new Promise(resolve => setImmediate(resolve))
  const stop = button(app, 'request:stop:')
  await app.bot.handleUpdate(callback(stop, 43))
  assert.equal(app.callbacks.at(-1), 'No matching active request.')
  await app.bot.handleUpdate(callback('request:stop:stale'))
  assert.equal(app.callbacks.at(-1), 'No matching active request.')
  await app.bot.handleUpdate(callback(stop))
  await pending
  assert.equal(app.errors(), 0)
  assert.ok(app.edits.includes('Stopped.'))
  assert.ok(app.replies.at(-1)?.includes('Request stopped'))
  await app.bot.handleUpdate(update('/stop'))
  assert.equal(app.replies.at(-1), 'No active request.')
  model.reply = FakeModel.prototype.reply.bind(model)
  await app.bot.handleUpdate(update('retry after cancellation'))
  assert.equal(model.calls.at(-1)?.length, 1)
  await app.bot.handleUpdate(update('/usage'))
  assert.ok(app.replies.at(-1)?.includes('Failed/uncertain attempts: 1'))
})
void test('streamed previews throttle updates, deliver long output and fall back when edits fail', async t => {
  let now = 2000
  t.mock.method(Date, 'now', () => now)
  const model = new FakeModel()
  model.reply = async (_messages, options) => {
    await options!.onText!('Hello ')
    now += 100
    await options!.onText!('world')
    now += 1100
    await options!.onText!('!')
    return {
      text: 'Hello world!',
      images: [],
      toolsUsed: { images: 0, searches: 0 }
    }
  }
  const app = setup(model, 10, undefined, undefined, {
    config: { ...config(), streamResponses: true }
  })
  await app.bot.handleUpdate(update('stream'))
  assert.deepEqual(app.edits, ['Hello ', 'Hello world!', 'Hello world!'])
  app.transport.failEdits = 100
  await app.bot.handleUpdate(update('edit fallback'))
  assert.ok(app.replies.includes('Hello world!'))
  app.transport.failEdits = 0
  model.reply = FakeModel.prototype.reply.bind(model)
  model.answer = 'x'.repeat(8001)
  const before = app.replies.length
  await app.bot.handleUpdate(update('long answer'))
  assert.equal(app.edits.at(-1)?.length, 4000)
  assert.equal(app.replies.slice(before + 1).join('').length, 4001)
  model.reply = async (_messages, options) => {
    now += 1100
    await options!.onText!('')
    return { text: '', images: [{ data: 'iVBORw0KGgo=', mime: 'image/png' }] }
  }
  await app.bot.handleUpdate(update('/image cat'))
  assert.equal(app.edits.at(-1), 'Image ready.')
  assert.ok(app.edits.includes('Working…'))
})
void test('owned response buttons retry, rewrite, speak and configure images without accepting forged actions', async () => {
  const spoken: string[] = []
  const app = setup(new FakeModel(), 10, {
    synthesize: text => {
      spoken.push(text)
      return Promise.resolve(Buffer.from('OggS'))
    }
  })
  await app.bot.handleUpdate(update('first question'))
  const retry = button(app, 'response:retry:')
  const token = retry.slice('response:retry:'.length)
  await app.bot.handleUpdate(callback(retry, 43))
  assert.match(app.replies.at(-1)!, /stale/)
  await app.bot.handleUpdate(callback('unknown:action'))
  assert.equal(app.callbacks.at(-1), 'Unknown control.')
  const game = callback('placeholder')
  if (
    !('callback_query' in game) ||
    !game.callback_query ||
    !('data' in game.callback_query)
  )
    throw new Error('fixture')
  const { data: _data, ...base } = game.callback_query
  void _data
  await app.bot.handleUpdate({
    update_id: ++sequence,
    callback_query: { ...base, game_short_name: 'unit' }
  })
  assert.equal(app.callbacks.at(-1), 'Unsupported control.')
  await app.bot.handleUpdate(callback(`setting:quality:medium:${token}`))
  await app.bot.handleUpdate(callback(`setting:size:1536x1024:${token}`))
  await app.bot.handleUpdate(callback(`setting:color:red:${token}`))
  assert.match(app.replies.at(-1)!, /Unknown image setting/)
  await app.bot.handleUpdate(callback(`response:unknown:${token}`))
  assert.match(app.replies.at(-1)!, /Unknown response action/)
  await app.bot.handleUpdate(callback(`response:shorter:${token}`))
  assert.match(app.model.calls.at(-1)?.at(-1)?.content ?? '', /concisely/)
  assert.equal(app.model.options.at(-1)?.imageQuality, 'medium')
  assert.equal(app.model.options.at(-1)?.imageSize, '1536x1024')
  await app.bot.handleUpdate(callback(button(app, 'response:more:')))
  assert.match(app.model.calls.at(-1)?.at(-1)?.content ?? '', /Expand/)
  await app.bot.handleUpdate(callback(button(app, 'response:speak:')))
  assert.equal(spoken.at(-1), 'Test answer')
  await app.bot.handleUpdate(callback(button(app, 'response:retry:')))
  assert.match(app.model.calls.at(-1)?.at(-1)?.content ?? '', /Expand/)
  await app.bot.handleUpdate(callback(retry))
  assert.match(app.replies.at(-1)!, /stale/)
})
void test('image controls select retained versions and reject expired image or answer references', async t => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const app = setup()
  app.model.answer = {
    text: '',
    images: [{ data: 'iVBORw0KGgo=', mime: 'image/png' }]
  }
  await app.bot.handleUpdate(update('/image original'))
  assert.ok(button(app, 'setting:size:1024x1024:'))
  app.model.answer = {
    text: '',
    images: [{ data: 'iVBORw0KGgoA', mime: 'image/png' }]
  }
  await app.bot.handleUpdate(update('/edit background'))
  const previous = button(app, 'response:previous:')
  await app.bot.handleUpdate(callback(previous))
  assert.match(app.replies.at(-1)!, /Selected source/)
  await app.bot.handleUpdate(update('/edit selected source'))
  assert.equal(
    app.model.calls.at(-1)?.at(-1)?.images?.[0]?.data,
    'iVBORw0KGgo='
  )
  await app.bot.handleUpdate(callback(button(app, 'response:variation:')))
  assert.match(app.model.calls.at(-1)?.at(-1)?.content ?? '', /variation/)
  const last = button(app, 'response:previous:')
  await app.bot.handleUpdate(update('/versions'))
  const id = app.replies.at(-1)!.split('\n')[0]!.slice(3)
  await app.bot.handleUpdate(update(`/revert ${id}`))
  now = 3600001
  await app.bot.handleUpdate(update('/edit expired source'))
  assert.match(app.replies.at(-1)!, /source has expired/)
  await app.bot.handleUpdate(callback(last))
  assert.match(app.replies.at(-1)!, /stale/)
  await app.bot.handleUpdate(callback(last.replace(':previous:', ':retry:')))
  assert.match(app.replies.at(-1)!, /stale/)
  await app.bot.handleUpdate(callback(last.replace(':previous:', ':speak:')))
  assert.match(app.replies.at(-1)!, /stale/)
  await app.bot.handleUpdate(update('/new Other'))
  await app.bot.handleUpdate(callback(last))
  assert.match(app.replies.at(-1)!, /stale/)
})
void test('background jobs use frozen project references and deliver retained results without a second provider call', async () => {
  const store = new MemoryStateStore()
  const app = setup(new FakeModel(), 10, undefined, store)
  await app.bot.handleUpdate(documentUpdate('v1.pdf', 'Read first'))
  await app.bot.handleUpdate(documentUpdate('v2.pdf', 'Read second'))
  await app.bot.handleUpdate(update('/project new Work'))
  await app.bot.handleUpdate(
    update('/project instructions Use source evidence')
  )
  await app.bot.handleUpdate(update('/project remember Project note'))
  await app.bot.handleUpdate(update('/remember Global note'))
  await app.bot.handleUpdate(update('/mode developer'))
  await app.bot.handleUpdate(update('/retention 120'))
  await app.bot.handleUpdate(update('/job compare Describe changes'))
  await app.bot.handleUpdate(update('/job research Find recent sources'))
  await app.bot.handleUpdate(update('/job summary Decisions'))
  await app.bot.tickJobs()
  assert.match(app.model.calls.at(-1)?.at(-1)?.content ?? '', /Compare.*table/)
  assert.equal(app.model.options.at(-1)?.enableImages, false)
  assert.deepEqual(app.model.options.at(-1)?.memories, [
    'Global note',
    'Project note'
  ])
  assert.match(
    app.model.options.at(-1)?.instructions ?? '',
    /Use source evidence/
  )
  app.model.answer = {
    text: 'Research',
    images: [{ data: 'iVBORw0KGgo=', mime: 'image/png' }],
    sources: [{ title: 'Source', url: 'https://example.com' }],
    toolsUsed: { images: 0, searches: 1 }
  }
  await app.bot.tickJobs()
  assert.equal(app.model.options.at(-1)?.search, true)
  assert.ok(app.replies.some(text => text.includes('Sources:')))
  assert.equal(app.documents.length, 1)
  app.model.answer = 'Summary'
  await app.bot.tickJobs()
  assert.match(app.model.calls.at(-1)?.at(-1)?.content ?? '', /Summarize/)
  const count = app.model.calls.length
  await app.bot.tickJobs()
  assert.equal(app.model.calls.length, count)
  const queue = store.getRecord<{ jobs: { id: string }[] }>('queue', '42:42')!
  await app.bot.handleUpdate(update(`/result ${queue.jobs[0]!.id}`))
  assert.equal(app.model.calls.length, count)
  app.bot.stopJobs()
})
void test('background conversation locks permit switching and prevent concurrent writes or quota reuse after failure', async () => {
  const app = setup(new FakeModel(), 2)
  await app.bot.handleUpdate(update('initial context'))
  await app.bot.handleUpdate(update('/job research Slow work'))
  let finish!: (text: string) => void
  app.model.reply = (messages, options) => {
    app.model.calls.push(structuredClone([...messages]))
    app.model.options.push(options!)
    if (messages.at(-1)?.content === 'Slow work')
      return new Promise(resolve => {
        finish = resolve
      })
    return Promise.resolve('Foreground answer')
  }
  const pending = app.bot.tickJobs()
  await new Promise(resolve => setImmediate(resolve))
  await app.bot.handleUpdate(update('same conversation'))
  assert.match(app.replies.at(-1)!, /background request/)
  await app.bot.handleUpdate(update('/new Other'))
  await app.bot.handleUpdate(update('different conversation'))
  assert.equal(app.replies.at(-1), 'Foreground answer')
  finish('Background answer')
  await pending
  app.model.reply = FakeModel.prototype.reply.bind(app.model)
  app.model.failure = true
  await app.bot.handleUpdate(update('/job research Failing work'))
  await app.bot.tickJobs()
  app.model.failure = false
  await app.bot.handleUpdate(update('/jobs'))
  assert.ok(app.replies.at(-1)?.includes('failed'))
  assert.ok(!app.replies.join('').includes('secret'))
  await app.bot.handleUpdate(update('/usage'))
  assert.match(app.replies.at(-1)!, /Failed\/uncertain attempts: 1/)
})

void test('foreground comparison, project attachments, exports and per-thread retention route through owned context', async () => {
  const app = setup()
  await app.bot.handleUpdate(update('/project new Work'))
  await app.bot.handleUpdate(update('/project attach'))
  assert.match(app.replies.at(-1)!, /Reply to a document/)
  const request = update('/project attach')
  const original = documentUpdate('project.pdf')
  if (
    !('message' in request) ||
    !request.message ||
    !('message' in original) ||
    !original.message
  )
    throw new Error('fixture')
  await app.bot.handleUpdate({
    ...request,
    message: {
      ...request.message,
      reply_to_message: original.message as unknown as NonNullable<
        Message.CommonMessage['reply_to_message']
      >
    }
  })
  await app.bot.handleUpdate(
    update('/project remember Project-scoped preference')
  )
  await app.bot.handleUpdate(update('/retention 120'))
  await app.bot.handleUpdate(
    documentUpdate('project.pdf', 'Use this same reference')
  )
  await app.bot.handleUpdate(
    documentUpdate('second.pdf', 'Read the second version')
  )
  await app.bot.handleUpdate(update('/compare obligations'))
  assert.match(app.model.calls.at(-1)?.at(-1)?.content ?? '', /change table/)
  assert.equal(app.model.options.at(-1)?.enableImages, false)
  assert.equal(app.model.options.at(-1)?.enableSearch, false)
  assert.equal(app.model.options.at(-1)?.retentionSeconds, 120)
  assert.ok(
    app.model.options.at(-1)?.memories?.includes('Project-scoped preference')
  )
  await app.bot.handleUpdate(update('/export markdown'))
  await app.bot.handleUpdate(update('/data'))
  assert.equal(app.documents.length, 2)
})
void test('scheduled summaries freeze deduplicated image/file references and reminders make no provider call', async t => {
  let now = 0
  t.mock.method(Date, 'now', () => now)
  const app = setup()
  app.model.answer = {
    text: 'Image',
    images: [{ data: 'iVBORw0KGgo=', mime: 'image/png' }]
  }
  await app.bot.handleUpdate(documentUpdate('same.pdf', 'First copy'))
  await app.bot.handleUpdate(documentUpdate('same.pdf', 'Second copy'))
  await app.bot.handleUpdate(update('/summary every 1m | Summarize references'))
  await app.bot.handleUpdate(update('/remind every 1m | Check this'))
  app.model.answer = {
    text: 'Digest',
    images: [],
    sources: [{ title: 'Reference', url: 'https://example.com' }]
  }
  const before = app.model.calls.length
  now = 60000
  await app.bot.tickJobs()
  const options = app.model.options.at(-1)!
  assert.equal(options.documents?.length, 1)
  assert.equal(app.model.calls.at(-1)?.at(-1)?.images?.length, 1)
  assert.equal(app.model.calls.length, before + 1)
  await app.bot.tickJobs()
  assert.equal(app.model.calls.length, before + 1)
  assert.ok(app.replies.some(reply => reply.includes('Check this')))
})
function seedQueue(store: MemoryStateStore, owner: string, thread = '1') {
  const queue = new Jobs(
    config(),
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
      execute: () => Promise.resolve({ text: 'unused', images: [] }),
      deliver: () => Promise.resolve()
    },
    store
  )
  return queue.enqueue(owner, thread, 'research', {
    prompt: 'Queued work',
    images: [],
    documents: [],
    instructions: '',
    memories: []
  })
}
void test('worker rejects unauthorized owners, missing conversations and empty summaries before paid requests', async () => {
  const store = new MemoryStateStore()
  for (const owner of ['malformed', '42:43', '99:99']) seedQueue(store, owner)
  seedQueue(store, '42:42', 'missing')
  const app = setup(new FakeModel(), 10, undefined, store)
  await app.bot.tickJobs()
  assert.equal(app.model.calls.length, 0)
  await app.bot.handleUpdate(update('/jobs'))
  assert.match(app.replies.at(-1)!, /source conversation no longer exists/)
  await app.bot.handleUpdate(update('/job summary Empty conversation'))
  await app.bot.tickJobs()
  assert.equal(app.model.calls.length, 0)
  await app.bot.handleUpdate(update('/jobs'))
  assert.match(app.replies.at(-1)!, /No retained conversation/)
})
void test('worker defers when foreground capacity is exhausted and can be cancelled without committing results', async () => {
  const app = setup(new FakeModel(), 1)
  await app.bot.handleUpdate(update('/job research Deferred work'))
  let finish!: (value: string) => void
  app.model.reply = () =>
    new Promise(resolve => {
      finish = resolve
    })
  const foreground = app.bot.handleUpdate(update('slow foreground'))
  await new Promise(resolve => setImmediate(resolve))
  await app.bot.tickJobs()
  await app.bot.handleUpdate(update('/stop'))
  assert.match(app.replies.at(-1)!, /Stopping request/)
  finish('cancelled late foreground')
  await foreground
  let signal!: AbortSignal
  app.model.reply = (_messages, options) => {
    signal = options!.signal!
    return new Promise(resolve => {
      finish = resolve
    })
  }
  const background = app.bot.tickJobs()
  await new Promise(resolve => setImmediate(resolve))
  app.bot.stopJobs()
  assert.equal(signal.aborted, true)
  finish('cancelled late background')
  await background
  app.model.reply = FakeModel.prototype.reply.bind(app.model)
  await app.bot.handleUpdate(update('fresh request'))
  assert.equal(app.model.calls.at(-1)?.length, 1)
})
void test('discarded oversized answers expose useful errors and repeated previous-image selection is bounded', async () => {
  const empty = setup(new FakeModel(), 10, undefined, undefined, {
    config: { ...config(), maxHistoryCharacters: 1 }
  })
  await empty.bot.handleUpdate(update('q'))
  await empty.bot.handleUpdate(callback(button(empty, 'response:retry:')))
  assert.match(empty.replies.at(-1)!, /Original request/)
  await empty.bot.handleUpdate(callback(button(empty, 'response:variation:')))
  assert.match(empty.replies.at(-1)!, /No retained image/)
  await empty.bot.handleUpdate(callback(button(empty, 'response:speak:')))
  assert.match(empty.replies.at(-1)!, /not configured/)
  const images = setup()
  images.model.answer = {
    text: '',
    images: [{ data: 'iVBORw0KGgo=', mime: 'image/png' }]
  }
  for (let i = 0; i < 3; i++)
    await images.bot.handleUpdate(update('/image next'))
  const previous = button(images, 'response:previous:')
  await images.bot.handleUpdate(callback(previous))
  await images.bot.handleUpdate(callback(previous))
  await images.bot.handleUpdate(callback(previous))
  assert.match(images.replies.at(-1)!, /No retained image/)
})
void test('streaming provider and preview-cleanup failures keep history clean and hide private errors', async () => {
  const app = setup(new FakeModel(), 10, undefined, undefined, {
    config: { ...config(), streamResponses: true }
  })
  app.transport.failEdits = 100
  app.model.failure = true
  await app.bot.handleUpdate(update('failure'))
  assert.equal(app.errors(), 1)
  assert.ok(!app.replies.join('').includes('secret'))
  app.model.failure = false
  await app.bot.handleUpdate(update('retry'))
  assert.equal(app.model.calls.at(-1)?.length, 1)
})
void test('late background completion invalidates an older foreground answer before retry can issue a new paid call', async () => {
  const app = setup(new FakeModel(), 2)
  await app.bot.handleUpdate(update('original question'))
  const retry = button(app, 'response:retry:')
  await app.bot.handleUpdate(update('/job research Concurrent work'))
  let finish!: (value: string) => void
  let calls = 0
  app.model.reply = () => {
    calls++
    return new Promise(resolve => {
      finish = resolve
    })
  }
  const pending = app.bot.tickJobs()
  await new Promise(resolve => setImmediate(resolve))
  app.transport.onCallback = () => {
    queueMicrotask(() => finish('Background result'))
  }
  await app.bot.handleUpdate(callback(retry))
  await pending
  assert.equal(calls, 1)
  assert.match(
    app.replies.findLast(reply => reply.includes('stale')) ?? '',
    /stale/
  )
})

void test('summary jobs retain their queued reference files even if conversation history has expired', async () => {
  const store = new MemoryStateStore()
  const first = seedQueue(store, '42:42')
  const second = seedQueue(store, '43:43')
  store.putRecord('queue', '42:42', {
    jobs: [
      {
        ...first,
        kind: 'summary',
        input: {
          ...first.input,
          images: [{ data: 'iVBORw0KGgo=', mime: 'image/png' }]
        }
      }
    ],
    schedules: []
  })
  store.putRecord('queue', '43:43', {
    jobs: [
      {
        ...second,
        kind: 'summary',
        input: {
          ...second.input,
          documents: [
            { name: 'reference.pdf', mime: 'application/pdf', data: 'JVBERi0=' }
          ]
        }
      }
    ],
    schedules: []
  })
  const app = setup(new FakeModel(), 10, undefined, store)
  await app.bot.tickJobs()
  assert.equal(app.model.calls.length, 2)
  assert.equal(app.model.calls[0]?.at(-1)?.images?.length, 1)
  assert.equal(app.model.calls[1]?.at(-1)?.documents?.length, 1)
})

void test('queued work resolves saved notes at execution rather than retaining forgotten note snapshots', async () => {
  const store = new MemoryStateStore()
  const app = setup(new FakeModel(), 10, undefined, store)
  await app.bot.handleUpdate(update('/project new Work'))
  await app.bot.handleUpdate(update('/project remember Project preference'))
  await app.bot.handleUpdate(update('/remember Personal preference'))
  await app.bot.handleUpdate(update('/job research Pending task'))
  const saved = store.getRecord<{ jobs: { input: { memories: string[] } }[] }>(
    'queue',
    '42:42'
  )!
  assert.deepEqual(saved.jobs[0]?.input.memories, [])
  await app.bot.handleUpdate(update('/forget all'))
  await app.bot.handleUpdate(update('/project forget all'))
  await app.bot.tickJobs()
  assert.deepEqual(app.model.options.at(-1)?.memories, [])
})

void test('button settings, branches, templates, forwarding and feedback use owner-scoped local services', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/settings'))
  await app.bot.handleUpdate(
    callback(button(app, 'menu:').replace(/open:model$/, 'open:mode'))
  )
  const select = app.keyboards
    .at(-1)!
    .inline_keyboard.flat()
    .find(item => item.text === 'editor')!.callback_data
  await app.bot.handleUpdate(callback(select!))
  await app.bot.handleUpdate(update('/model custom-model'))
  await app.bot.handleUpdate(update('/remember Prefer concise replies'))
  await app.bot.handleUpdate(update('/template save review | Review {{code}}'))
  await app.bot.handleUpdate(update('/run review {"code":"example"}'))
  assert.equal(app.model.calls.at(-1)!.at(-1)!.content, 'Review example')
  assert.equal(app.model.options.at(-1)!.chatModel, 'custom-model')
  const token = button(app, 'response:up:').split(':').at(-1)!
  await app.bot.handleUpdate(callback(`response:up:${token}`))
  await app.bot.handleUpdate(callback(`response:down:${token}`))
  await app.bot.handleUpdate(callback(`feedback:incorrect:${token}`))
  await app.bot.handleUpdate(update('/feedback'))
  assert.match(app.replies.at(-1)!, /incorrect/)
  await app.bot.handleUpdate(update('/branch 1'))
  await app.bot.handleUpdate(update('/switch 1'))
  await app.bot.handleUpdate(update('/revise 1 | Revised question'))
  assert.equal(app.model.calls.at(-1)!.at(-1)!.content, 'Revised question')
  assert.ok(app.replies.some(text => text.includes('Branch 3')))
  await app.bot.handleUpdate(update('/collect on'))
  const forwarded = update('Agreed to release Friday')
  if ('message' in forwarded)
    Object.assign(forwarded.message, {
      forward_origin: {
        type: 'hidden_user',
        date: 1,
        sender_user_name: 'Someone'
      }
    })
  await app.bot.handleUpdate(forwarded)
  const photo = photoUpdate('Caption only')
  if ('message' in photo)
    Object.assign(photo.message, {
      forward_origin: {
        type: 'hidden_user',
        date: 1,
        sender_user_name: 'Someone'
      }
    })
  await app.bot.handleUpdate(photo)
  const empty = photoUpdate()
  if ('message' in empty) Object.assign(empty.message, { caption: undefined })
  if ('message' in empty)
    Object.assign(empty.message, {
      forward_origin: {
        type: 'hidden_user',
        date: 1,
        sender_user_name: 'Someone'
      }
    })
  await app.bot.handleUpdate(empty)
  assert.match(app.replies.at(-1)!, /1..8000/)
  await app.bot.handleUpdate(update('/collect summarize'))
  assert.match(app.model.options.at(-1)!.references!, /release Friday/)
  assert.match(app.model.options.at(-1)!.references!, /Caption only/)
  assert.equal(app.model.options.at(-1)!.enableImages, false)
  await app.bot.handleUpdate(update('/data'))
  await app.bot.handleUpdate(update('/erase confirm'))
  assert.equal(store.getRecord('productivity', '42:42'), undefined)
  assert.equal(store.getRecord('library', '42:42'), undefined)
})

void test('context confirmation sends only selected snapshots and rejects revision races before paid work', async () => {
  const app = setup()
  await app.bot.handleUpdate(update('/remember Hidden preference'))
  await app.bot.handleUpdate(update('Earlier history'))
  await app.bot.handleUpdate(update('/context on'))
  await app.bot.handleUpdate(update('Review this request'))
  assert.equal(app.model.calls.length, 1)
  const toggle = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${toggle}:toggle:0:0`))
  await app.bot.handleUpdate(callback(`context:${toggle}:toggle:1:0`))
  await app.bot.handleUpdate(callback(`context:${toggle}:send`))
  assert.equal(app.model.calls.length, 2)
  assert.equal(app.model.calls.at(-1)!.length, 1)
  assert.deepEqual(app.model.options.at(-1)!.memories, [])
  await app.bot.handleUpdate(callback(`context:${toggle}:send`))
  assert.equal(app.model.calls.length, 2)
  await app.bot.handleUpdate(update('/context Inspect without paying'))
  const cancel = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${cancel}:cancel`))
  await app.bot.handleUpdate(update('/context off'))
  assert.equal(app.errors(), 0)
})

void test('library indexing uses an injected parser and grounded questions share normal quota/history controls', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store, {
      extractText: () =>
        Promise.resolve([
          { location: 'page 2', text: 'Renewal requires written notice' }
        ])
    })
  await app.bot.handleUpdate(update('/project new Research'))
  const upload = update('/library add')
  if ('message' in upload)
    Object.assign(upload.message, {
      reply_to_message: {
        message_id: 77,
        date: 1,
        chat: { id: 42, type: 'private' },
        document: {
          file_id: 'pdf',
          file_unique_id: 'pdf',
          file_name: 'terms.pdf',
          mime_type: 'application/pdf'
        }
      }
    })
  await app.bot.handleUpdate(upload)
  await app.bot.handleUpdate(update('/ask renewal'))
  assert.match(app.model.options.at(-1)!.references!, /terms.pdf \(page 2/)
  assert.equal(app.model.calls.length, 1)
  await app.bot.handleUpdate(update('/context show 0'))
  await app.bot.handleUpdate(update('/project delete 1'))
  assert.deepEqual(store.getRecord('library', '42:42'), [])
})

void test('reviewed image requests preserve explicit action and project context while feedback rejects discarded answers', async () => {
  const app = setup()
  await app.bot.handleUpdate(update('/project new Work'))
  await app.bot.handleUpdate(update('/project remember Scoped note'))
  await app.bot.handleUpdate(update('/instructions Use references'))
  await app.bot.handleUpdate(photoUpdate('A source'))
  await app.bot.handleUpdate(update('/context on'))
  await app.bot.handleUpdate(update('/edit Add a blue background'))
  const draft = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${draft}:send`))
  assert.equal(app.model.options.at(-1)!.action, 'edit')
  assert.deepEqual(app.model.options.at(-1)!.memories, ['Scoped note'])
  assert.match(app.model.options.at(-1)!.instructions!, /Use references/)
  const discarded = setup(undefined, 10, undefined, undefined, {
    config: { ...config(), maxHistoryCharacters: 1 }
  })
  await discarded.bot.handleUpdate(update('x'))
  const token = button(discarded, 'response:up:').split(':').at(-1)!
  await discarded.bot.handleUpdate(callback(`response:up:${token}`))
  assert.match(discarded.replies.at(-1)!, /no longer retained/)
  await discarded.bot.handleUpdate(callback(`feedback:other:${token}`))
  assert.match(discarded.replies.at(-1)!, /no longer retained/)
})

void test('library replies without attachment and model overrides in queued jobs remain safe', async () => {
  const app = setup()
  await app.bot.handleUpdate(update('/project new Work'))
  await app.bot.handleUpdate(update('/library add'))
  assert.match(app.replies.at(-1)!, /Reply to a PDF/)
  await app.bot.handleUpdate(update('/model custom-model'))
  await app.bot.handleUpdate(update('/job research Sources'))
  await app.bot.tickJobs()
  assert.equal(app.model.options.at(-1)!.chatModel, 'custom-model')
})

void test('cancellation during branch creation never starts a paid revision', async () => {
  const app = setup()
  await app.bot.handleUpdate(update('Original'))
  const create = Object.getOwnPropertyDescriptor(Profiles.prototype, 'create')!
    .value as Profiles['create']
  let stopping: Promise<void> | undefined
  mock.method(
    Profiles.prototype,
    'create',
    function (this: Profiles, owner: string, title: string) {
      const result = create.call(this, owner, title)
      stopping = app.bot.handleUpdate(update('/stop'))
      return result
    }
  )
  await app.bot.handleUpdate(update('/revise 1 | Replacement'))
  await stopping
  assert.equal(app.model.calls.length, 1)
  assert.ok(app.replies.some(text => text.includes('Request stopped')))
})

void test('rapid forwarded batches are collected without busy loss and forwarded commands remain quoted content', async () => {
  const app = setup()
  await app.bot.handleUpdate(update('/collect on'))
  const batch = ['First decision', 'Second decision', '/stop'].map(text => {
    const item = update(text)
    if ('message' in item)
      Object.assign(item.message, {
        forward_origin: {
          type: 'hidden_user',
          date: 1,
          sender_user_name: 'Someone'
        }
      })
    return item
  })
  await Promise.all(batch.map(item => app.bot.handleUpdate(item)))
  const unsupported = voiceUpdate()
  if ('message' in unsupported)
    Object.assign(unsupported.message, {
      forward_origin: {
        type: 'hidden_user',
        date: 1,
        sender_user_name: 'Someone'
      }
    })
  await app.bot.handleUpdate(unsupported)
  assert.match(app.replies.at(-1)!, /1..8000/)
  await app.bot.handleUpdate(update('/collect summarize'))
  assert.match(app.model.options.at(-1)!.references!, /First decision/)
  assert.match(app.model.options.at(-1)!.references!, /Second decision/)
  assert.match(app.model.options.at(-1)!.references!, /\/stop/)
  assert.ok(!app.replies.some(text => text.startsWith('Busy')))
})

void test('quoted replies target the delivered retained passage, reject wrong threads and create tasks without provider work', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('First question'))
  await app.bot.handleUpdate(update('Second question'))
  const flow = store.getRecord<{
    quotes: {
      message: number
      thread: string
      revision: string
      text: string
    }[]
    tasks: { id: string; title: string }[]
  }>('workflow', '42:42')!
  const quoted = flow.quotes[0]!
  const reply = (text: string, fragment?: string) => {
    const item = update(text)
    if ('message' in item)
      Object.assign(item.message, {
        reply_to_message: {
          message_id: quoted.message,
          date: 1,
          chat: { id: 42, type: 'private' },
          from: { id: 1, is_bot: true, first_name: 'Bot' },
          text: quoted.text
        },
        ...(fragment !== undefined
          ? { quote: { text: fragment, position: 0 } }
          : {})
      })
    return item
  }
  await app.bot.handleUpdate(reply('Explain this passage', 'Test'))
  assert.match(
    app.model.options.at(-1)!.references!,
    new RegExp(quoted.revision)
  )
  assert.match(app.model.options.at(-1)!.references!, /Test/)
  const calls = app.model.calls.length
  await app.bot.handleUpdate(reply('/task fromreply'))
  assert.equal(app.model.calls.length, calls)
  assert.equal(
    store.getRecord<typeof flow>('workflow', '42:42')!.tasks[0]!.title,
    'Test answer'
  )
  await app.bot.handleUpdate(reply('Wrong quote', 'not present'))
  assert.equal(app.model.calls.length, calls)
  await app.bot.handleUpdate(update('/new Other'))
  await app.bot.handleUpdate(reply('Wrong thread'))
  assert.equal(app.model.calls.length, calls)
  const task = update('/task fromreply')
  if ('message' in task)
    Object.assign(task.message, {
      reply_to_message: {
        message_id: 99,
        date: 1,
        chat: { id: 42, type: 'private' },
        from: { id: 42, is_bot: false, first_name: 'User' },
        text: 'User-selected task'
      }
    })
  await app.bot.handleUpdate(task)
  await app.bot.handleUpdate(update('/task fromreply'))
  assert.match(app.replies.at(-1)!, /Reply to a text/)
  const unknown = reply('Unknown answer')
  if ('message' in unknown && 'text' in unknown.message)
    Object.assign(unknown.message.reply_to_message!, { message_id: 999999 })
  await app.bot.handleUpdate(unknown)
  assert.equal(app.model.calls.length, calls)
})

void test('glossary hints, task reminders, guide buttons and recap inspection use local workflow state', async () => {
  let taskClock = Date.parse('2026-11-05T12:00:00Z')
  mock.method(Date, 'now', () => taskClock)
  const model = new FakeModel()
  let hint = ''
  model.transcribe = (_audio, _signal, prompt) => {
    hint = prompt ?? ''
    return Promise.resolve('Transcribed message')
  }
  const store = new MemoryStateStore(),
    app = setup(model, 10, undefined, store)
  await app.bot.handleUpdate(update('/guide'))
  await app.bot.handleUpdate(callback('guide:documents'))
  await app.bot.handleUpdate(update('/project new Work'))
  await app.bot.handleUpdate(
    update('/glossary set Product | Preferred spelling')
  )
  await app.bot.handleUpdate(update('Translate a phrase'))
  assert.match(app.model.options.at(-1)!.instructions!, /Preferred spelling/)
  await app.bot.handleUpdate(voiceUpdate())
  assert.match(hint, /Preferred spelling/)
  await app.bot.handleUpdate(update('/task add Review | 2099-01-01 09:00'))
  taskClock = Date.parse('2099-01-01T10:00:00Z')
  const before = app.model.calls.length
  await app.bot.tickJobs()
  assert.equal(app.model.calls.length, before)
  const task = store.getRecord<{ tasks: { id: string }[] }>(
    'workflow',
    '42:42'
  )!.tasks[0]!
  await app.bot.handleUpdate(callback(`task:done:${task.id}`))
  assert.match(app.replies.at(-1)!, /completed/)
  await app.bot.handleUpdate(update('/project delete 1'))
  assert.deepEqual(
    store.getRecord<{ glossary: unknown }>('workflow', '42:42')!.glossary,
    {}
  )
  await app.bot.handleUpdate(update('/recap'))
  await app.bot.handleUpdate(update('/reset'))
  await app.bot.handleUpdate(update('/erase confirm'))
  assert.equal(store.getRecord('workflow', '42:42'), undefined)
})

void test('cost confirmations precede image and job execution and implicit image tools stay disabled', async () => {
  const app = setup(undefined, 10, undefined, undefined, {
    config: { ...config(), confirmExpensiveRequests: true }
  })
  await app.bot.handleUpdate(update('/image A portrait'))
  assert.equal(app.model.calls.length, 0)
  assert.ok(app.replies.at(-1)!.includes('estimated cost'))
  const draft = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${draft}:send`))
  assert.equal(app.model.calls.length, 1)
  assert.equal(app.model.options.at(-1)!.action, 'generate')
  await app.bot.handleUpdate(update('A plain request'))
  assert.equal(app.model.options.at(-1)!.enableImages, false)
  await app.bot.handleUpdate(update('/context /image Another portrait'))
  const next = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${next}:cancel`))
  assert.equal(app.model.calls.length, 2)
  await app.bot.handleUpdate(update('/job research Find evidence'))
  assert.equal(app.model.calls.length, 2)
  const approval = button(app, 'work:').split(':')[1]!
  await app.bot.handleUpdate(callback(`work:${approval}:confirm`))
  await app.bot.tickJobs()
  assert.equal(app.model.calls.length, 3)
})

void test('batch files run as separate confirmed jobs and imported archives refresh in-memory views', async () => {
  const store = new MemoryStateStore()
  const wire = JSON.stringify({
    archiveVersion: 1,
    profile: {
      threads: [{ id: '1', title: 'Imported' }],
      memories: ['Imported note']
    },
    workspace: { projects: [], threads: {} },
    histories: [],
    extensions: {
      productivity: {
        templates: [{ name: 'imported', body: 'Imported prompt' }]
      }
    }
  })
  const app = setup(undefined, 10, undefined, store, {
    downloadDocument: (_url, name) =>
      Promise.resolve({
        name,
        mime: name.endsWith('.json') ? 'application/json' : 'application/pdf',
        data: name.endsWith('.json')
          ? Buffer.from(wire).toString('base64')
          : 'JVBERi0='
      })
  })
  const replied = (text: string, name: string) => {
    const item = update(text)
    if ('message' in item)
      Object.assign(item.message, {
        reply_to_message: {
          message_id: 88,
          date: 1,
          chat: { id: 42, type: 'private' },
          document: {
            file_id: name,
            file_unique_id: name,
            file_name: name,
            mime_type: 'application/octet-stream'
          }
        }
      })
    return item
  }
  await app.bot.handleUpdate(update('/project new Files'))
  await app.bot.handleUpdate(replied('/project attach', 'a.pdf'))
  await app.bot.handleUpdate(replied('/project attach', 'b.pdf'))
  await app.bot.handleUpdate(update('/batch summarize'))
  assert.equal(app.model.calls.length, 0)
  const approval = button(app, 'work:').split(':')[1]!
  await app.bot.handleUpdate(callback(`work:${approval}:confirm`))
  await app.bot.tickJobs()
  await app.bot.tickJobs()
  assert.equal(app.model.calls.length, 2)
  assert.ok(
    app.model.calls.every(
      messages => messages.length === 1 && messages[0]!.documents!.length === 1
    )
  )
  const group = store
    .getRecord<{ jobs: { batch?: { group: string } }[] }>('queue', '42:42')!
    .jobs.find(job => job.batch)!.batch!.group
  await app.bot.handleUpdate(update(`/batch export ${group}`))
  await app.bot.handleUpdate(replied('/import', 'my-data.json'))
  const imported = button(app, 'work:').split(':')[1]!
  await app.bot.handleUpdate(callback(`work:${imported}:confirm`))
  await app.bot.handleUpdate(update('/chats'))
  assert.match(app.replies.at(-1)!, /Imported/)
  await app.bot.handleUpdate(update('/templates'))
  assert.match(app.replies.at(-1)!, /imported/)
})

void test('legacy histories and drafts remain private and excluded recap defaults never leak after an upgrade', async () => {
  const store = new MemoryStateStore()
  store.putSession('42:42:1', {
    messages: [
      { role: 'user', content: 'Legacy' },
      { role: 'assistant', content: 'Legacy answer' }
    ],
    expiresAt: Date.now() + 100000
  })
  const app = setup(undefined, 10, undefined, store)
  const item = update('Explain old text')
  if ('message' in item)
    Object.assign(item.message, {
      reply_to_message: {
        message_id: 77,
        date: 1,
        chat: { id: 42, type: 'private' },
        from: { id: 1, is_bot: true, first_name: 'Bot' },
        text: 'Legacy answer'
      }
    })
  await app.bot.handleUpdate(item)
  assert.match(app.replies.at(-1)!, /not retained/)
  const fresh = new MemoryStateStore()
  fresh.putRecord('productivity', '42:42', {
    collecting: {},
    templates: [],
    forwards: {},
    feedback: [],
    draft: {
      token: 'old',
      thread: '1',
      revision: undefined,
      expiresAt: Date.now() + 100000,
      prompt: 'Confirmed legacy request',
      parts: [],
      analysisOnly: false
    }
  })
  const migrated = setup(undefined, 10, undefined, fresh)
  await migrated.bot.handleUpdate(callback('context:old:send'))
  assert.equal(migrated.model.options[0]!.summary, '')
})

void test('stale image estimates from persisted previews cannot bypass the current cost confirmation', async () => {
  const store = new MemoryStateStore()
  store.putRecord('productivity', '42:42', {
    collecting: {},
    templates: [],
    forwards: {},
    feedback: [],
    draft: {
      token: 'old-price',
      thread: '1',
      expiresAt: Date.now() + 100000,
      prompt: '/image A portrait',
      parts: [],
      analysisOnly: false,
      estimate: 1
    }
  })
  const app = setup(undefined, 10, undefined, store, {
    config: { ...config(), confirmExpensiveRequests: true }
  })
  await app.bot.handleUpdate(callback('context:old-price:send'))
  assert.equal(app.model.calls.length, 0)
  assert.match(app.replies.at(-1)!, /cost changed/)
})

void test('import without a replied archive stops locally with navigation guidance', async () => {
  const app = setup(undefined, 10, undefined, new MemoryStateStore())
  await app.bot.handleUpdate(update('/import'))
  assert.equal(app.model.calls.length, 0)
  assert.match(app.replies.at(-1)!, /Reply to a \/data JSON archive/)
})

void test('quiet hours collect job/task notifications durably and explicit digest delivery makes no new paid calls', async () => {
  let clock = Date.parse('2026-11-05T23:00:00Z')
  mock.method(Date, 'now', () => clock)
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/quiet 22:00-08:00'))
  await app.bot.handleUpdate(update('/digest 1h'))
  await app.bot.handleUpdate(update('/job research Find sources'))
  await app.bot.handleUpdate(update('/task add Review | 2026-11-06 00:00'))
  await app.bot.handleUpdate(update('/tasks all'))
  assert.match(app.replies.at(-1)!, /Delivery: pending/)
  clock = Date.parse('2026-11-06T00:30:00Z')
  await app.bot.tickJobs()
  assert.equal(app.model.calls.length, 1)
  const state = store.getRecord<{ notices: { id: string }[] }>(
    'experience',
    '42:42'
  )!
  assert.equal(state.notices.length, 2)
  assert.equal(
    store.getRecord<{ jobs: { delivery: string }[] }>('queue', '42:42')!
      .jobs[0]!.delivery,
    'queued'
  )
  assert.equal(
    store.getRecord<{ tasks: { delivery: string }[] }>('workflow', '42:42')!
      .tasks[0]!.delivery,
    'queued'
  )
  await app.bot.handleUpdate(update('/tasks all'))
  assert.match(app.replies.at(-1)!, /Delivery:/)
  const before = app.replies.length
  await app.bot.handleUpdate(update('/digest now'))
  assert.equal(app.model.calls.length, 1)
  assert.ok(
    app.replies.slice(before).some(text => text.includes('Notification digest'))
  )
  assert.equal(
    store.getRecord<{ notices: unknown[] }>('experience', '42:42')!.notices
      .length,
    0
  )
  assert.equal(
    store.getRecord<{ jobs: { delivery: string }[] }>('queue', '42:42')!
      .jobs[0]!.delivery,
    'sent'
  )
  const jobId = store.getRecord<{ jobs: { id: string }[] }>('queue', '42:42')!
    .jobs[0]!.id
  await app.bot.handleUpdate(callback(`notice:result:${jobId}`))
  assert.equal(app.model.calls.length, 1)
})

void test('notification digests skip deleted/completed targets and retry transport only with a bounded outbox', async () => {
  let clock = Date.parse('2026-11-05T12:00:00Z')
  mock.method(Date, 'now', () => clock)
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/digest 5m'))
  await app.bot.handleUpdate(update('/job summary Retained content'))
  await app.bot.handleUpdate(update('Context'))
  await app.bot.tickJobs()
  const queue = store.getRecord<{ jobs: { id: string; delivery: string }[] }>(
      'queue',
      '42:42'
    )!,
    id = queue.jobs[0]!.id
  const paid = app.model.calls.length
  clock += 300000
  app.transport.failMessages = true
  await assert.rejects(app.bot.tickJobs())
  app.transport.failMessages = false
  assert.equal(app.model.calls.length, paid)
  await app.bot.handleUpdate(update('/notifications'))
  await app.bot.handleUpdate(update(`/notifications retry job-${id}`))
  await app.bot.handleUpdate(update('/digest now'))
  assert.equal(app.model.calls.length, paid)
  await app.bot.handleUpdate(update('/job research More sources'))
  await app.bot.tickJobs()
  const nextId = store
    .getRecord<typeof queue>('queue', '42:42')!
    .jobs.at(-1)!.id
  await app.bot.handleUpdate(callback(`notice:result:${nextId}`))
  assert.equal(
    store.getRecord<{ notices: unknown[] }>('experience', '42:42')!.notices
      .length,
    0
  )
  await app.bot.handleUpdate(update('/job research Deleted'))
  await app.bot.tickJobs()
  const deleted = store
    .getRecord<typeof queue>('queue', '42:42')!
    .jobs.at(-1)!.id
  await app.bot.handleUpdate(update(`/job delete ${deleted}`))
  await app.bot.handleUpdate(update('/digest now'))
  assert.equal(
    store.getRecord<{ notices: unknown[] }>('experience', '42:42')!.notices
      .length,
    0
  )
})

void test('source-card buttons save private bookmarks and retain stable callback sizes across history', async () => {
  const model = new FakeModel()
  model.answer = {
    text: 'Cited answer',
    images: [],
    sources: [{ title: 'Primary source', url: 'https://example.com/source' }]
  }
  const store = new MemoryStateStore(),
    app = setup(model, 10, undefined, store)
  await app.bot.handleUpdate(update('Question'))
  const card = button(app, 'card:')
  assert.ok(Buffer.byteLength(card) <= 64)
  await app.bot.handleUpdate(callback(card))
  assert.match(app.replies.at(-1)!, /example.com\/source/)
  await app.bot.handleUpdate(callback(button(app, 'bookmark:source:')))
  await app.bot.handleUpdate(callback(button(app, 'bookmark:answer:')))
  const saved = store.getRecord<{ bookmarks: { id: string }[] }>(
    'experience',
    '42:42'
  )!.bookmarks
  assert.equal(saved.length, 2)
  await app.bot.handleUpdate(update(`/bookmark tags ${saved[0]!.id} | work`))
  await app.bot.handleUpdate(update('/bookmarks #work'))
  await app.bot.handleUpdate(update('/sources'))
  await app.bot.handleUpdate(update('/new Other'))
  await app.bot.handleUpdate(callback(card))
  assert.match(app.replies.at(-1)!, /no longer retained/)
  await app.bot.handleUpdate(update('/reset'))
  assert.equal(
    store.getRecord<{ bookmarks: unknown[] }>('experience', '42:42')!.bookmarks
      .length,
    2
  )
  await app.bot.handleUpdate(update('/erase confirm'))
  assert.equal(store.getRecord('experience', '42:42'), undefined)
})

void test('project budgets account for foreground, voice and original-project jobs inside the owner cap', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store, {
      config: { ...config(), confirmExpensiveRequests: true }
    })
  await app.bot.handleUpdate(update('/project new A'))
  await app.bot.handleUpdate(update('/project_budget 0.1'))
  await app.bot.handleUpdate(update('First'))
  assert.equal(app.model.calls.length, 1)
  await app.bot.handleUpdate(update('Over budget'))
  assert.equal(app.model.calls.length, 1)
  assert.match(app.replies.at(-1)!, /budget/)
  await app.bot.handleUpdate(update('/project_budget 1'))
  await app.bot.handleUpdate(update('/job research Background'))
  const preview = button(app, 'work:').split(':')[1]!
  await app.bot.handleUpdate(callback(`work:${preview}:confirm`))
  await app.bot.handleUpdate(update('/new Other'))
  await app.bot.handleUpdate(update('/project new B'))
  await app.bot.tickJobs()
  const usage = store.getRecord<{
    projects: Record<string, { requests: number }>
  }>('usage', '42:42')!
  assert.equal(usage.projects['1']!.requests, 2)
  assert.equal(usage.projects['2'], undefined)
  await app.bot.handleUpdate(update('/project_usage'))
  assert.match(app.replies.at(-1)!, /Requests: 0/)
})

void test('UI localization preserves generated/quoted content and answer language remains a conversation preference', async () => {
  const model = new FakeModel()
  model.answer = 'Task completed.'
  const store = new MemoryStateStore(),
    app = setup(model, 10, undefined, store)
  await app.bot.handleUpdate(update('/language ui ru'))
  assert.ok(!app.replies.at(-1)!.startsWith('UI language:'))
  await app.bot.handleUpdate(update('/language answer es'))
  await app.bot.handleUpdate(update('Question'))
  assert.equal(app.replies.at(-1), 'Task completed.')
  assert.match(model.options.at(-1)!.instructions!, /preference: es/)
  const keyboard = app.keyboards.at(-1)!.inline_keyboard.flat()
  assert.ok(
    keyboard.some(
      item =>
        item.callback_data?.startsWith('response:up:') &&
        item.text !== 'Helpful'
    )
  )
  await app.bot.handleUpdate(update('/guide delivery'))
  await app.bot.handleUpdate(update('/language ui es'))
  await app.bot.handleUpdate(update('/quiet'))
  assert.ok(app.replies.at(-1)!.startsWith('Horario silencioso:'))
  await app.bot.handleUpdate(update('/language ui en'))
  await app.bot.handleUpdate(update('/language answer auto'))
})

void test('structured output requests preserve their specification through review and deliver a retained file', async () => {
  const model = new FakeModel()
  model.answer = {
    text: 'Structured output ready: 1 rows. Fields: name, amount.',
    images: [],
    artifact: {
      rows: 1,
      name: 'result.csv',
      mime: 'text/csv',
      data: Buffer.from('"name","amount"\r\n"Invoice","12"').toString('base64')
    }
  }
  const store = new MemoryStateStore(),
    app = setup(model, 10, undefined, store)
  await app.bot.handleUpdate(update('/context on'))
  await app.bot.handleUpdate(
    update('/output csv name,amount | Extract from the request')
  )
  assert.equal(model.calls.length, 0)
  assert.match(app.replies.at(-1)!, /Output format: csv/)
  const preview = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${preview}:send`))
  assert.deepEqual(model.options[0]!.structured, {
    format: 'csv',
    fields: ['name', 'amount']
  })
  assert.equal(model.options[0]!.enableImages, false)
  assert.equal(app.documents.length, 1)
  assert.equal(
    store.sessions()[0]![1].messages.at(-1)!.documents![0]!.name,
    'result.csv'
  )
})

void test('stale outbox targets preserve sent receipts and suppress completed, removed or disabled deliveries', async () => {
  const store = new MemoryStateStore()
  const tasks = ['done', 'sent', 'suppressed'].map((state, index) => ({
    id: `task-${index}`,
    thread: '1',
    title: state,
    status: state === 'done' ? 'done' : 'open',
    dueAt: 1,
    reminded: true,
    attempts: 1,
    nextAttempt: 0,
    ...(state !== 'done' ? { delivery: state } : {})
  }))
  store.putRecord('workflow', '42:42', {
    tasks,
    glossary: {},
    quotes: [],
    approval: null
  })
  store.putRecord('queue', '42:42', {
    jobs: ['sent', 'suppressed'].map(delivery => ({
      id: delivery,
      thread: '1',
      kind: 'research',
      state: 'succeeded',
      delivery,
      input: { prompt: 'Old', memories: [] },
      result: { text: 'Old result', images: [] },
      createdAt: 1,
      updatedAt: 1,
      attempts: 0,
      nextDelivery: 0
    })),
    schedules: []
  })
  store.putRecord('experience', '42:42', {
    language: 'en',
    quiet: null,
    digestMinutes: 5,
    bookmarks: [],
    notices: [
      ...tasks.map(task => ({ kind: 'task', target: task.id })),
      { kind: 'task', target: 'missing' },
      ...['sent', 'suppressed'].map(target => ({ kind: 'job', target }))
    ].map((item, index) => ({
      ...item,
      id: `notice-${index}`,
      thread: '1',
      title: 'Old',
      queuedAt: 0,
      attempts: 0,
      nextAttempt: 0
    }))
  })
  const app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/digest now'))
  assert.equal(
    app.replies.some(text => text.includes('Notification digest')),
    false
  )
  assert.deepEqual(
    store
      .getRecord<{ tasks: { delivery: string }[] }>('workflow', '42:42')!
      .tasks.map(task => task.delivery),
    ['suppressed', 'sent', 'suppressed']
  )
  assert.equal(app.model.calls.length, 0)
})

void test('bookmark replies use the quoted-text adapter and structured slash prompts never stream or invoke image commands', async () => {
  const app = setup(undefined, 10, undefined, new MemoryStateStore(), {
    config: { ...config(), streamResponses: true }
  })
  const item = update('/bookmark reply | work')
  if ('message' in item)
    Object.assign(item.message, {
      reply_to_message: {
        message_id: 100,
        date: 1,
        chat: { id: 42, type: 'private' },
        text: 'Keep this detail'
      }
    })
  await app.bot.handleUpdate(item)
  await app.bot.handleUpdate(update('/bookmarks #work'))
  assert.match(app.replies.at(-1)!, /Tags: work/)
  await app.bot.handleUpdate(
    update('/output json item | /image Literal source text')
  )
  assert.equal(app.model.calls.length, 1)
  assert.equal(app.model.options[0]!.onText, undefined)
  assert.equal(app.model.options[0]!.enableImages, false)
  assert.equal(app.model.options[0]!.structured!.format, 'json')
})

void test('rescheduled or cleared task deadlines suppress old digest entries and deliver again only when newly due', async () => {
  let clock = Date.parse('2026-11-05T12:00:00Z')
  mock.method(Date, 'now', () => clock)
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/digest 5m'))
  await app.bot.handleUpdate(update('/task add Reschedule | 2026-11-05 13:00'))
  await app.bot.handleUpdate(update('/task add Clear | 2026-11-05 13:00'))
  clock += 3600001
  await app.bot.tickJobs()
  const tasks = store.getRecord<{ tasks: { id: string }[] }>(
    'workflow',
    '42:42'
  )!.tasks
  await app.bot.handleUpdate(
    update(`/task due ${tasks[0]!.id} | 2026-11-05 14:00`)
  )
  await app.bot.handleUpdate(update(`/task due ${tasks[1]!.id} | none`))
  const before = app.replies.length
  await app.bot.handleUpdate(update('/digest now'))
  assert.equal(
    app.replies
      .slice(before)
      .some(text => text.includes('Notification digest')),
    false
  )
  clock += 3600000
  await app.bot.tickJobs()
  await app.bot.handleUpdate(update('/digest now'))
  assert.match(
    app.replies.at(-2)!,
    /Notification digest.*\n+Task due[\s\S]*Reschedule/
  )
  assert.equal(app.model.calls.length, 0)
})

void test('onboarding, favorite scenarios and project continuation use real handlers with explicit paid entry points', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/start'))
  assert.equal(app.model.calls.length, 0)
  await app.bot.handleUpdate(callback('daily:focus:work'))
  await app.bot.handleUpdate(callback('daily:language:en'))
  await app.bot.handleUpdate(callback('daily:example'))
  assert.equal(app.model.calls.length, 1)
  await app.bot.handleUpdate(update('/start'))
  await app.bot.handleUpdate(update('/favorite add polish'))
  await app.bot.handleUpdate(callback('daily:run:polish'))
  await app.bot.handleUpdate(update('Please polish this draft'))
  assert.equal(app.model.calls.length, 2)
  assert.match(app.model.calls.at(-1)!.at(-1)!.content, /User content:/)
  await app.bot.handleUpdate(callback(button(app, 'act:checklist:')))
  assert.equal(app.model.calls.length, 3)
  await app.bot.handleUpdate(update('/project new Work'))
  await app.bot.handleUpdate(update('/continue'))
  await app.bot.handleUpdate(callback('daily:resume:1'))
  assert.equal(app.model.calls.length, 3)
  const token = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${token}:send`))
  assert.equal(app.model.calls.length, 4)
  await app.bot.handleUpdate(update('/today'))
  assert.match(app.replies.at(-1)!, /Today/)
  await app.bot.handleUpdate(update('/reset'))
  await app.bot.handleUpdate(update('/erase confirm'))
  assert.equal(store.getRecord('daily', '42:42'), undefined)
})

void test('voice notes preserve reviewed context intent and create idempotent local tasks only after a second confirmation', async () => {
  const model = new FakeModel(),
    raw = JSON.stringify({
      rows: [{ summary: 'Agreed work', task: 'Review the proposal', due: null }]
    })
  model.answer = {
    text: 'Structured output ready',
    images: [],
    artifact: {
      rows: 1,
      name: 'result.json',
      mime: 'application/json',
      data: Buffer.from(raw).toString('base64')
    }
  }
  const store = new MemoryStateStore(),
    app = setup(model, 10, undefined, store, {
      config: { ...config(), streamResponses: true }
    })
  await app.bot.handleUpdate(update('/notes on'))
  await app.bot.handleUpdate(update('/context on'))
  await app.bot.handleUpdate(voiceUpdate())
  assert.equal(model.calls.length, 0)
  const preview = button(app, 'context:').split(':')[1]!
  app.transport.failEdits = 1
  await app.bot.handleUpdate(callback(`context:${preview}:send`))
  assert.equal(model.calls.length, 1)
  assert.equal(app.documents.length, 0)
  assert.equal(
    store.getRecord<{ tasks: unknown[] }>('workflow', '42:42')?.tasks.length ??
      0,
    0
  )
  const confirm = button(app, 'daily:tasks:')
  await app.bot.handleUpdate(callback(confirm))
  assert.equal(
    store.getRecord<{ tasks: unknown[] }>('workflow', '42:42')!.tasks.length,
    1
  )
  await app.bot.handleUpdate(callback(confirm))
  assert.equal(model.calls.length, 1)
  await app.bot.handleUpdate(update('/context off'))
  await app.bot.handleUpdate(voiceUpdate())
  assert.equal(model.calls.length, 2)
  assert.match(app.edits.at(-1)!, /ready for review/)
  await app.bot.handleUpdate(callback(button(app, 'daily:cancel:')))
})

void test('article reads attach the retrieved excerpt, retain evidence and respect cancellation and ordinary usage', async () => {
  let reads = 0
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store, {
      readArticle: (url, signal) => {
        reads++
        assert.ok(signal)
        return Promise.resolve({
          url,
          title: 'Article title',
          text: 'Visible article '.repeat(20),
          truncated: true
        })
      }
    })
  await app.bot.handleUpdate(
    update('/read https://example.com/story | Explain the claims')
  )
  assert.equal(reads, 1)
  assert.equal(app.model.calls.length, 1)
  assert.match(app.model.options[0]!.references!, /truncated: true/)
  assert.equal(app.model.options[0]!.enableSearch, false)
  await app.bot.handleUpdate(callback(button(app, 'act:translate:')))
  await app.bot.handleUpdate(update('A plain text answer'))
  await app.bot.handleUpdate(callback(button(app, 'act:translate:')))
  await app.bot.handleUpdate(callback(button(app, 'act:risks:')))
  await app.bot.handleUpdate(update('https://example.com/next'))
  assert.equal(reads, 2)
  await app.bot.handleUpdate(update('/context on'))
  await app.bot.handleUpdate(update('/read https://example.com/review'))
  const token = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${token}:send`))
  assert.equal(reads, 3)
  const stop = setup(undefined, 10, undefined, new MemoryStateStore(), {
    readArticle: (_url, signal) =>
      new Promise((_resolve, reject) =>
        signal!.addEventListener(
          'abort',
          () => reject(new Error('cancelled')),
          { once: true }
        )
      )
  })
  const reading = stop.bot.handleUpdate(update('/read https://example.com'))
  await new Promise(resolve => setImmediate(resolve))
  await stop.bot.handleUpdate(update('/stop'))
  await reading
  assert.equal(stop.model.calls.length, 0)
  assert.equal(stop.errors(), 0)
})

void test('morning dashboard worker respects owner allowlists and quiet windows without a model call', async () => {
  let now = Date.parse('2026-11-05T07:00:00Z')
  mock.method(Date, 'now', () => now)
  const { Daily } = await import('../../application/daily.js')
  const store = new MemoryStateStore(),
    daily = new Daily(store)
  for (const owner of ['42:42', '42:43', '42:42:1', '99:99'])
    daily.morning(owner, '08:00')
  const app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/quiet 07:00-09:00'))
  now += 3600000
  await app.bot.tickJobs()
  assert.equal(app.replies.length, 1)
  now += 3600000
  app.transport.failMessages = true
  await app.bot.tickJobs()
  app.transport.failMessages = false
  now += 60000
  await app.bot.tickJobs()
  await app.bot.tickJobs()
  assert.equal(app.replies.filter(text => text.startsWith('Today')).length, 1)
  assert.equal(app.model.calls.length, 0)
  await app.bot.handleUpdate(update('/morning off'))
})

void test('image-specific actions retain the selected photo and preserve cost review before a background edit', async () => {
  const app = setup(undefined, 10, undefined, new MemoryStateStore(), {
    config: { ...config(), confirmExpensiveRequests: true }
  })
  await app.bot.handleUpdate(photoUpdate('Explain this photo'))
  const background = button(app, 'act:background:')
  await app.bot.handleUpdate(callback(button(app, 'act:translate:')))
  assert.match(
    app.model.calls.at(-1)!.at(-1)!.content,
    /visible text in the selected image/
  )
  assert.equal(app.model.options.at(-1)!.enableImages, false)
  await app.bot.handleUpdate(callback(background))
  assert.match(app.replies.at(-1)!, /no longer retained/)
  await app.bot.handleUpdate(photoUpdate('Use this photo'))
  await app.bot.handleUpdate(callback(button(app, 'act:background:')))
  const count = app.model.calls.length,
    token = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${token}:send`))
  assert.equal(app.model.calls.length, count + 1)
  assert.equal(app.model.options.at(-1)!.action, 'edit')
  assert.ok(app.model.calls.at(-1)!.at(-1)!.images!.length)
})

import { FakeWorkbench } from '../../__tests__/workbench.js'
void test('provider analysis retains output files only after mandatory context review and reuses shared quota and erasure', async () => {
  const provider = new FakeWorkbench(),
    store = new MemoryStateStore(),
    settings = config()
  const app = setup(undefined, 10, undefined, store, {
    provider,
    config: settings
  })
  await app.bot.handleUpdate(documentUpdate('data.pdf', '/analyze totals'))
  assert.equal(provider.calls.length, 0)
  const token = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${token}:send`))
  assert.ok(provider.calls.some(call => call.method === 'analysis'))
  assert.equal(app.documents.length, 1)
  assert.equal(app.model.calls.length, 0)
  await app.bot.handleUpdate(update('/data'))
  assert.equal(app.documents.length, 2)
  await app.bot.handleUpdate(update('/erase confirm'))
  await app.bot.tickJobs()
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('cloud knowledge and reviewed external tools run through real bot handlers without automatic actions', async () => {
  const provider = new FakeWorkbench(),
    store = new MemoryStateStore(),
    settings = config()
  settings.workbench.connections = [
    {
      id: 'mail',
      owner: 42,
      title: 'Mail',
      tools: ['search'],
      server: 'https://mcp.example.com',
      authorization: 'private'
    }
  ]
  const app = setup(undefined, 10, undefined, store, {
    provider,
    config: settings
  })
  await app.bot.handleUpdate(update('/project new Work'))
  await app.bot.handleUpdate(documentUpdate('notes.pdf', '/knowledge add'))
  let token = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${token}:send`))
  await app.bot.handleUpdate(update('/knowledge status'))
  const file = provider.calls.find(call => call.method === 'attach')!.value as {
    file: string
  }
  provider.hits = [
    { file: file.file, name: 'notes.pdf', text: 'Reviewed evidence', score: 1 }
  ]
  await app.bot.handleUpdate(update('/knowledge ask What was decided?'))
  token = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${token}:send`))
  assert.ok(provider.calls.some(call => call.method === 'grounded'))
  await app.bot.handleUpdate(update('/connect mail | Find draft'))
  token = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${token}:send`))
  assert.equal(
    provider.calls.filter(call => call.method === 'connection').length,
    1
  )
  const approval = button(app, 'provider:approve:')
  await app.bot.handleUpdate(callback(approval))
  await app.bot.handleUpdate(callback(approval))
  assert.equal(
    provider.calls.filter(call => call.method === 'connection').length,
    2
  )
  await app.bot.handleUpdate(update('/knowledge clear confirm'))
  await app.bot.tickJobs()
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('recordings require explicit processing and return transcript plus reviewed protocol while live voice reserves a scoped session', async () => {
  const provider = new FakeWorkbench(),
    store = new MemoryStateStore(),
    settings = config()
  settings.workbench.miniAppURL = 'https://voice.example.com/voice'
  const app = setup(undefined, 10, undefined, store, {
    provider,
    config: settings
  })
  await app.bot.handleUpdate(update('/live'))
  assert.equal(app.bot.liveStatus('42:42').enabled, true)
  const call = await app.bot.openLive('42:42', 'v=0', 'interview')
  await assert.rejects(app.bot.openLive('42:42', 'v=0', 'language'))
  await app.bot.closeLive('42:42', call.id)
  const audio = {
    update_id: ++sequence,
    message: {
      message_id: sequence,
      date: 1,
      from: { id: 42, is_bot: false, first_name: 'User' },
      chat: { id: 42, type: 'private', first_name: 'User' },
      audio: {
        file_id: 'audio',
        file_unique_id: 'audio',
        file_name: 'meeting.ogg',
        duration: 60,
        file_size: 10,
        mime_type: 'audio/ogg'
      }
    }
  } as Update
  await app.bot.handleUpdate(audio)
  assert.equal(
    provider.calls.filter(call => call.method === 'meeting').length,
    0
  )
  mock.method(globalThis, 'fetch', () =>
    Promise.resolve(
      new Response(new Uint8Array([79, 103, 103, 83, 0, 1, 2, 3]))
    )
  )
  const recording = {
    ...audio,
    message: {
      ...('message' in audio ? audio.message : {}),
      caption: '/meeting'
    }
  } as Update
  app.model.answer = JSON.stringify([
    { summary: 'Review draft', task: 'Review draft', due: null }
  ])
  await app.bot.handleUpdate(recording)
  await app.bot.handleUpdate(callback(button(app, 'provider:meeting:')))
  assert.equal(
    provider.calls.filter(call => call.method === 'meeting').length,
    1
  )
  assert.ok(app.documents.length >= 1)
  await app.bot.handleUpdate(update('/erase confirm'))
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('streamed provider reviews, replied files and project deletion preserve explicit approval and cleanup', async () => {
  const provider = new FakeWorkbench(),
    store = new MemoryStateStore(),
    settings = config()
  settings.streamResponses = true
  settings.workbench.miniAppURL = 'https://voice.example.com'
  settings.workbench.connections = [
    {
      id: 'mail',
      owner: 42,
      title: 'Mail',
      tools: ['search'],
      server: 'https://mcp.example.com',
      authorization: 'private'
    }
  ]
  const app = setup(undefined, 10, undefined, store, {
    provider,
    config: settings
  })
  await app.bot.handleUpdate(update('/project new Work'))
  const replied = update(
    '/knowledge add'
  ) as Update.MessageUpdate<Message.TextMessage>
  replied.message.reply_to_message = (
    documentUpdate('ref.pdf') as Update.MessageUpdate<Message.DocumentMessage>
  ).message as unknown as NonNullable<Message.TextMessage['reply_to_message']>
  await app.bot.handleUpdate(replied)
  let token = button(app, 'context:').split(':')[1]!
  await app.bot.handleUpdate(callback(`context:${token}:send`))
  await app.bot.handleUpdate(update('/project delete 1'))
  await app.bot.handleUpdate(update('/connect mail | Find draft'))
  token = button(app, 'context:').split(':')[1]!
  app.transport.failEdits = 1
  await app.bot.handleUpdate(callback(`context:${token}:send`))
  await app.bot.handleUpdate(callback(button(app, 'provider:reject:')))
  const call = await app.bot.openLive('42:42', 'v=0', 'conversation')
  provider.failure = 'remove'
  await app.bot.handleUpdate(update('/erase confirm'))
  assert.ok(
    provider.calls.some(
      item =>
        item.method === 'remove' &&
        (item.value as { id: string }).id === call.id
    )
  )
  provider.failure = ''
  await app.bot.tickJobs()
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('meeting documents and replied audio reserve unknown duration and never retry a failed transcription', async () => {
  const provider = new FakeWorkbench(),
    store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store, { provider })
  const recording = documentUpdate('meeting.ogg')
  await app.bot.handleUpdate(recording)
  mock.method(globalThis, 'fetch', () =>
    Promise.resolve(
      new Response(new Uint8Array([79, 103, 103, 83, 0, 1, 2, 3]))
    )
  )
  const replied = update(
    '/meeting'
  ) as Update.MessageUpdate<Message.TextMessage>
  replied.message.reply_to_message = (
    recording as Update.MessageUpdate<Message.DocumentMessage>
  ).message as unknown as NonNullable<Message.TextMessage['reply_to_message']>
  provider.failure = 'meeting'
  await app.bot.handleUpdate(replied)
  await app.bot.handleUpdate(callback(button(app, 'provider:meeting:')))
  assert.equal(
    provider.calls.filter(item => item.method === 'meeting').length,
    1
  )
  provider.failure = ''
  await app.bot.handleUpdate(documentUpdate('meeting.ogg', '/meeting'))
  assert.match(app.replies.at(-1)!, /unknown/)
  app.bot.stopJobs()
})
void test('live opening shares foreground and global concurrency admission', async () => {
  const provider = new FakeWorkbench(),
    store = new MemoryStateStore(),
    settings = config()
  settings.workbench.miniAppURL = 'https://voice.example.com'
  settings.maxConcurrentRequests = 1
  const model = new FakeModel()
  let resolve!: (value: string) => void
  model.reply = () =>
    new Promise(done => {
      resolve = done
    })
  const app = setup(model, 1, undefined, store, { provider, config: settings }),
    pending = app.bot.handleUpdate(update('Hold'))
  await new Promise(done => setImmediate(done))
  await assert.rejects(app.bot.openLive('42:42', 'v=0', 'conversation'), /busy/)
  await assert.rejects(app.bot.openLive('43:43', 'v=0', 'conversation'), /busy/)
  resolve('Done')
  await pending
  app.bot.stopJobs()
})
void test('attachment routing tolerates an absent caption value', async () => {
  const app = setup()
  await app.bot.handleUpdate({
    ...documentUpdate('ref.pdf'),
    message: {
      ...(
        documentUpdate(
          'ref.pdf'
        ) as Update.MessageUpdate<Message.DocumentMessage>
      ).message,
      caption: undefined
    }
  } as unknown as Update)
  app.bot.stopJobs()
})

import type { StudioState } from '../../domain/studio.js'
function studioMission(store: MemoryStateStore, index = 0) {
  return store.getRecord<StudioState>('studio', '42:42')!.missions[index]!
}
void test('autopilot persists reviewed checkpoints, returns local result versions and exposes the same owner workspace', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/autopilot Prepare a useful report'))
  assert.equal(app.model.calls.length, 0)
  let mission = studioMission(store)
  await app.bot.handleUpdate(callback(button(app, 'studio:')))
  for (let i = 0; i < 3; i++) await app.bot.tickJobs()
  mission = studioMission(store)
  assert.equal(mission.state, 'done')
  assert.equal(app.model.calls.length, 3)
  await app.bot.tickJobs()
  assert.ok(
    app.replies.some(text => text.includes(`Mission ${mission.id} · done`))
  )
  await app.bot.handleUpdate(
    callback(`studio:${mission.id}:${mission.revision}:show`)
  )
  await app.bot.handleUpdate(update(`/result ${mission.id}`))
  assert.ok(app.replies.at(-1)!.includes('Test answer'))
  const view = app.bot.workspace('42:42', mission.id)
  assert.equal(view.detail!.result!.text, 'Test answer')
  app.bot.workspaceAction('42:42', {
    action: 'edit',
    id: mission.id,
    revision: mission.revision,
    value: 'Edited report'
  })
  assert.equal(
    app.bot.workspace('42:42', mission.id).detail!.result!.text,
    'Edited report'
  )
  await app.bot.handleUpdate(update('/workspace'))
  assert.match(app.replies.at(-1)!, /MINI_APP_URL/)
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('research missions exclude private files/notes and preserve clickable evidence through the final brief', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/remember Private account note'))
  await app.bot.handleUpdate(documentUpdate('private.pdf', 'Private figures'))
  app.model.calls = []
  app.model.options = []
  app.model.answer = {
    text: 'Evidence-backed brief [1]',
    images: [],
    sources: [
      { title: 'Primary evidence', url: 'https://example.com/evidence' }
    ],
    toolsUsed: { images: 0, searches: 1 }
  }
  await app.bot.handleUpdate(update('/investigate Public release changes'))
  await app.bot.handleUpdate(callback(button(app, 'studio:')))
  for (let i = 0; i < 3; i++) await app.bot.tickJobs()
  const mission = studioMission(store)
  assert.equal(mission.state, 'done')
  assert.deepEqual(app.model.calls[0]![0]!.documents, [])
  assert.deepEqual(app.model.options[0]!.memories, [])
  assert.ok(!JSON.stringify(app.model.calls).includes('Private account note'))
  await app.bot.handleUpdate(update(`/result ${mission.id}`))
  assert.match(app.replies.at(-1)!, /https:\/\/example.com\/evidence/)
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('service chains pause on an editable draft and require exact per-service approvals before external continuation', async () => {
  const store = new MemoryStateStore(),
    settings = config(),
    provider = new FakeWorkbench()
  settings.workbench.connections = [
    {
      id: 'mail',
      owner: 42,
      title: 'Mail',
      tools: ['send'],
      server: 'https://mcp.example.com',
      authorization: 'secret'
    }
  ]
  const app = setup(undefined, 10, undefined, store, {
    provider,
    config: settings
  })
  await app.bot.handleUpdate(update('/chain mail | Prepare the reviewed email'))
  await app.bot.handleUpdate(callback(button(app, 'studio:')))
  await app.bot.tickJobs()
  let mission = studioMission(store)
  assert.equal(mission.state, 'paused')
  assert.equal(provider.calls.length, 0)
  await app.bot.handleUpdate(
    update(
      `/result edit ${mission.id} | Reviewed body, recipient draft@example.com`
    )
  )
  await app.bot.handleUpdate(update(`/mission resume ${mission.id}`))
  await app.bot.tickJobs()
  mission = studioMission(store)
  assert.equal(mission.state, 'review')
  assert.equal(
    provider.calls.filter(call => call.method === 'connection').length,
    1
  )
  await app.bot.handleUpdate(update(`/mission ${mission.id}`))
  await app.bot.handleUpdate(
    callback(button(app, 'studio:').replace(':reject:', ':approve:'))
  )
  await app.bot.tickJobs()
  mission = studioMission(store)
  assert.equal(mission.state, 'done')
  assert.equal(
    provider.calls.filter(call => call.method === 'connection').length,
    2
  )
  assert.match(mission.steps[1]!.events[0]!.text, /send/)
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('Inbox capture retains text, links, photos, documents and audio without starting a paid request', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/inbox on'))
  await app.bot.handleUpdate(update('Forwarded notes'))
  await app.bot.handleUpdate(update('https://example.com/article'))
  await app.bot.handleUpdate(photoUpdate('Reference photo'))
  await app.bot.handleUpdate(documentUpdate('notes.pdf', 'Reference file'))
  await app.bot.handleUpdate(voiceUpdate())
  const audio = {
    ...voiceUpdate(),
    message: {
      ...(voiceUpdate() as Update.MessageUpdate<Message.VoiceMessage>).message,
      audio: { file_id: 'audio', file_unique_id: 'audio', duration: 60 }
    }
  } as Update
  // Use a standalone audio message rather than a voice/audio union.
  if ('message' in audio && audio.message && 'voice' in audio.message)
    Reflect.deleteProperty(audio.message, 'voice')
  await app.bot.handleUpdate(audio)
  await app.bot.handleUpdate(documentUpdate('meeting.ogg'))
  const state = store.getRecord<StudioState>('studio', '42:42')!
  assert.equal(state.inbox.length, 7)
  assert.equal(app.model.calls.length, 0)
  assert.equal(
    store.getRecord<{ transcriptions: number }>('usage', '42:42')
      ?.transcriptions ?? 0,
    0
  )
  await app.bot.handleUpdate(update(`/inbox task ${state.inbox[0]!.id}`))
  await app.bot.handleUpdate(callback(button(app, 'daily:tasks:')))
  await app.bot.handleUpdate(update('/tasks'))
  assert.ok(app.replies.join(' ').includes('Forwarded notes'))
  await app.bot.handleUpdate(update(`/inbox plan ${state.inbox[1]!.id}`))
  assert.equal(studioMission(store).mode, 'research')
  await app.bot.handleUpdate(update('/inbox off'))
  await app.bot.handleUpdate(update('/erase confirm'))
  assert.equal(store.getRecord('studio', '42:42'), undefined)
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('Inbox recordings enter the existing transcription/protocol review and workspace downloads resolve owned artifacts only', async () => {
  const store = new MemoryStateStore(),
    provider = new FakeWorkbench(),
    settings = config()
  settings.workbench.miniAppURL = 'https://voice.example.com/voice'
  const app = setup(undefined, 10, undefined, store, {
    provider,
    config: settings
  })
  await app.bot.handleUpdate(update('/workspace'))
  assert.match(app.replies.at(-1)!, /projects, Inbox/)
  await app.bot.handleUpdate(update('/inbox on'))
  await app.bot.handleUpdate(voiceUpdate())
  await app.bot.handleUpdate(update('/inbox off'))
  const item = store.getRecord<StudioState>('studio', '42:42')!.inbox[0]!
  mock.method(globalThis, 'fetch', () =>
    Promise.resolve(
      new Response(new Uint8Array([79, 103, 103, 83, 0, 1, 2, 3]))
    )
  )
  app.model.answer = JSON.stringify({
    rows: [{ summary: 'Meeting', task: null, due: null }]
  })
  await app.bot.handleUpdate(update(`/inbox meeting ${item.id}`))
  await app.bot.handleUpdate(callback(button(app, 'provider:meeting:')))
  assert.equal(
    provider.calls.filter(call => call.method === 'meeting').length,
    1
  )
  await app.bot.handleUpdate(
    documentUpdate('data.pdf', '/autopilot Analyze selected data')
  )
  await app.bot.handleUpdate(callback(button(app, 'studio:')))
  for (let i = 0; i < 3; i++) await app.bot.tickJobs()
  const mission = studioMission(store),
    version = mission.versions.at(-1)!
  assert.equal(
    app.bot.workspaceFile('42:42', mission.id, version.id, 'result.csv').mime,
    'text/csv'
  )
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('workspace mutation shares foreground admission and mission cancellation preserves terminal results across reset/import', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/project new Work'))
  await app.bot.handleUpdate(update('/autopilot Pending'))
  await app.bot.handleUpdate(update('/project delete 1'))
  assert.equal(studioMission(store).state, 'cancelled')
  await app.bot.handleUpdate(update('/autopilot Reset me'))
  await app.bot.handleUpdate(update('/reset'))
  assert.equal(studioMission(store, 1).state, 'cancelled')
  let finish!: (value: string) => void
  app.model.reply = () =>
    new Promise(resolve => {
      finish = resolve
    })
  const pending = app.bot.handleUpdate(update('Hold'))
  await new Promise(resolve => setImmediate(resolve))
  assert.throws(
    () => app.bot.workspaceAction('42:42', { action: 'project', id: 'none' }),
    /active Telegram/
  )
  finish('Done')
  await pending
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('Inbox forwarding keeps command-like content inert and supports explicit saves from replied material', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/inbox on'))
  const forwarded = update(
    '/erase confirm'
  ) as Update.MessageUpdate<Message.TextMessage>
  forwarded.message.forward_origin = {
    type: 'hidden_user',
    sender_user_name: 'Source'
  }
  await app.bot.handleUpdate(forwarded)
  assert.equal(
    store.getRecord<StudioState>('studio', '42:42')!.inbox[0]!.text,
    '/erase confirm'
  )
  await app.bot.handleUpdate(update('/inbox off'))
  const replied = update(
    '/inbox save'
  ) as Update.MessageUpdate<Message.TextMessage>
  replied.message.reply_to_message = (
    update('Quoted material') as Update.MessageUpdate<Message.TextMessage>
  ).message as unknown as NonNullable<Message.TextMessage['reply_to_message']>
  await app.bot.handleUpdate(replied)
  assert.equal(
    store.getRecord<StudioState>('studio', '42:42')!.inbox.at(-1)!.text,
    'Quoted material'
  )
  await app.bot.handleUpdate(
    documentUpdate('source.pdf', '/inbox save Analyze this')
  )
  await app.bot.handleUpdate(update('/inbox process'))
  assert.equal(studioMission(store).state, 'draft')
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('mission worker rejects unknown owners and suppresses quiet milestone delivery without replaying model work', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/autopilot Prepare report'))
  const state = store.getRecord<StudioState>('studio', '42:42')!
  for (const owner of ['bad', '42:43', '99:99'])
    store.putRecord('studio', owner, {
      ...state,
      missions: state.missions.map(mission => ({ ...mission, state: 'queued' }))
    })
  await app.bot.handleUpdate(update('/quiet 00:00-23:59'))
  await app.bot.handleUpdate(callback(button(app, 'studio:')))
  for (let i = 0; i < 4; i++) await app.bot.tickJobs()
  assert.equal(app.model.calls.length, 3)
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('mission and Inbox reply adapters reuse exact replied files and export the frozen context', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  const message = documentUpdate(
      'reply.pdf'
    ) as Update.MessageUpdate<Message.DocumentMessage>,
    request = update(
      '/autopilot Review the replied document'
    ) as Update.MessageUpdate<Message.TextMessage>
  request.message.reply_to_message = message.message as unknown as NonNullable<
    Message.TextMessage['reply_to_message']
  >
  await app.bot.handleUpdate(request)
  await app.bot.handleUpdate(
    update(`/mission context ${studioMission(store).id}`)
  )
  assert.equal(app.documents.length, 1)
  const save = update(
    '/inbox save'
  ) as Update.MessageUpdate<Message.TextMessage>
  save.message.reply_to_message = message.message as unknown as NonNullable<
    Message.TextMessage['reply_to_message']
  >
  await app.bot.handleUpdate(save)
  assert.equal(
    store.getRecord<StudioState>('studio', '42:42')!.inbox[0]!.documents[0]!
      .name,
    'reply.pdf'
  )
  await app.bot.handleUpdate(update('/inbox save'))
  assert.match(app.replies.at(-1)!, /Inbox needs content/)
  await app.bot.handleUpdate(update('/inbox on'))
  const audio = {
    update_id: ++sequence,
    message: {
      message_id: sequence,
      date: 1,
      from: { id: 42, is_bot: false, first_name: 'User' },
      chat: { id: 42, type: 'private', first_name: 'User' },
      caption: 'Meeting notes',
      audio: { file_id: 'a', file_unique_id: 'a', duration: 60 }
    }
  } as Update
  await app.bot.handleUpdate(audio)
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('mission cancellation bypasses saturated admission while preserving exact owner/revision controls', async () => {
  const store = new MemoryStateStore(),
    settings = config()
  settings.maxConcurrentRequests = 1
  const model = new FakeModel()
  model.reply = (_messages, options) =>
    new Promise((_resolve, reject) =>
      options!.signal!.addEventListener(
        'abort',
        () => reject(new Error('Cancelled provider request')),
        { once: true }
      )
    )
  const app = setup(model, 1, undefined, store, { config: settings })
  await app.bot.handleUpdate(update('/autopilot Hold'))
  await app.bot.handleUpdate(callback(button(app, 'studio:')))
  const work = app.bot.tickJobs()
  await new Promise(resolve => setImmediate(resolve))
  const mission = studioMission(store)
  assert.equal(mission.state, 'running')
  await app.bot.handleUpdate(update(`/mission cancel ${mission.id}`))
  await work
  assert.equal(studioMission(store).state, 'cancelled')
  assert.equal(studioMission(store).versions.length, 0)
  await app.bot.handleUpdate(update('/autopilot Callback cancellation'))
  const next = studioMission(store, 1)
  await app.bot.handleUpdate(update('/new Other'))
  await app.bot.handleUpdate(
    callback(`studio:${next.id}:${next.revision}:cancel`)
  )
  assert.equal(studioMission(store, 1).state, 'draft')
  await app.bot.handleUpdate(update('/switch 1'))
  await app.bot.handleUpdate(
    callback(`studio:${next.id}:${next.revision}:cancel`)
  )
  assert.equal(studioMission(store, 1).state, 'cancelled')
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('workspace can cancel an owned mission while a separate foreground request is active', async () => {
  const store = new MemoryStateStore(),
    app = setup(undefined, 10, undefined, store)
  await app.bot.handleUpdate(update('/autopilot Cancel from workspace'))
  const mission = studioMission(store)
  let finish!: (value: string) => void
  app.model.reply = () =>
    new Promise(resolve => {
      finish = resolve
    })
  const pending = app.bot.handleUpdate(update('Foreground'))
  await new Promise(resolve => setImmediate(resolve))
  app.bot.workspaceAction('42:42', {
    action: 'cancel',
    id: mission.id,
    revision: mission.revision
  })
  assert.equal(studioMission(store).state, 'cancelled')
  finish('Done')
  await pending
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('Suite Telegram wiring freezes explicit replied images and text, keeps ZIP local and admits video only after reviewed plans', async () => {
  const { suiteSetup } = await import('../../__tests__/suite.js'),
    helper = suiteSetup(),
    store = new MemoryStateStore(),
    settings = { ...config(), statePath: '/unit/state.db' },
    app = setup(undefined, 10, undefined, store, {
      config: settings,
      assets: helper.assets
    })
  mock.method(globalThis, 'fetch', () =>
    Promise.resolve(new Response('PK-mocked-archive'))
  )
  const replied = (text: string, content: Record<string, unknown>) => {
    const item = update(text)
    if ('message' in item)
      Object.assign(item.message, {
        reply_to_message: {
          message_id: 100,
          date: 1,
          chat: { id: 42, type: 'private' },
          from: { id: 43, first_name: 'Other', is_bot: false },
          ...content
        }
      })
    return item
  }
  await app.bot.handleUpdate(
    replied('/suite decision | Extract decision', {
      text: 'We chose the smaller launch.'
    })
  )
  assert.equal(
    studioMission(store).input.sources![0]!.text,
    'We chose the smaller launch.'
  )
  await app.bot.handleUpdate(
    replied('/suite screen | Explain this screenshot', {
      photo: [
        { file_id: 'photo-id', file_unique_id: 'p', width: 200, height: 100 }
      ]
    })
  )
  assert.equal(studioMission(store, 1).input.images.length, 1)
  await app.bot.handleUpdate(
    replied('/suite brand | Report', {
      document: {
        file_id: 'doc-id',
        file_unique_id: 'd',
        file_name: 'report.pdf',
        mime_type: 'application/pdf'
      }
    })
  )
  assert.equal(studioMission(store, 2).input.documents.length, 1)
  const zip = {
    file_id: 'zip-id',
    file_unique_id: 'z',
    file_name: 'files.zip',
    mime_type: 'application/zip'
  }
  await app.bot.handleUpdate(replied('/suite zip', { document: zip }))
  assert.match(app.replies.at(-1)!, /Exact byte duplicates/)
  await app.bot.handleUpdate(
    replied('/suite zip', {
      document: { ...zip, file_size: settings.maxDocumentBytes + 1 }
    })
  )
  assert.match(app.replies.at(-1)!, /exceeds/)
  const message = update(''),
    video = {
      file_id: 'video-id',
      file_unique_id: 'v',
      width: 200,
      height: 100,
      duration: 30,
      file_size: 100
    }
  if ('message' in message) {
    delete (message.message as unknown as Record<string, unknown>).text
    Object.assign(message.message, { video })
  }
  await app.bot.handleUpdate(message)
  assert.match(app.replies.at(-1)!, /Video received/)
  await app.bot.handleUpdate(
    replied('/suite video 0 no | Summarize this clip', { video })
  )
  let mission = studioMission(store, 3)
  assert.equal(mission.input.video!.seconds, 30)
  app.bot.workspaceAction('42:42', {
    action: 'start',
    id: mission.id,
    revision: mission.revision
  })
  await app.bot.tickJobs()
  mission = studioMission(store, 3)
  assert.match(mission.steps[0]!.output!.text, /Sampled clip/)
  const docVideo = {
    file_id: 'document-video',
    file_unique_id: 'dv',
    file_name: 'movie.mp4',
    mime_type: 'video/mp4'
  }
  await app.bot.handleUpdate(
    replied('/suite video 1 yes | Review', { document: docVideo })
  )
  assert.equal(studioMission(store, 4).input.video!.seconds, null)
  const captioned = update('')
  if ('message' in captioned) {
    delete (captioned.message as unknown as Record<string, unknown>).text
    Object.assign(captioned.message, {
      video,
      caption: '/suite video 0 no | Captioned review'
    })
  }
  await app.bot.handleUpdate(captioned)
  assert.equal(studioMission(store, 5).input.video!.name, 'recording.mp4')
  for (const caption of [undefined, '/suite zip']) {
    const item = update('')
    if ('message' in item) {
      delete (item.message as unknown as Record<string, unknown>).text
      Object.assign(item.message, {
        document: zip,
        ...(caption ? { caption } : {})
      })
    }
    await app.bot.handleUpdate(item)
  }
  const docCaption = update('')
  if ('message' in docCaption) {
    delete (docCaption.message as unknown as Record<string, unknown>).text
    Object.assign(docCaption.message, {
      document: docVideo,
      caption: '/suite video 0 no | Document caption'
    })
  }
  await app.bot.handleUpdate(docCaption)
  assert.equal(studioMission(store, 6).input.video!.file, docVideo.file_id)
  await app.bot.handleUpdate(update('/suite video 0 no | Missing video'))
  assert.match(app.replies.at(-1)!, /Reply to an MP4/)
  app.bot.stopJobs()
  assert.equal(app.errors(), 0)
})
void test('Suite watch ports read pinned public articles and hash owned project files, respect quiet delivery and never invoke a model', async () => {
  const { Watches } = await import('../../application/watches.js'),
    { Workspaces } = await import('../../application/workspaces.js'),
    { suiteSetup } = await import('../../__tests__/suite.js')
  const store = new MemoryStateStore(),
    settings = { ...config(), statePath: '/unit/state.db' },
    helper = suiteSetup(),
    ws = new Workspaces(settings, store),
    project = ws.create('42:42', 'Watched project'),
    file = { name: 'report.txt', mime: 'text/plain', data: 'QQ==' }
  ws.updateProject('42:42', project.id, 'attach', file)
  let text = 'Initial public article'
  const app = setup(undefined, 10, undefined, store, {
    config: settings,
    assets: helper.assets,
    readArticle: value =>
      Promise.resolve({
        url: value,
        title: 'Public article',
        text,
        truncated: false
      })
  })
  await app.bot.handleUpdate(update('/suite watch url https://example.com 1'))
  await app.bot.tickJobs()
  const watches = new Watches(
    settings,
    {
      allowed: () => true,
      read: () => Promise.resolve({ title: 'Unused', text: 'Unused' }),
      notify: () => Promise.resolve()
    },
    store
  )
  const watch = watches.get('42:42')[0]!
  text = 'Completely changed public article'
  await app.bot.handleUpdate(update(`/suite watch check ${watch.id}`))
  assert.ok(
    app.replies.some(reply =>
      reply.startsWith(`Watch ${watch.id}: material changed`)
    )
  )
  await app.bot.handleUpdate(update('/quiet 00:00-23:59'))
  text = 'Another complete change'
  await app.bot.handleUpdate(update(`/suite watch check ${watch.id}`))
  await app.bot.handleUpdate(
    update(`/suite watch file ${project.id} 1 | ${file.name}`)
  )
  await app.bot.tickJobs()
  const fileWatch = watches
    .get('42:42')
    .find(item => item.target.kind === 'file')!
  assert.match(fileWatch.baseline!.text, /digest/)
  await app.bot.handleUpdate(update(`/project delete ${project.id}`))
  await app.bot.handleUpdate(update(`/suite watch check ${fileWatch.id}`))
  assert.match(app.replies.at(-1)!, /no longer exists/)
  for (const owner of ['42:43', '42:42:1', '99:99'])
    watches.add(
      owner,
      '1',
      { kind: 'url', url: `https://example.com/${owner}` },
      3600000,
      0
    )
  await app.bot.tickJobs()
  await app.bot.handleUpdate(update('/data'))
  assert.ok(app.documents.length)
  await app.bot.handleUpdate(update('/erase confirm'))
  assert.equal(
    store.records('watches').some(([owner]) => owner === '42:42'),
    false
  )
  app.bot.stopJobs()
  assert.equal(app.model.calls.length, 0)
  assert.equal(app.errors(), 0)
})
void test('Suite local ports revalidate source project bindings and handle current, absent and replied document sources', async () => {
  const { suiteSetup } = await import('../../__tests__/suite.js'),
    helper = suiteSetup(),
    store = new MemoryStateStore(),
    settings = { ...config(), statePath: '/unit/state.db' },
    app = setup(undefined, 10, undefined, store, {
      config: settings,
      assets: helper.assets
    })
  await app.bot.handleUpdate(update('/suite brand | Report'))
  const mission = studioMission(store)
  app.bot.workspaceAction('42:42', {
    action: 'start',
    id: mission.id,
    revision: mission.revision
  })
  await app.bot.handleUpdate(update('/project new Different project'))
  await app.bot.tickJobs()
  assert.equal(studioMission(store).state, 'uncertain')
  assert.equal(app.model.calls.length, 0)
  await app.bot.handleUpdate(update('/suite zip'))
  assert.match(app.replies.at(-1)!, /Reply to a ZIP/)
  const reply = update('/suite brand-template import company')
  if ('message' in reply)
    Object.assign(reply.message, {
      reply_to_message: {
        message_id: 100,
        date: 1,
        chat: { id: 42, type: 'private' },
        document: { file_id: 'd', file_unique_id: 'u', file_name: 'report.pdf' }
      }
    })
  await app.bot.handleUpdate(reply)
  assert.match(app.replies.at(-1)!, /Imported palette/)
  await app.bot.handleUpdate(update('/suite team create | Team'))
  const teams = app.bot.workspace('42:42').suite!.teams,
    team = teams[0]!
  const current = update('')
  if ('message' in current) {
    delete (current.message as unknown as Record<string, unknown>).text
    Object.assign(current.message, {
      document: { file_id: 'd', file_unique_id: 'u', file_name: 'report.pdf' },
      caption: `/suite team publish ${team.id}`
    })
  }
  await app.bot.handleUpdate(current)
  assert.match(app.replies.at(-1)!, /Files: report.pdf/)
  const unnamed = update('/suite brand-template import missing')
  if ('message' in unnamed)
    Object.assign(unnamed.message, {
      reply_to_message: {
        message_id: 101,
        date: 1,
        chat: { id: 42, type: 'private' },
        document: { file_id: 'd', file_unique_id: 'u' }
      }
    })
  // The injected downloader deliberately rejects unrecognized document names.
  await app.bot.handleUpdate(unnamed)
  await app.bot.handleUpdate(update('/erase confirm'))
  assert.equal(store.records('teams').length, 0)
  app.bot.stopJobs()
})
void test('Suite video transcription uses the meeting WAV port and preserves the shared estimate ledger', async () => {
  const { suiteSetup } = await import('../../__tests__/suite.js'),
    helper = suiteSetup(),
    store = new MemoryStateStore()
  helper.assets.video = () =>
    Promise.resolve({
      duration: 30,
      start: 0,
      seconds: 10,
      frames: [],
      audio: Buffer.from('RIFF-unit-audio')
    })
  const app = setup(undefined, 10, undefined, store, {
    provider: helper.provider,
    assets: helper.assets
  })
  mock.method(globalThis, 'fetch', () =>
    Promise.resolve(new Response('mocked input video'))
  )
  const item = update('/suite video 0 yes | Review')
  if ('message' in item)
    Object.assign(item.message, {
      reply_to_message: {
        message_id: 100,
        date: 1,
        chat: { id: 42, type: 'private' },
        video: {
          file_id: 'video-id',
          file_unique_id: 'v',
          width: 10,
          height: 10,
          duration: 30
        }
      }
    })
  await app.bot.handleUpdate(item)
  const mission = studioMission(store)
  app.bot.workspaceAction('42:42', {
    action: 'start',
    id: mission.id,
    revision: mission.revision
  })
  await app.bot.tickJobs()
  const call = helper.provider.calls.find(call => call.method === 'meeting')!
  assert.match(JSON.stringify(call.value), /audio\/wav/)
  assert.match(JSON.stringify(call.value), /video-clip.wav/)
  app.bot.stopJobs()
})
