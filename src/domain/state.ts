import type { Recap } from './workflow.js'
import type { Message } from './conversation.js'

export interface Session {
  messages: Message[]
  recap?: Recap
  expiresAt: number
}
export interface Profile {
  active: string
  nextId: number
  threads: { id: string; title: string }[]
  memories: string[]
  voice: 'off' | 'on' | 'auto'
}
export interface StateStore {
  sessions(): [string, Session][]
  putSession(key: string, session: Session, evicted?: string[]): void
  deleteSession(key: string): void
  getProfile(key: string): Profile | undefined
  putProfile(key: string, profile: Profile): void
  getRecord<T>(scope: string, key: string): T | undefined
  putRecord(scope: string, key: string, value: unknown): void
  records<T>(scope: string): [string, T][]
  deleteRecord(scope: string, key: string): void
  deleteOwner(key: string): void
  commitImport(
    owner: string,
    profile: Profile,
    sessions: [string, Session][],
    records: [string, unknown][]
  ): void
  close(): void
}
