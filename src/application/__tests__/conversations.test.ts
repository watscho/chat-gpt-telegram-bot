import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SQLiteStateStore } from '../../infrastructure/state-store.js'
import { Conversations } from '../conversations.js'
import { config, FakeModel } from '../../__tests__/helpers.js'

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
  const store = new SQLiteStateStore(':memory:')
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
  const store = new SQLiteStateStore(':memory:')
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
  const store = new SQLiteStateStore(':memory:')
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
