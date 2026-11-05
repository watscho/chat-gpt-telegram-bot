import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Profile, Session, StateStore } from '../domain/state.js'

// The same store is used with :memory: in tests and a private file in production.
export class SQLiteStateStore implements StateStore {
  private readonly db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:')
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') chmodSync(path, 0o600)
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version
    if (version !== 0 && version !== 1) {
      this.db.close()
      throw new Error('Unsupported state database version')
    }
    this.db.exec(`
      PRAGMA secure_delete = ON;
      PRAGMA journal_mode = DELETE;
      CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, data TEXT NOT NULL, touched INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      PRAGMA user_version = 1;
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
  close(): void {
    this.db.close()
  }
}
