import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Conversations } from '../conversations.js'
import { config, FakeModel, MemoryStateStore } from '../../__tests__/helpers.js'

void test('users have isolated histories and reset affects only one user', async () => {
  const model = new FakeModel()
  const chat = new Conversations(model, config())
  await chat.reply('alice', 'A')
  await chat.reply('bob', 'B')
  await chat.reply('alice', 'C')
  assert.deepEqual(
    model.calls.map(call => call.map(m => m.content)),
    [['A'], ['B'], ['A', 'Test answer', 'C']]
  )
  chat.reset('alice')
  await chat.reply('alice', 'D')
  await chat.reply('bob', 'E')
  assert.equal(model.calls[3]?.length, 1)
  assert.equal(model.calls[4]?.length, 3)
})
void test('failed and empty provider responses do not corrupt history', async () => {
  const model = new FakeModel()
  const chat = new Conversations(model, config())
  await chat.reply('a', 'first')
  model.failure = true
  await assert.rejects(chat.reply('a', 'failed'))
  model.failure = false
  model.answer = ' '
  await assert.rejects(chat.reply('a', 'empty'))
  model.answer = 'ok'
  await chat.reply('a', 'retry')
  assert.deepEqual(
    model.calls.at(-1)?.map(m => m.content),
    ['first', 'Test answer', 'retry']
  )
})
void test('TTL expiry and capacity eviction discard old histories', async () => {
  let now = 0
  const model = new FakeModel()
  const chat = new Conversations(
    model,
    { ...config(), maxSessions: 1, sessionTtlMs: 100 },
    () => now
  )
  await chat.reply('a', 'a')
  now = 100
  await chat.reply('a', 'expired')
  assert.equal(model.calls.at(-1)?.length, 1)
  await chat.reply('b', 'b')
  await chat.reply('a', 'evicted')
  assert.equal(model.calls.at(-1)?.length, 1)
})
void test('history retains complete turns within turn and character limits', async () => {
  const model = new FakeModel()
  model.answer = 'OK'
  const chat = new Conversations(model, {
    ...config(),
    maxHistoryTurns: 2,
    maxHistoryCharacters: 8
  })
  for (const text of ['aa', 'bb', 'cc', 'dd']) await chat.reply('a', text)
  assert.deepEqual(
    model.calls.at(-1)?.map(m => m.content),
    ['cc', 'OK', 'dd']
  )
})
void test('invalid inputs never invoke the provider', async () => {
  const model = new FakeModel()
  const chat = new Conversations(model, { ...config(), maxInputCharacters: 3 })
  await assert.rejects(chat.reply('a', '  '))
  await assert.rejects(chat.reply('a', 'long'))
  assert.equal(model.calls.length, 0)
})

void test('an oversized completed answer is delivered but its entire turn is discarded', async () => {
  const model = new FakeModel()
  const chat = new Conversations(model, {
    ...config(),
    maxHistoryCharacters: 10
  })
  model.answer = 'x'.repeat(100)
  assert.equal((await chat.reply('a', 'hi')).length, 100)
  assert.equal(chat.lastReply('a'), undefined)
  model.answer = 'ok'
  await chat.reply('a', 'retry')
  assert.equal(model.calls.at(-1)?.length, 1)
})

void test('text, files and generated image history survive restart, expire and clear durably', async () => {
  const store = new MemoryStateStore()
  const model = new FakeModel()
  let now = 1
  let conversations = new Conversations(
    model,
    { ...config(), sessionTtlMs: 100 },
    () => now,
    store
  )
  const document = {
    name: 'test.pdf',
    mime: 'application/pdf',
    data: 'JVBERi0xLjQ='
  }
  const image = { data: 'iVBORw0KGgo=', mime: 'image/png' as const }
  await conversations.respond('alice:1', 'read', [image], {
    documents: [document]
  })
  conversations = new Conversations(
    model,
    { ...config(), sessionTtlMs: 100 },
    () => now,
    store
  )
  await conversations.respond('alice:1', 'follow-up')
  assert.deepEqual(model.calls.at(-1)?.[0]?.documents, [document])
  assert.deepEqual(model.calls.at(-1)?.[0]?.images, [image])
  assert.equal(conversations.lastReply('alice:1'), 'Test answer')
  conversations.reset('alice:1')
  assert.equal(store.sessions().length, 0)
  await conversations.respond('alice:1', 'again')
  now = 101
  conversations = new Conversations(model, config(), () => now, store)
  assert.equal(conversations.lastReply('alice:1'), undefined)
  assert.equal(store.sessions().length, 0)
  store.close()
})

