import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Profiles } from '../profiles.js'
import { SQLiteStateStore } from '../../infrastructure/state-store.js'
import { config } from '../../__tests__/helpers.js'

void test('named conversations and explicit notes are isolated, bounded and durable', t => {
  const directory = mkdtempSync(join(tmpdir(), 'telegram-state-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'private', 'state.sqlite')
  let store = new SQLiteStateStore(path)
  let profiles = new Profiles(
    { ...config(), maxThreads: 2, maxMemories: 2, maxMemoryCharacters: 20 },
    store
  )
  assert.equal(profiles.get('alice').active, '1')
  profiles.create('alice', 'Work')
  profiles.rename('alice', 'Research')
  profiles.remember('alice', 'Russian')
  profiles.remember('alice', 'Russian') // duplicate does not consume a slot
  profiles.remember('alice', 'TypeScript')
  profiles.voice('alice', 'auto')
  assert.throws(() => profiles.create('alice', 'Third'), /limit/)
  assert.throws(() => profiles.remember('alice', 'Another'), /limit/)
  assert.throws(() => profiles.remember('alice', 'X'.repeat(30)), /character/)
  assert.equal(profiles.get('bob').memories.length, 0)
  const snapshot = profiles.get('alice')
  snapshot.memories.length = 0
  assert.equal(profiles.get('alice').memories.length, 2)
  store.close()
  store = new SQLiteStateStore(path)
  profiles = new Profiles(config(), store)
  assert.equal(profiles.get('alice').active, '2')
  assert.equal(profiles.get('alice').voice, 'auto')
  assert.equal(profiles.get('alice').threads[1]?.title, 'Research')
  profiles.forget('alice', '1')
  assert.deepEqual(profiles.get('alice').memories, ['TypeScript'])
  profiles.forget('alice', 'typescript')
  profiles.remember('alice', 'note')
  profiles.forget('alice', 'all')
  assert.deepEqual(profiles.get('alice').memories, [])
  profiles.switch('alice', '1')
  profiles.delete('alice', '1')
  assert.equal(profiles.get('alice').active, '2')
  assert.throws(() => profiles.delete('alice', '2'), /at least one/)
  assert.throws(() => profiles.delete('alice', '999'), /not found/)
  assert.throws(() => profiles.switch('alice', '999'), /not found/)
  assert.throws(() => profiles.rename('alice', ''), /name/)
  assert.throws(() => profiles.rename('alice', 'a\nb'), /name/)
  assert.throws(() => profiles.rename('alice', 'a'.repeat(81)), /name/)
  assert.throws(() => profiles.forget('alice', '0'), /not found/)
  assert.throws(() => profiles.voice('alice', 'invalid'), /Usage/)
  if (process.platform !== 'win32')
    assert.equal(statSync(path).mode & 0o777, 0o600)
  store.close()
})

void test('unnamed conversations receive stable titles and deleting a non-active conversation keeps selection', () => {
  const profiles = new Profiles(config())
  profiles.create('a', '')
  assert.equal(profiles.get('a').threads[1]?.title, 'Chat 2')
  profiles.delete('a', '1')
  assert.equal(profiles.get('a').active, '2')
})

void test('memory entry count is enforced independently of character budget', () => {
  const profiles = new Profiles({ ...config(), maxMemories: 1 })
  profiles.remember('a', 'first')
  assert.throws(() => profiles.remember('a', 'second'), /Memory limit/)
  assert.throws(() => profiles.remember('a', ''), /empty/)
})
