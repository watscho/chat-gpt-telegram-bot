import sqlite, { type DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Profile, Session, StateStore } from '../domain/state.js'

// The same store is used with :memory: in tests and a private file in production.
export class SQLiteStateStore implements StateStore {
  private readonly db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:')
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new sqlite.DatabaseSync(path)
    if (path !== ':memory:') chmodSync(path, 0o600)
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3) {
      this.db.close()
      throw new Error('Unsupported state database version')
    }
    this.db.exec(`
      PRAGMA secure_delete = ON;
      PRAGMA journal_mode = DELETE;
      CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, data TEXT NOT NULL, touched INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (scope TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (scope, key));
      PRAGMA user_version = 3;
    `)
  }
  sessions(): [string, Session][] {
    return this.db
      .prepare('SELECT key, data FROM sessions ORDER BY touched, rowid')
      .all()
      .map(row => {
        const session = JSON.parse(String(row.data)) as Session
        if (
          !Array.isArray(session.messages) ||
          !Number.isFinite(session.expiresAt)
        )
          throw new Error('Invalid stored session')
        return [String(row.key), session]
      })
  }
  putSession(key: string, session: Session, evicted: string[] = []): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO sessions (key, data, touched) VALUES (?, ?, ?)'
        )
        .run(key, JSON.stringify(session), Date.now())
      for (const removed of evicted) this.deleteSession(removed)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  deleteSession(key: string): void {
    this.db.prepare('DELETE FROM sessions WHERE key = ?').run(key)
  }
  getProfile(key: string): Profile | undefined {
    const row = this.db
      .prepare('SELECT data FROM profiles WHERE key = ?')
      .get(key)
    if (!row) return undefined
    const profile = JSON.parse(String(row.data)) as Profile
    if (
      !Array.isArray(profile.threads) ||
      !Array.isArray(profile.memories) ||
      !profile.threads.some(thread => thread.id === profile.active) ||
      !Number.isSafeInteger(profile.nextId) ||
      !['off', 'on', 'auto'].includes(profile.voice)
    )
      throw new Error('Invalid stored profile')
    return profile
  }
  putProfile(key: string, profile: Profile): void {
    this.db
      .prepare('INSERT OR REPLACE INTO profiles (key, data) VALUES (?, ?)')
      .run(key, JSON.stringify(profile))
  }
  getRecord<T>(scope: string, key: string): T | undefined {
    const row = this.db
      .prepare('SELECT data FROM records WHERE scope = ? AND key = ?')
      .get(scope, key)
    return row ? (JSON.parse(String(row.data)) as T) : undefined
  }
  putRecord(scope: string, key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO records (scope, key, data) VALUES (?, ?, ?)'
      )
      .run(scope, key, JSON.stringify(value))
  }
  records<T>(scope: string): [string, T][] {
    return this.db
      .prepare('SELECT key, data FROM records WHERE scope = ? ORDER BY key')
      .all(scope)
      .map(row => [String(row.key), JSON.parse(String(row.data)) as T])
  }
  deleteRecord(scope: string, key: string): void {
    this.db
      .prepare('DELETE FROM records WHERE scope = ? AND key = ?')
      .run(scope, key)
  }
  deleteOwner(key: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('DELETE FROM profiles WHERE key = ?').run(key)
      const prefix = `${key}:`
      this.db
        .prepare('DELETE FROM sessions WHERE substr(key, 1, length(?)) = ?')
        .run(prefix, prefix)
      // Minimal daily quota aggregates are retained until their accounting day expires.
      this.db
        .prepare("DELETE FROM records WHERE key = ? AND scope != 'usage'")
        .run(key)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  commitImport(
    owner: string,
    profile: Profile,
    sessions: [string, Session][],
    records: [string, unknown][]
  ): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.putProfile(owner, profile)
      for (const [key, session] of sessions)
        this.db
          .prepare(
            'INSERT OR REPLACE INTO sessions (key, data, touched) VALUES (?, ?, ?)'
          )
          .run(key, JSON.stringify(session), Date.now())
      for (const [scope, value] of records) this.putRecord(scope, owner, value)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  close(): void {
    this.db.close()
  }
}
