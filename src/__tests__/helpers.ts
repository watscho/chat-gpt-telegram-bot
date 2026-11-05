import { loadConfig } from '../config.js'
import type {
  LanguageModel,
  Message,
  ModelReply,
  ReplyOptions
} from '../domain/conversation.js'

export const config = () =>
  loadConfig({
    TELEGRAM_API_KEY: '123456:test-token',
    OPENAI_API_KEY: 'test-key',
    OPENAI_CHAT_MODEL: 'test-model',
    ALLOWED_TELEGRAM_USER_IDS: '42,43',
    STREAM_RESPONSES: 'false'
  })
export class FakeModel implements LanguageModel {
  calls: Message[][] = []
  answer: string | ModelReply = 'Test answer'
  options: ReplyOptions[] = []
  failure = false
  reply(
    messages: readonly Message[],
    options: ReplyOptions = {}
  ): Promise<string | ModelReply> {
    this.options.push(options)
    this.calls.push(structuredClone([...messages]))
    return this.failure
      ? Promise.reject(new Error('secret-token'))
      : Promise.resolve(this.answer)
  }
  transcribe(): Promise<string> {
    return Promise.resolve('Voice text')
  }
}

import type { Profile, Session, StateStore } from '../domain/state.js'

export class MemoryStateStore implements StateStore {
  readonly data = new Map<string, Session>()
  readonly profiles = new Map<string, Profile>()
  sessions(): [string, Session][] {
    return structuredClone([...this.data])
  }
  putSession(key: string, session: Session, evicted: string[] = []): void {
    for (const removed of evicted) this.data.delete(removed)
    this.data.delete(key)
    this.data.set(key, structuredClone(session))
  }
  deleteSession(key: string): void {
    this.data.delete(key)
  }
  getProfile(key: string): Profile | undefined {
    return structuredClone(this.profiles.get(key))
  }
  putProfile(key: string, profile: Profile): void {
    this.profiles.set(key, structuredClone(profile))
  }
  readonly extra = new Map<string, Map<string, unknown>>()
  getRecord<T>(scope: string, key: string): T | undefined {
    return structuredClone(this.extra.get(scope)?.get(key)) as T | undefined
  }
  putRecord(scope: string, key: string, value: unknown): void {
    const map = this.extra.get(scope) ?? new Map<string, unknown>()
    map.set(key, structuredClone(value))
    this.extra.set(scope, map)
  }
  records<T>(scope: string): [string, T][] {
    return structuredClone([...(this.extra.get(scope) ?? [])]) as [string, T][]
  }
  deleteRecord(scope: string, key: string): void {
    this.extra.get(scope)?.delete(key)
  }
  deleteOwner(key: string): void {
    this.profiles.delete(key)
    for (const id of this.data.keys())
      if (id.startsWith(`${key}:`)) this.data.delete(id)
    for (const [scope, map] of this.extra)
      if (scope !== 'usage') map.delete(key)
  }
  close(): void {}
}
