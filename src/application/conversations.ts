import type { Config } from '../config.js'
import type { LanguageModel, Message } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'

type Limits = Pick<
  Config,
  | 'maxHistoryTurns'
  | 'maxHistoryCharacters'
  | 'sessionTtlMs'
  | 'maxSessions'
  | 'maxInputCharacters'
>
interface Session {
  messages: Message[]
  expiresAt: number
}

export class Conversations {
  private readonly sessions = new Map<string, Session>()
  constructor(
    private readonly model: LanguageModel,
    private readonly limits: Limits,
    private readonly now = Date.now
  ) {}

  reset(key: string): void {
    this.sessions.delete(key)
  }

  async reply(key: string, input: string): Promise<string> {
    const text = input.trim()
    if (!text || text.length > this.limits.maxInputCharacters) {
      throw new UserError(
        `Send between 1 and ${this.limits.maxInputCharacters} characters.`
      )
    }
    this.prune()
    const messages = [
      ...(this.sessions.get(key)?.messages ?? []),
      { role: 'user' as const, content: text }
    ]
    while (
      messages.length > 1 &&
      (messages.length > this.limits.maxHistoryTurns * 2 - 1 ||
        this.characters(messages) > this.limits.maxHistoryCharacters)
    ) {
      messages.splice(0, 2)
    }
    const response = (await this.model.reply(messages)).trim()
    if (!response) throw new Error('Empty model response')
    messages.push({ role: 'assistant', content: response })
    while (
      messages.length &&
      (messages.length > this.limits.maxHistoryTurns * 2 ||
        this.characters(messages) > this.limits.maxHistoryCharacters)
    ) {
      messages.splice(0, 2)
    }
    // Commit complete turns only after the provider succeeds.
    this.prune()
    this.sessions.delete(key)
    while (this.sessions.size >= this.limits.maxSessions) {
      const oldest = this.sessions.keys().next().value
      if (oldest === undefined) break
      this.sessions.delete(oldest)
    }
    this.sessions.set(key, {
      messages,
      expiresAt: this.now() + this.limits.sessionTtlMs
    })
    return response
  }

  private characters(messages: readonly Message[]): number {
    return messages.reduce((sum, message) => sum + message.content.length, 0)
  }

  private prune(): void {
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= this.now()) this.sessions.delete(key)
    }
  }
}
