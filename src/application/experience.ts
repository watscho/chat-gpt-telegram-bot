import { randomUUID } from 'node:crypto'
import { UserError } from '../domain/conversation.js'
import type { StateStore } from '../domain/state.js'
import type {
  ExperienceState,
  Notice,
  UiLanguage,
  Bookmark
} from '../domain/experience.js'

export class Experience {
  private readonly cache = new Map<string, ExperienceState>()
  private readonly owners = new Set<string>()
  private restored = false
  private ticking = false
  private readonly flushing = new Set<string>()
  constructor(
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  get(owner: string): ExperienceState {
    this.owners.add(owner)
    if (!this.cache.has(owner))
      this.cache.set(
        owner,
        this.store?.getRecord<ExperienceState>('experience', owner) ?? {
          language: 'en',
          quiet: null,
          digestMinutes: 0,
          bookmarks: [],
          notices: []
        }
      )
    return structuredClone(this.cache.get(owner)!)
  }
  save(owner: string, state: ExperienceState): void {
    if (Buffer.byteLength(JSON.stringify(state)) > 1000000)
      throw new UserError(
        'Experience data exceeds 1 MB. Remove unused bookmarks or notices.'
      )
    this.store?.putRecord('experience', owner, state)
    this.cache.set(owner, structuredClone(state))
    this.owners.add(owner)
  }
  language(owner: string, language: string): void {
    if (!['en', 'ru', 'es'].includes(language))
      throw new UserError('UI language must be en, ru or es.')
    const state = this.get(owner)
    state.language = language as UiLanguage
    this.save(owner, state)
  }
  quiet(owner: string, expression: string): void {
    const state = this.get(owner)
    if (expression === 'off') state.quiet = null
    else {
      const match = expression.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/)
      if (!match)
        throw new UserError('Usage: /quiet HH:MM-HH:MM or /quiet off.')
      const values = match.slice(1).map(Number)
      if (
        values[0]! > 23 ||
        values[2]! > 23 ||
        values[1]! > 59 ||
        values[3]! > 59
      )
        throw new UserError('Quiet-hour times must use 00:00..23:59.')
      const start = values[0]! * 60 + values[1]!,
        end = values[2]! * 60 + values[3]!
      if (start === end)
        throw new UserError('Quiet-hour start and end must differ.')
      state.quiet = { start, end }
    }
    this.save(owner, state)
  }
  digest(owner: string, minutes: number): void {
    if (
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > 1440 ||
      (minutes > 0 && minutes < 5)
    )
      throw new UserError('Digest interval must be off or 5..1440 minutes.')
    const state = this.get(owner)
    state.digestMinutes = minutes
    this.save(owner, state)
  }
  isQuiet(owner: string, timezone: string): boolean {
    const quiet = this.get(owner).quiet
    if (!quiet) return false
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(this.now()))
    const minute =
      Number(parts.find(part => part.type === 'hour')!.value) * 60 +
      Number(parts.find(part => part.type === 'minute')!.value)
    return quiet.start < quiet.end
      ? minute >= quiet.start && minute < quiet.end
      : minute >= quiet.start || minute < quiet.end
  }
  shouldQueue(owner: string, timezone: string): boolean {
    return this.get(owner).digestMinutes > 0 || this.isQuiet(owner, timezone)
  }
  enqueue(
    owner: string,
    notice: Pick<Notice, 'kind' | 'target' | 'thread' | 'title'>
  ): void {
    const state = this.get(owner),
      id = `${notice.kind}-${notice.target}`
    if (state.notices.some(item => item.id === id)) return
    if (state.notices.length >= 100)
      throw new UserError(
        'Notification inbox is full (100). Flush or remove notices first.'
      )
    state.notices.push({
      ...notice,
      title: notice.title.slice(0, 160),
      id,
      queuedAt: this.now(),
      attempts: 0,
      nextAttempt: 0
    })
    this.save(owner, state)
  }
  retryNotice(owner: string, id: string): void {
    const state = this.get(owner),
      notice = state.notices.find(item => item.id === id)
    if (!notice) throw new UserError('Notification not found.')
    notice.attempts = 0
    notice.nextAttempt = 0
    this.save(owner, state)
  }
  removeNotice(owner: string, id: string): void {
    const state = this.get(owner)
    if (!state.notices.some(item => item.id === id))
      throw new UserError('Notification not found.')
    state.notices = state.notices.filter(item => item.id !== id)
    this.save(owner, state)
  }
  bookmark(
    owner: string,
    title: string,
    text: string,
    tags: string[] = []
  ): Bookmark {
    if (
      !title.trim() ||
      title.length > 80 ||
      !text.trim() ||
      text.length > 4000
    )
      throw new UserError(
        'Use a bookmark title of 1..80 characters and text of 1..4000 characters.'
      )
    const normalized = this.tags(tags),
      state = this.get(owner),
      existing = state.bookmarks.find(item => item.text === text)
    if (existing) return existing
    if (state.bookmarks.length >= 100)
      throw new UserError(
        'Bookmark limit reached (100). Remove a bookmark first.'
      )
    const item = {
      id: randomUUID().slice(0, 12),
      title: title.trim(),
      text,
      tags: normalized,
      createdAt: this.now()
    }
    state.bookmarks.push(item)
    this.save(owner, state)
    return structuredClone(item)
  }
  private tags(values: string[]): string[] {
    const tags = [
      ...new Set(values.map(value => value.trim().toLocaleLowerCase()))
    ]
    if (
      tags.length > 10 ||
      tags.some(value => !/^([\p{L}\p{N}_-]){1,24}$/u.test(value))
    )
      throw new UserError(
        'Use up to 10 tags of 1..24 letters, digits, underscores or hyphens.'
      )
    return tags
  }
  editBookmark(owner: string, id: string, tags: string[] | null): void {
    const state = this.get(owner),
      item = state.bookmarks.find(item => item.id === id)
    if (!item) throw new UserError('Bookmark not found.')
    if (tags === null)
      state.bookmarks = state.bookmarks.filter(item => item.id !== id)
    else item.tags = this.tags(tags)
    this.save(owner, state)
  }
  find(owner: string, query: string): Bookmark[] {
    if (query.length > 120)
      throw new UserError('Bookmark query must not exceed 120 characters.')
    const needle = query.toLocaleLowerCase().trim()
    return this.get(owner).bookmarks.filter(item =>
      needle.startsWith('#')
        ? item.tags.includes(needle.slice(1))
        : `${item.title}\n${item.text}\n${item.tags.join(' ')}`
            .toLocaleLowerCase()
            .includes(needle)
    )
  }
  deleteThread(owner: string, thread: string): void {
    const state = this.get(owner)
    state.notices = state.notices.filter(item => item.thread !== thread)
    this.save(owner, state)
  }
  refresh(owner: string): void {
    this.cache.delete(owner)
    this.owners.add(owner)
  }
  erase(owner: string): void {
    this.store?.deleteRecord('experience', owner)
    this.cache.delete(owner)
    this.owners.delete(owner)
  }
  async flush(
    owner: string,
    timezone: string,
    deliver: (items: Notice[]) => Promise<void>,
    force = false
  ): Promise<number> {
    if (this.flushing.has(owner)) return 0
    this.flushing.add(owner)
    try {
      const state = this.get(owner)
      if (!force && this.isQuiet(owner, timezone)) return 0
      const items = state.notices
        .filter(
          item =>
            item.attempts < 3 &&
            item.nextAttempt <= this.now() &&
            (force || item.queuedAt + state.digestMinutes * 60000 <= this.now())
        )
        .slice(0, 10)
      if (!items.length) return 0
      const ids = new Set(items.map(item => item.id))
      for (const item of state.notices)
        if (ids.has(item.id)) {
          item.attempts++
          item.nextAttempt = this.now() + 60000
        }
      this.save(owner, state)
      await deliver(items)
      const current = this.get(owner)
      current.notices = current.notices.filter(item => !ids.has(item.id))
      this.save(owner, current)
      return items.length
    } finally {
      this.flushing.delete(owner)
    }
  }

  async tick(
    allowed: (owner: string) => boolean,
    timezone: (owner: string) => string,
    deliver: (owner: string, items: Notice[]) => Promise<void>
  ): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      if (!this.restored) {
        for (const [owner, state] of this.store?.records<ExperienceState>(
          'experience'
        ) ?? []) {
          this.owners.add(owner)
          if (!this.cache.has(owner)) this.cache.set(owner, state)
        }
        this.restored = true
      }
      for (const owner of this.owners)
        if (allowed(owner))
          await this.flush(owner, timezone(owner), items =>
            deliver(owner, items)
          )
    } finally {
      this.ticking = false
    }
  }
}
