import type { Message } from './conversation.js'

export interface Session {
  messages: Message[]
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
  close(): void
}
