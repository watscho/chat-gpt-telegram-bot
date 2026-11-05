import { createHash, randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import type { StateStore } from '../domain/state.js'
import { UserError } from '../domain/conversation.js'
import type { Watch, WatchPorts, WatchTarget } from '../domain/watch.js'
import { compareResults } from './studio-results.js'
export class Watches {
  private readonly cache = new Map<string, Watch[]>()
  private readonly active = new Map<string, AbortController>()
  private ticking = false
  constructor(
    private readonly config: Config,
    private readonly ports: WatchPorts,
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  get(owner: string): Watch[] {
    return structuredClone(
      this.cache.get(owner) ??
        this.store?.getRecord<Watch[]>('watches', owner) ??
        []
    )
  }
  private save(owner: string, watches: Watch[]): void {
    if (
      watches.length > 10 ||
      Buffer.byteLength(JSON.stringify(watches)) > this.config.maxJobBytes
    )
      throw new UserError('Watch count/storage capacity is full.')
    this.store?.putRecord('watches', owner, watches)
    this.cache.set(owner, structuredClone(watches))
  }
  add(
    owner: string,
    thread: string,
    target: WatchTarget,
    interval: number,
    threshold: number
  ): Watch {
    if (!this.store || this.config.statePath === ':memory:')
      throw new UserError('Change monitoring requires persistent state.')
    if (
      !Number.isSafeInteger(interval) ||
      interval < 3600000 ||
      interval > 604800000 ||
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold > 100
    )
      throw new UserError(
        'Use a watch interval from 1 hour to 7 days and a change threshold from 0 to 100 percent.'
      )
    if (target.kind === 'url') {
      const url = new URL(target.url)
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        target.url.length > 2048
      )
        throw new UserError(
          'Choose a public HTTPS URL without credentials or fragments.'
        )
    } else if (!target.project || !target.name || target.name.length > 160)
      throw new UserError('Choose an owned project file.')
    const watches = this.get(owner)
    if (
      watches.some(
        watch => JSON.stringify(watch.target) === JSON.stringify(target)
      )
    )
      throw new UserError('This source already has a watch.')
    const watch: Watch = {
      id: randomUUID().slice(0, 12),
      thread,
      target,
      interval,
      threshold,
      revision: 1,
      enabled: true,
      nextAt: this.now(),
      lastAt: 0,
      baseline: null,
      error: '',
      changes: []
    }
    watches.push(watch)
    this.save(owner, watches)
    return watch
  }
  item(owner: string, id: string): Watch {
    const watch = this.get(owner).find(watch => watch.id === id)
    if (!watch) throw new UserError('Watch not found.')
    return watch
  }
  remove(owner: string, id: string): void {
    this.item(owner, id)
    this.active.get(`${owner}:${id}`)?.abort()
    this.save(
      owner,
      this.get(owner).filter(watch => watch.id !== id)
    )
  }
  enable(owner: string, id: string, enabled: boolean): void {
    const watches = this.get(owner),
      watch = watches.find(watch => watch.id === id)
    if (!watch) throw new UserError('Watch not found.')
    watch.enabled = enabled
    watch.revision++
    watch.nextAt = this.now()
    this.save(owner, watches)
    if (!enabled) this.active.get(`${owner}:${id}`)?.abort()
  }
  async check(owner: string, id: string): Promise<void> {
    const original = this.item(owner, id),
      key = `${owner}:${id}`
    if (this.active.has(key) || !original.enabled || !this.ports.allowed(owner))
      return
    const controller = new AbortController()
    this.active.set(key, controller)
    try {
      const claimed = this.get(owner),
        watch = claimed.find(watch => watch.id === id)!
      watch.lastAt = this.now()
      watch.nextAt = this.now() + watch.interval
      watch.revision++
      this.save(owner, claimed)
      const result = await this.ports.read(
        owner,
        watch.target,
        controller.signal
      )
      if (controller.signal.aborted) return
      if (
        !result.text.trim() ||
        result.text.length > 60000 ||
        result.title.length > 200
      )
        throw new UserError(
          'Watched source is empty or exceeds the retained preview limit.'
        )
      const current = this.get(owner),
        saved = current.find(item => item.id === id)
      if (!saved || saved.revision !== watch.revision || !saved.enabled) return
      const text = result.text.replace(/[\t ]+/g, ' ').trim(),
        hash = createHash('sha256').update(text).digest('hex'),
        baseline = saved.baseline
      saved.error = ''
      if (baseline && baseline.hash !== hash) {
        let prefix = 0,
          suffix = 0
        while (
          prefix < baseline.text.length &&
          prefix < text.length &&
          baseline.text[prefix] === text[prefix]
        )
          prefix++
        while (
          suffix < baseline.text.length - prefix &&
          suffix < text.length - prefix &&
          baseline.text.at(-suffix - 1) === text.at(-suffix - 1)
        )
          suffix++
        const changed = Math.max(
            baseline.text.length - prefix - suffix,
            text.length - prefix - suffix
          ),
          percent =
            (changed / Math.max(baseline.text.length, text.length, 1)) * 100
        if (percent >= saved.threshold) {
          saved.changes.push({
            at: this.now(),
            before: baseline.hash,
            after: hash,
            diff: compareResults(baseline.text, text).slice(0, 4000),
            notified: true
          })
          saved.changes = saved.changes.slice(-10)
          saved.baseline = { hash, title: result.title, text }
          this.save(owner, current)
          await this.ports
            .notify(owner, structuredClone(saved))
            .catch(() => undefined)
          return
        }
        this.save(owner, current)
        return
      }
      saved.baseline = { hash, title: result.title, text }
      this.save(owner, current)
    } catch (error) {
      const current = this.get(owner),
        watch = current.find(watch => watch.id === id)
      if (watch && !controller.signal.aborted) {
        watch.error =
          error instanceof UserError
            ? error.message
            : 'Source check failed. No model request was made.'
        this.save(owner, current)
      }
    } finally {
      this.active.delete(key)
    }
  }
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const owners = new Set([
        ...(this.store?.records('watches') ?? []).map(([owner]) => owner),
        ...this.cache.keys()
      ])
      for (const owner of owners)
        for (const watch of this.get(owner))
          if (watch.enabled && watch.nextAt <= this.now())
            await this.check(owner, watch.id)
    } finally {
      this.ticking = false
    }
  }
  refresh(owner: string): void {
    this.cache.delete(owner)
  }
  erase(owner: string): void {
    for (const [key, controller] of this.active)
      if (key.startsWith(`${owner}:`)) controller.abort()
    this.store?.deleteRecord('watches', owner)
    this.cache.delete(owner)
  }
  stop(): void {
    for (const controller of this.active.values()) controller.abort()
  }
}