void test('restart reapplies lowered budgets; persistent capacity evictions remove old sessions', async () => {
  const store = new MemoryStateStore()
  const model = new FakeModel()
  const chat = new Conversations(model, config(), Date.now, store)
  await chat.reply('a', 'first')
  await chat.reply('b', 'second')
  new Conversations(model, { ...config(), maxSessions: 1 }, Date.now, store)
  assert.deepEqual(
    store.sessions().map(([key]) => key),
    ['b']
  )
  new Conversations(
    model,
    { ...config(), maxHistoryCharacters: 1 },
    Date.now,
    store
  )
  assert.equal(store.sessions().length, 0)
  const bounded = new Conversations(
    model,
    { ...config(), maxSessions: 1 },
    Date.now,
    store
  )
  await bounded.reply('a', 'a')
  await bounded.reply('b', 'b')
  assert.deepEqual(
    store.sessions().map(([key]) => key),
    ['b']
  )
  await assert.rejects(
    bounded.respond('b', 'file', [], {
      documents: [
        { name: 'large.txt', mime: 'text/plain', data: 'A'.repeat(13333340) }
      ]
    }),
    /Document/
  )
  store.close()
})

void test('failed durable commit preserves prior in-memory history', async () => {
  const store = new MemoryStateStore()
  const model = new FakeModel()
  const chat = new Conversations(model, config(), Date.now, store)
  await chat.reply('a', 'first')
  store.putSession = () => {
    throw new Error('disk full')
  }
  await assert.rejects(chat.reply('a', 'second'), /disk full/)
  assert.equal(chat.lastReply('a'), 'Test answer')
  assert.equal(store.sessions()[0]?.[1].messages.length, 2)
  store.close()
})

const image = { data: 'iVBORw0KGgo=', mime: 'image/png' as const }

void test('image history is isolated, expires, resets, and is unchanged on provider failure', async () => {
  let now = 0
  const model = new FakeModel()
  const chat = new Conversations(
    model,
    { ...config(), sessionTtlMs: 100 },
    () => now
  )
  await chat.respond('a', 'describe', [image])
  await chat.respond('b', 'hello')
  assert.equal(
    model.calls.at(-1)?.some(m => m.images?.length),
    false
  )
  model.failure = true
  await assert.rejects(
    chat.respond('a', 'failed', [{ ...image, data: '/9j/AA==' }])
  )
  model.failure = false
  await chat.respond('a', 'retry')
  assert.deepEqual(
    model.calls.at(-1)?.flatMap(m => m.images ?? []),
    [image]
  )
  now = 100
  await assert.rejects(
    chat.respond('a', 'edit', [], { action: 'edit' }),
    /Send a photo first/
  )
  await chat.respond('a', 'describe', [image])
  chat.reset('a')
  await assert.rejects(chat.respond('a', 'edit', [], { action: 'edit' }))
})

void test('session and global encoded image budgets evict complete turns and sessions', async () => {
  const model = new FakeModel()
  const chat = new Conversations(model, {
    ...config(),
    maxHistoryImageBytes: 12,
    maxTotalImageBytes: 12
  })
  await chat.respond('a', 'first', [image])
  await chat.respond('a', 'second', [image])
  assert.equal(model.calls.at(-1)?.length, 1)
  await chat.respond('b', 'photo', [image])
  await assert.rejects(chat.respond('a', 'edit', [], { action: 'edit' }))
  await assert.rejects(
    chat.respond('c', 'two images', [image, image]),
    /memory/
  )
})

void test('generated images remain available for subsequent edits without assistant text', async () => {
  const model = new FakeModel()
  const chat = new Conversations(model, config())
  model.answer = { text: '', images: [image] }
  await chat.respond('a', 'create cat', [], { action: 'generate' })
  model.answer = 'done'
  await chat.respond('a', 'add a hat', [], { action: 'edit' })
  assert.deepEqual(model.calls.at(-1)?.[1]?.images, [image])
})

void test('cancelled requests never start or commit a late provider answer; local validation precedes billing hooks', async () => {
  const model = new FakeModel()
  const chat = new Conversations(model, config())
  const stopped = new AbortController()
  stopped.abort()
  await assert.rejects(
    chat.respond('a:1', 'hello', [], { signal: stopped.signal }),
    /stopped/
  )
  assert.equal(model.calls.length, 0)
  let charged = 0
  await assert.rejects(
    chat.respond('a:1', '', [], {
      onStart: () => {
        charged++
      }
    })
  )
  assert.equal(charged, 0)
  const controller = new AbortController()
  model.reply = () => {
    controller.abort()
    return Promise.resolve('late response')
  }
  await assert.rejects(
    chat.respond('a:1', 'hello', [], { signal: controller.signal }),
    /stopped/
  )
  assert.equal(chat.history('a:1').length, 0)
})
void test('owned history search, legacy image versions and retention are bounded and scoped', async () => {
  const store = new MemoryStateStore()
  store.putSession('a:1', {
    messages: [
      { role: 'user', content: 'Question' },
      {
        role: 'assistant',
        content: 'DECISION: use TypeScript',
        images: [image]
      }
    ],
    expiresAt: 100000
  })
  store.putSession('b:1', {
    messages: [{ role: 'user', content: 'Private decision' }],
    expiresAt: 100000
  })
  const chat = new Conversations(new FakeModel(), config(), () => 0, store)
  assert.equal(chat.search('a', 'decision').length, 1)
  assert.equal(chat.search('a', 'private').length, 0)
  assert.throws(() => chat.search('a', ''), /between/)
  assert.throws(() => chat.search('a', 'a'.repeat(121)))
  assert.match(chat.versions('a:1')[0]!.id, /^legacy-[0-9a-f]{16}\.0$/)
  chat.retention('a:1', 60)
  assert.equal(
    store.sessions().find(([key]) => key === 'a:1')?.[1].expiresAt,
    60000
  )
  chat.retention('missing', 60)
  const local = new Conversations(new FakeModel(), config())
  await local.respond('a:1', 'hello', [], {
    retentionSeconds: 120,
    onStart: () => {}
  })
  local.retention('a:1', 60)
  chat.forgetOwner('a')
  assert.equal(chat.owned('a').length, 0)
  assert.equal(chat.owned('b').length, 1)
})

