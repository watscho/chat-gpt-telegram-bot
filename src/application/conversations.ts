import { createHash, randomUUID } from 'node:crypto'
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

  history(key: string): Message[] {
    this.prune()
    return structuredClone(this.sessions.get(key)?.messages ?? [])
  }
  owned(owner: string): [string, Session][] {
    this.prune()
    return structuredClone(
      [...this.sessions].filter(([key]) => key.startsWith(`${owner}:`))
    )
  }
  search(
    owner: string,
    query: string
  ): { conversation: string; snippet: string }[] {
    if (!query.trim() || query.length > 120)
      throw new UserError('Search needs between 1 and 120 characters.')
    const needle = query.toLowerCase()
    return this.owned(owner)
      .flatMap(([key, session]) =>
        session.messages
          .filter(message => message.content.toLowerCase().includes(needle))
          .map(message => {
            const position = message.content.toLowerCase().indexOf(needle)
            return {
              conversation: key.slice(owner.length + 1),
              snippet: message.content.slice(
                Math.max(0, position - 50),
                position + 160
              )
            }
          })
      )
      .slice(0, 20)
  }
  versions(key: string): { id: string; image: Image }[] {
    return this.history(key).flatMap(message =>
      message.role === 'assistant'
        ? (message.images ?? []).map((image, part) => ({
            id: `${message.id ?? `legacy-${createHash('sha256').update(image.data).digest('hex').slice(0, 16)}`}.${part}`,
            image
          }))
        : []
    )
  }
  forgetOwner(owner: string): void {
    for (const [key] of this.owned(owner)) this.reset(key)
  }

  retention(key: string, seconds: number): void {
    const session = this.sessions.get(key)
    if (!session) return
    const updated = {
      ...session,
      expiresAt: Math.min(session.expiresAt, this.now() + seconds * 1000)
    }
    this.store?.putSession(key, updated)
    this.sessions.set(key, updated)
  }

  fork(source: string, target: string, turns: number): void {
    const original = this.history(source)
    if (
      !Number.isInteger(turns) ||
      turns < 0 ||
      turns > original.length / 2 ||
      this.sessions.has(target)
    )
      throw new UserError(
        'Choose a retained turn and an unused conversation ID.'
      )
    const messages = original.slice(0, turns * 2)
    if (
      this.sessions.size >= this.limits.maxSessions ||
      this.totalBytes() + this.imageBytes(messages) >
        this.limits.maxTotalImageBytes
    )
      throw new UserError(
        'Not enough history capacity for a branch. Remove unused histories first.'
      )
    const session = {
      messages,
      expiresAt:
        this.sessions.get(source)?.expiresAt ??
        this.now() + this.limits.sessionTtlMs
    }
    this.store?.putSession(target, session)
    this.sessions.set(target, structuredClone(session))
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
    if (options.signal?.aborted) throw new UserError('Request stopped.')
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
        id: randomUUID(),
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
    const providerMessages =
      options.contextHistory !== undefined
        ? [...structuredClone(options.contextHistory), messages.at(-1)!]
        : messages
    while (
      providerMessages.length > 1 &&
      (providerMessages.length > this.limits.maxHistoryTurns * 2 - 1 ||
        this.characters(providerMessages) > this.limits.maxHistoryCharacters ||
        this.imageBytes(providerMessages) >
          Math.min(
            this.limits.maxHistoryImageBytes,
            this.limits.maxTotalImageBytes
          ))
    )
      providerMessages.splice(0, 2)
    if (
      options.action === 'edit' &&
      !providerMessages.some(message => message.images?.length)
    ) {
      throw new UserError(
        'Send a photo first, or reply to a photo with /edit and your instructions.'
      )
    }
    options.onStart?.()
    const result = await this.model.reply(providerMessages, options)
    if (options.signal?.aborted) throw new UserError('Request stopped.')
    const response: ModelReply =
      typeof result === 'string'
        ? { text: result.trim(), images: [] }
        : { ...result, text: result.text.trim() }
    if (!response.text && !response.images.length)
      throw new Error('Empty model response')
    messages.push({
      id: randomUUID(),
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
      expiresAt:
        this.now() +
        (options.retentionSeconds !== undefined
          ? options.retentionSeconds * 1000
          : this.limits.sessionTtlMs)
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
