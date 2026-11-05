import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { SQLiteStateStore } from '../state-store.js'

void test('unsupported or corrupt state fails closed, and session transactions roll back', t => {
  const directory = mkdtempSync(join(tmpdir(), 'telegram-state-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'state.sqlite')
  let db = new DatabaseSync(path)
  db.exec('PRAGMA user_version = 99')
  db.close()
  assert.throws(() => new SQLiteStateStore(path), /version/)
  db = new DatabaseSync(path)
  db.exec('PRAGMA user_version = 0')
  db.close()
  const store = new SQLiteStateStore(path)
  db = new DatabaseSync(path)
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(
    'bad',
    '{"messages":null,"expiresAt":0}',
    0
  )
  assert.throws(() => store.sessions(), /Invalid stored session/)
  db.exec('DELETE FROM sessions')
  db.prepare('INSERT INTO profiles VALUES (?, ?)').run('bad', '{}')
  assert.throws(() => store.getProfile('bad'), /Invalid stored profile/)
  db.exec(
    "CREATE TRIGGER fail_insert BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'fail'); END"
  )
  assert.throws(
    () => store.putSession('a', { messages: [], expiresAt: 1 }),
    /fail/
  )
  assert.equal(store.sessions().length, 0)
  db.close()
  store.close()
})