void test('legacy image source IDs remain stable when earlier history turns are trimmed', async () => {
  const store = new MemoryStateStore()
  store.putSession('a:1', {
    messages: [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: '', images: [image] },
      { role: 'user', content: 'second' },
      {
        role: 'assistant',
        content: '',
        images: [{ ...image, data: 'iVBORw0KGgoA' }]
      }
    ],
    expiresAt: 100000
  })
  const chat = new Conversations(
    new FakeModel(),
    { ...config(), maxHistoryTurns: 2 },
    () => 0,
    store
  )
  const selected = chat.versions('a:1')[1]!.id
  await chat.reply('a:1', 'next')
  assert.equal(chat.versions('a:1')[0]?.id, selected)
})

void test('branching preserves originals, rejects invalid targets/capacity, and preview exclusions affect provider input only', async () => {
  const model = new FakeModel(),
    store = new MemoryStateStore(),
    limits = config()
  const chat = new Conversations(model, limits, () => 0, store)
  await chat.respond('a:1', 'Original', [image])
  for (const turn of [-1, 0.5, 2])
    assert.throws(() => chat.fork('a:1', 'a:2', turn))
  chat.fork('a:1', 'a:2', 1)
  assert.equal(chat.history('a:1').length, 2)
  assert.equal(
    new Conversations(model, limits, () => 0, store).history('a:2').length,
    2
  )
  assert.throws(() => chat.fork('a:1', 'a:2', 1))
  limits.maxTotalImageBytes = image.data.length * 2 - 1
  assert.throws(() => chat.fork('a:1', 'a:3', 1), /capacity/)
  const local = new Conversations(model, config(), () => 0)
  local.fork('missing', 'new', 0)
  assert.deepEqual(local.history('new'), [])
  await chat.respond('a:1', 'Only this request', [], { contextHistory: [] })
  assert.equal(model.calls.at(-1)!.length, 1)
  assert.ok(chat.history('a:1').some(item => item.content === 'Original'))
  await assert.rejects(
    chat.respond('a:1', 'Edit', [], { action: 'edit', contextHistory: [] }),
    /photo first/
  )
})

void test('reviewed context still obeys per-request turn, character and encoded-media budgets', async () => {
  for (const overrides of [
    { maxHistoryTurns: 1 },
    { maxHistoryCharacters: 2 },
    { maxHistoryImageBytes: 1 },
    { maxTotalImageBytes: 1 }
  ]) {
    const model = new FakeModel(),
      chat = new Conversations(model, { ...config(), ...overrides })
    await chat.respond('new', 'Q', [], {
      contextHistory: [
        { role: 'user', content: 'Old content', images: [image] },
        { role: 'assistant', content: 'Old answer' }
      ]
    })
    assert.equal(model.calls[0]!.length, 1)
  }
})

void test('trimmed turns yield a local inspectable recap that commits only with the completed replacement', async () => {
  const settings = { ...config(), maxHistoryTurns: 1 },
    store = new MemoryStateStore(),
    model = new FakeModel(),
    chat = new Conversations(model, settings, () => 0, store)
  await chat.reply(
    'a:1',
    'We agreed to use plan A. Must remain private. What is pending?'
  )
  await chat.reply('a:1', 'Next question')
  assert.match(chat.recap('a:1'), /plan A/)
  assert.match(model.options.at(-1)!.summary!, /plan A/)
  chat.fork('a:1', 'a:2', 0)
  assert.match(chat.recap('a:2'), /plan A/)
  await chat.respond('a:1', 'Explicitly exclude recap', [], { summary: '' })
  assert.equal(model.options.at(-1)!.summary, '')
  const previous = chat.recap('a:1')
  model.failure = true
  await assert.rejects(chat.reply('a:1', 'Fail'))
  assert.equal(chat.recap('a:1'), previous)
  chat.clearRecap('missing')
  chat.clearRecap('a:1')
  assert.equal(chat.recap('a:1'), '')
  chat.refresh()
  assert.equal(chat.recap('a:1'), '')
  new Conversations(new FakeModel(), config()).refresh()
  const local = new Conversations(new FakeModel(), settings)
  await local.reply('a', 'First')
  await local.reply('a', 'Second')
  local.clearRecap('a')
})
