import { UserError } from '../domain/conversation.js'
import type { ReadingPorts, ReadingSource } from '../domain/routine.js'
import { Experience } from './experience.js'
import { Routines, routineId } from './routines.js'
import {
  canonicalReadingURL,
  clockTime,
  readingScore,
  routineHash,
  routineText
} from './routine-rules.js'
export class RoutineReading {
  private readonly active = new Map<string, AbortController>()
  private ticking = false
  constructor(
    private readonly data: Routines,
    private readonly ports: ReadingPorts,
    private readonly experience: Experience
  ) {}
  add(owner: string, kind: string, url: string, hours: number): ReadingSource {
    this.data.persistent()
    if (
      !['rss', 'page'].includes(kind) ||
      !Number.isSafeInteger(hours) ||
      hours < 1 ||
      hours > 168
    )
      throw new UserError(
        'Choose rss/page and a source interval of 1..168 hours.'
      )
    const canonical = canonicalReadingURL(url),
      source: ReadingSource = {
        id: routineId(),
        kind: kind as 'rss' | 'page',
        url: canonical,
        enabled: true,
        interval: hours * 3600000,
        nextAt: this.data.now(),
        revision: 1,
        error: ''
      }
    this.data.update(owner, state => {
      if (state.sources.some(item => item.url === canonical))
        throw new UserError('This reading source is already subscribed.')
      state.sources.push(source)
    })
    return source
  }
  control(owner: string, id: string, action: string): void {
    this.data.update(owner, state => {
      const source = state.sources.find(item => item.id === id)
      if (!source || !['on', 'off', 'remove'].includes(action))
        throw new UserError(
          'Choose an existing reading source and on, off or remove.'
        )
      if (action === 'remove') {
        state.sources = state.sources.filter(item => item.id !== id)
        state.reading = state.reading
          .map(item => ({
            ...item,
            sources: item.sources.filter(source => source !== id)
          }))
          .filter(item => item.sources.length || item.saved)
      } else {
        source.enabled = action === 'on'
        source.nextAt = this.data.now()
        source.revision++
      }
    })
    this.active.get(`${owner}:${id}`)?.abort()
  }
  topic(owner: string, topic: string, weight: number | 'hide' | 'show'): void {
    const name = routineText(topic, 80).normalize('NFKC').toLowerCase()
    if (['constructor', 'prototype', '__proto__'].includes(name))
      throw new UserError('Choose a topic phrase, not a reserved field name.')
    if (
      typeof weight === 'number' &&
      (!Number.isSafeInteger(weight) || weight < -5 || weight > 5)
    )
      throw new UserError('Choose a topic weight from -5 to 5.')
    this.data.update(owner, state => {
      if (weight === 'hide')
        state.hiddenTopics = [...new Set([...state.hiddenTopics, name])]
      else if (weight === 'show')
        state.hiddenTopics = state.hiddenTopics.filter(item => item !== name)
      else if (weight === 0) delete state.topics[name]
      else state.topics[name] = weight
    })
  }
  feedback(owner: string, id: string, topic: string, action: string): void {
    const item = this.item(owner, id),
      name = routineText(topic, 80).normalize('NFKC').toLowerCase()
    if (
      !`${item.title} ${item.excerpt}`
        .normalize('NFKC')
        .toLowerCase()
        .includes(name) ||
      !['more', 'less'].includes(action)
    )
      throw new UserError(
        'Choose a topic phrase present in the selected item and more or less.'
      )
    const weight = this.data.get(owner).topics[name] ?? 0
    this.topic(
      owner,
      name,
      Math.max(-5, Math.min(5, weight + (action === 'more' ? 1 : -1)))
    )
  }
  item(owner: string, id: string) {
    const item = this.data.get(owner).reading.find(item => item.id === id)
    if (!item) throw new UserError('Reading item is no longer retained.')
    return item
  }
  mark(owner: string, id: string, action: string): void {
    if (!['read', 'unread', 'hide', 'save'].includes(action))
      throw new UserError('Choose read, unread, hide or save.')
    const item = this.item(owner, id)
    if (action === 'save')
      this.experience.bookmark(
        owner,
        item.title.slice(0, 80),
        `${item.title}\n${item.url}\n${item.excerpt}`.slice(0, 4000)
      )
    this.data.update(owner, state => {
      const item = state.reading.find(item => item.id === id)!
      if (action === 'read' || action === 'unread')
        item.read = action === 'read'
      else if (action === 'hide') item.hidden = true
      else item.saved = true
    })
  }
  top(owner: string, limit = 5) {
    const state = this.data.get(owner)
    return state.reading
      .filter(item => item.sources.length)
      .flatMap(item => {
        const score = readingScore(item, state.topics, state.hiddenTopics)
        return score ? [{ ...item, ...score }] : []
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.published ?? b.discovered) - (a.published ?? a.discovered) ||
          a.id.localeCompare(b.id)
      )
      .slice(0, limit)
  }
  delivery(owner: string, time: string): void {
    this.data.persistent()
    const value = clockTime(time)
    this.data.update(owner, state => {
      state.readingTime = value
    })
  }
  async check(owner: string, id: string): Promise<void> {
    const source = this.data.get(owner).sources.find(item => item.id === id)
    if (!source) throw new UserError('Reading source not found.')
    const key = `${owner}:${id}`
    if (this.active.has(key) || !source.enabled || !this.ports.allowed(owner))
      return
    const controller = new AbortController()
    this.active.set(key, controller)
    let revision = 0
    try {
      this.data.update(owner, state => {
        const item = state.sources.find(item => item.id === id)!
        item.revision++
        revision = item.revision
        item.nextAt = this.data.now() + item.interval
      })
      const entries = await this.ports.read(
        source.kind,
        source.url,
        controller.signal
      )
      if (controller.signal.aborted) return
      if (
        entries.length > 100 ||
        entries.some(
          item =>
            !item.title.trim() ||
            item.title.length > 200 ||
            item.excerpt.length > 2000 ||
            (item.published !== null && !Number.isFinite(item.published))
        )
      )
        throw new UserError(
          'Reading source exceeds its bounded entry contract.'
        )
      const current = this.data.get(owner).sources.find(item => item.id === id)
      if (!current || current.revision !== revision || !current.enabled) return
      this.data.update(owner, state => {
        for (const entry of entries) {
          const url = canonicalReadingURL(entry.url),
            itemId = routineHash(url).slice(0, 20),
            existing = state.reading.find(item => item.id === itemId)
          if (existing) {
            existing.sources = [...new Set([...existing.sources, id])]
            existing.title = entry.title
            existing.excerpt = entry.excerpt
            continue
          }
          if (state.seen.includes(itemId)) continue
          state.seen.push(itemId)
          state.reading.push({
            ...entry,
            url,
            id: itemId,
            sources: [id],
            published:
              entry.published !== null &&
              entry.published <= this.data.now() + 86400000
                ? entry.published
                : null,
            discovered: this.data.now(),
            read: false,
            saved: false,
            hidden: false
          })
        }
        while (state.reading.length > 500) {
          const removable = state.reading.findIndex(
            item => (item.read || item.hidden) && !item.saved
          )
          if (removable < 0)
            throw new UserError(
              'Reading capacity is full. Mark older items read/hidden before refreshing.'
            )
          state.reading.splice(removable, 1)
        }
        state.seen = state.seen.slice(-5000)
        state.sources.find(item => item.id === id)!.error = ''
      })
    } catch (error) {
      if (
        !controller.signal.aborted &&
        this.data.get(owner).sources.some(item => item.id === id)
      )
        this.data.update(owner, state => {
          state.sources.find(item => item.id === id)!.error =
            error instanceof UserError
              ? error.message
              : 'Source refresh failed safely; no model request was made.'
        })
    } finally {
      this.active.delete(key)
    }
  }
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const due = this.data
        .owners()
        .filter(owner => this.ports.allowed(owner))
        .flatMap(owner =>
          this.data
            .get(owner)
            .sources.filter(
              source => source.enabled && source.nextAt <= this.data.now()
            )
            .map(source => ({ owner, source }))
        )
        .sort((a, b) => a.source.nextAt - b.source.nextAt)[0]
      if (due) await this.check(due.owner, due.source.id)
    } finally {
      this.ticking = false
    }
  }
  erase(owner: string): void {
    for (const [key, controller] of this.active)
      if (key.startsWith(`${owner}:`)) controller.abort()
  }
  stop(): void {
    for (const controller of this.active.values()) controller.abort()
  }
}
