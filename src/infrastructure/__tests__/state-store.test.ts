import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import sqlite from 'node:sqlite'

const calls: { sql: string; values: unknown[] }[] = []
let version: number | undefined = 0
let rows: unknown[] = []
let row: unknown = undefined
let fail = false
let closed = 0
mock.module('node:fs', {
  exports: { mkdirSync: mock.fn(), chmodSync: mock.fn() }
})
mock.property(
  sqlite,
  'DatabaseSync',
  class {
    exec(sql: string) {
      calls.push({ sql, values: [] })
    }
    prepare(sql: string) {
      return {
        get: () =>
          sql === 'PRAGMA user_version' ? { user_version: version } : row,
        all: () => rows,
        run: (...values: unknown[]) => {
          if (fail) throw new Error('write failed')
          calls.push({ sql, values })
        }
      }
    }
    close() {
      closed++
    }
  } as unknown as typeof sqlite.DatabaseSync
)
const { SQLiteStateStore } = await import('../state-store.js')

void test('store accepts supported versions, restricts file permissions and rejects unknown versions', () => {
  for (const value of [0, 1, 2]) {
    version = value
    const store = new SQLiteStateStore('private/state.sqlite')
    store.close()
  }
  version = 99
  assert.throws(() => new SQLiteStateStore(':memory:'), /version/)
  version = undefined
  assert.throws(() => new SQLiteStateStore(':memory:'), /version/)
  assert.equal(closed, 5)
  version = 0
})
void test('session replacement uses parameter binding and commits eviction in the same transaction', () => {
  const store = new SQLiteStateStore(':memory:')
  calls.length = 0
  const session = { messages: [], expiresAt: 123 }
  store.putSession('owner:1', session, ['owner:2'])
  assert.equal(calls[0]?.sql, 'BEGIN IMMEDIATE')
  assert.deepEqual(calls[1]?.values.slice(0, 2), [
    'owner:1',
    JSON.stringify(session)
  ])
  assert.deepEqual(calls[2]?.values, ['owner:2'])
  assert.equal(calls[3]?.sql, 'COMMIT')
  fail = true
  assert.throws(() => store.putSession('owner', session), /write failed/)
  assert.equal(calls.at(-1)?.sql, 'ROLLBACK')
  fail = false
  rows = [{ key: 'owner:1', data: JSON.stringify(session) }]
  assert.deepEqual(store.sessions(), [['owner:1', session]])
  rows = [{ key: 'bad', data: '{"messages":null,"expiresAt":0}' }]
  assert.throws(() => store.sessions(), /Invalid stored session/)
  rows = [{ key: 'bad', data: '{"messages":[],"expiresAt":null}' }]
  assert.throws(() => store.sessions(), /Invalid stored session/)
})
void test('profile persistence validates structure and binds private data without interpolation', () => {
  const store = new SQLiteStateStore(':memory:')
  row = undefined
  assert.equal(store.getProfile('owner'), undefined)
  const profile = {
    active: '1',
    nextId: 2,
    threads: [{ id: '1', title: 'Main' }],
    memories: [],
    voice: 'off' as const
  }
  store.putProfile('owner', profile)
  assert.deepEqual(calls.at(-1)?.values, ['owner', JSON.stringify(profile)])
  row = { data: JSON.stringify(profile) }
  assert.deepEqual(store.getProfile('owner'), profile)
  for (const invalid of [
    {},
    { ...profile, memories: null },
    { ...profile, active: 'missing' },
    { ...profile, nextId: 1.5 },
    { ...profile, voice: 'invalid' }
  ]) {
    row = { data: JSON.stringify(invalid) }
    assert.throws(() => store.getProfile('owner'), /Invalid stored profile/)
  }
})

void test('generic records are scoped and content erasure preserves only operational daily usage', () => {
  const store = new SQLiteStateStore(':memory:')
  row = undefined
  assert.equal(store.getRecord('workspace', 'a'), undefined)
  store.putRecord('workspace', 'a', { timezone: 'UTC' })
  assert.deepEqual(calls.at(-1)?.values, [
    'workspace',
    'a',
    '{"timezone":"UTC"}'
  ])
  row = { data: '{"timezone":"UTC"}' }
  assert.deepEqual(store.getRecord('workspace', 'a'), { timezone: 'UTC' })
  rows = [{ key: 'a', data: '{"timezone":"UTC"}' }]
  assert.deepEqual(store.records('workspace'), [['a', { timezone: 'UTC' }]])
  store.deleteRecord('workspace', 'a')
  assert.deepEqual(calls.at(-1)?.values, ['workspace', 'a'])
  calls.length = 0
  store.deleteOwner('42:42')
  assert.equal(calls[0]?.sql, 'BEGIN IMMEDIATE')
  assert.deepEqual(calls[2]?.values, ['42:42:', '42:42:'])
  assert.match(calls[3]!.sql, /scope != 'usage'/)
  assert.equal(calls.at(-1)?.sql, 'COMMIT')
  fail = true
  assert.throws(() => store.deleteOwner('42:42'), /write failed/)
  assert.equal(calls.at(-1)?.sql, 'ROLLBACK')
  fail = false
})

void test('archive merge commits profile, sessions and scoped records atomically with rollback on failure', () => {
  const store = new SQLiteStateStore(':memory:'),
    profile = {
      active: '1',
      nextId: 2,
      threads: [{ id: '1', title: 'Main' }],
      memories: [],
      voice: 'off' as const
    }
  calls.length = 0
  store.commitImport(
    'a',
    profile,
    [['a:2', { messages: [], expiresAt: 10 }]],
    [['workspace', { projects: [] }]]
  )
  assert.equal(calls[0]!.sql, 'BEGIN IMMEDIATE')
  assert.equal(calls.at(-1)!.sql, 'COMMIT')
  assert.ok(calls.some(item => item.values[0] === 'a:2'))
  fail = true
  assert.throws(() => store.commitImport('a', profile, [], []))
  assert.equal(calls.at(-1)!.sql, 'ROLLBACK')
  fail = false
})
