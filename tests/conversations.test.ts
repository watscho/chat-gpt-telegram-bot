import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Conversations } from '../src/application/conversations.js'
import { config, FakeModel } from './helpers.js'

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
