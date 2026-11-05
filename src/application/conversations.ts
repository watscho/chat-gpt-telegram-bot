import type { Config } from '../config.js'
import type {
  Image,
  LanguageModel,
  Message,
  ModelReply,
  ReplyOptions
} from '../domain/conversation.js'
import { formatSources } from './sources.js'
import type { Session, StateStore } from '../domain/state.js'
import { UserError } from '../domain/conversation.js'

type Limits = Pick<
  Config,
  | 'maxHistoryTurns'
  | 'maxHistoryCharacters'
  | 'sessionTtlMs'
  | 'maxSessions'
  | 'maxInputCharacters'
  | 'maxImageBytes'
  | 'maxHistoryImageBytes'
  | 'maxTotalImageBytes'
  | 'maxDocumentBytes'
>
export class Conversations {
  private readonly sessions = new Map<string, Session>()
  constructor(
    private readonly model: LanguageModel,
    private readonly limits: Limits,
    private readonly now = Date.now,
    private readonly store?: StateStore
  ) {
    for (const [key, session] of store?.sessions() ?? [])
      this.sessions.set(key, session)
    this.prune()
    // Reapply current budgets if the operator lowered limits since the last run.
    for (const [key, session] of this.sessions) {
      if (
        this.characters(session.messages) > this.limits.maxHistoryCharacters ||
        this.imageBytes(session.messages) >
          Math.min(
            this.limits.maxHistoryImageBytes,
            this.limits.maxTotalImageBytes
          ) ||
        session.messages.length > this.limits.maxHistoryTurns * 2
      )
        this.reset(key)
    }
    while (
      this.sessions.size > this.limits.maxSessions ||
      this.totalBytes() > this.limits.maxTotalImageBytes
    ) {
      this.reset(this.sessions.keys().next().value!)
    }
  }

  reset(key: string): void {
    this.store?.deleteSession(key)
    this.sessions.delete(key)
  }

  lastReply(key: string): string | undefined {
    this.prune()
    return this.sessions
      .get(key)
      ?.messages.findLast(message => message.role === 'assistant')?.content
  }

  async reply(key: string, input: string): Promise<string> {
    return (await this.respond(key, input)).text
  }

  async respond(
    key: string,
    input: string,
    images: Image[] = [],
    options: ReplyOptions = {}
  ): Promise<ModelReply> {
    const documents = options.documents ?? []
    const text = input.trim()
    if (!text || text.length > this.limits.maxInputCharacters) {
      throw new UserError(
        `Send between 1 and ${this.limits.maxInputCharacters} characters.`
      )
    }
    if (
      documents.some(
        document =>
          Buffer.byteLength(document.data, 'base64') >
          this.limits.maxDocumentBytes
      )
    )
      throw new UserError('Document exceeds the configured file size limit.')
    if (
      images.some(
        image =>
          Buffer.byteLength(image.data, 'base64') > this.limits.maxImageBytes
      ) ||
      this.imageBytes([{ role: 'user', content: text, images, documents }]) >
        this.limits.maxHistoryImageBytes ||
      this.imageBytes([{ role: 'user', content: text, images, documents }]) >
        this.limits.maxTotalImageBytes
    ) {
      throw new UserError(
        'Images exceed the configured memory or file size limit.'
      )
    }
    this.prune()
    const messages = [
      ...(this.sessions.get(key)?.messages ?? []),
      {
        role: 'user' as const,
        content: text,
        ...(images.length ? { images } : {}),
        ...(documents.length ? { documents } : {})
      }
    ]
    while (
      messages.length > 1 &&
      (messages.length > this.limits.maxHistoryTurns * 2 - 1 ||
        this.characters(messages) > this.limits.maxHistoryCharacters ||
        this.imageBytes(messages) >
          Math.min(
            this.limits.maxHistoryImageBytes,
            this.limits.maxTotalImageBytes
          ))
    ) {
      messages.splice(0, 2)
    }
    if (
      options.action === 'edit' &&
      !messages.some(message => message.images?.length)
    ) {
      throw new UserError(
        'Send a photo first, or reply to a photo with /edit and your instructions.'
      )
    }
    const result = await this.model.reply(messages, options)
    const response: ModelReply =
      typeof result === 'string'
        ? { text: result.trim(), images: [] }
        : { ...result, text: result.text.trim() }
    if (!response.text && !response.images.length)
      throw new Error('Empty model response')
    messages.push({
      role: 'assistant',
      content: [response.text, formatSources(response.sources)]
        .filter(Boolean)
        .join('\n\n'),
      ...(response.images.length ? { images: response.images } : {})
    })
    while (
      messages.length &&
      (messages.length > this.limits.maxHistoryTurns * 2 ||
        this.characters(messages) > this.limits.maxHistoryCharacters ||
        this.imageBytes(messages) >
          Math.min(
            this.limits.maxHistoryImageBytes,
            this.limits.maxTotalImageBytes
          ))
    ) {
      messages.splice(0, 2)
    }
    // Commit complete turns only after the provider succeeds.
    this.prune()
    const retained = new Map(this.sessions)
    retained.delete(key)
    const evicted: string[] = []
    while (
      retained.size >= this.limits.maxSessions ||
      [...retained.values()].reduce(
        (sum, session) => sum + this.imageBytes(session.messages),
        0
      ) +
        this.imageBytes(messages) >
        this.limits.maxTotalImageBytes
    ) {
      const oldest = retained.keys().next().value!
      retained.delete(oldest)
      evicted.push(oldest)
    }
    const session = {
      messages,
      expiresAt: this.now() + this.limits.sessionTtlMs
    }
    // Persist replacement and evictions atomically before publishing in-memory changes.
    this.store?.putSession(key, session, evicted)
    for (const removed of evicted) this.sessions.delete(removed)
    this.sessions.delete(key)
    this.sessions.set(key, session)
    return response
  }

  private totalBytes(): number {
    return [...this.sessions.values()].reduce(
      (sum, session) => sum + this.imageBytes(session.messages),
      0
    )
  }

  private imageBytes(messages: readonly Message[]): number {
    // Count encoded bytes, which also bounds the retained base64 strings.
    return messages.reduce(
      (sum, message) =>
        sum +
        [...(message.images ?? []), ...(message.documents ?? [])].reduce(
          (size, image) => size + image.data.length,
          0
        ),
      0
    )
  }

  private characters(messages: readonly Message[]): number {
    return messages.reduce((sum, message) => sum + message.content.length, 0)
  }

  private prune(): void {
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= this.now()) this.reset(key)
    }
  }
}
