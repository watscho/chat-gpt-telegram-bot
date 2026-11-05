import { createHash } from 'node:crypto'
import type { StateStore } from '../domain/state.js'
import type { ProviderWorkbench, Resource } from '../domain/workbench.js'
import { UserError } from '../domain/conversation.js'

export interface ResourceEntry extends Resource {
  active: boolean
  attempts: number
  nextAttempt: number
  createdAt: number
}
export class ResourceJournal {
  private readonly local = new Map<string, ResourceEntry[]>()
  private readonly processing = new Set<string>()
  constructor(
    private readonly provider: Pick<ProviderWorkbench, 'remove'>,
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  get durable(): boolean {
    return this.store !== undefined
  }
  private all(): Map<string, ResourceEntry[]> {
    const entries = new Map(
      this.store?.records<ResourceEntry[]>('provider-cleanup') ?? []
    )
    for (const [key, value] of this.local) entries.set(key, value)
    return entries
  }
  callCount(): number {
    return [...this.all().values()].flat().filter(item => item.kind === 'call')
      .length
  }
  recoverCalls(): void {
    for (const [key] of this.all()) {
      const entries = this.read(key)
      let changed = false
      for (const entry of entries)
        if (entry.kind === 'call') {
          entry.active = false
          entry.nextAttempt = 0
          entry.attempts = 0
          changed = true
        }
      if (changed) this.save(key, entries)
    }
  }
  key(owner: string): string {
    return createHash('sha256').update(owner).digest('hex')
  }
  entries(owner: string): ResourceEntry[] {
    return this.read(this.key(owner))
  }
  private read(key: string): ResourceEntry[] {
    return structuredClone(
      this.local.get(key) ??
        this.store?.getRecord<ResourceEntry[]>('provider-cleanup', key) ??
        []
    )
  }
  private save(key: string, entries: ResourceEntry[]): void {
    if (
      entries.length > 2000 ||
      Buffer.byteLength(JSON.stringify(entries)) > 1000000
    )
      throw new UserError(
        'Cloud resource tracking is full. Complete pending cleanup first.'
      )
    if (entries.length) this.store?.putRecord('provider-cleanup', key, entries)
    else this.store?.deleteRecord('provider-cleanup', key)
    this.local.set(key, structuredClone(entries))
  }
  remember(
    owner: string,
    resource: Resource,
    active = false,
    notBefore = 0
  ): void {
    const key = this.key(owner),
      entries = this.read(key)
    if (
      entries.some(
        item => item.id === resource.id && item.kind === resource.kind
      )
    )
      return
    entries.push({
      ...resource,
      active,
      attempts: 0,
      nextAttempt: notBefore,
      createdAt: this.now()
    })
    this.save(key, entries)
  }
  retire(owner: string, resources?: Resource[]): void {
    const key = this.key(owner),
      entries = this.read(key)
    for (const entry of entries)
      if (
        !resources ||
        resources.some(item => item.kind === entry.kind && item.id === entry.id)
      ) {
        entry.active = false
        entry.nextAttempt = 0
        entry.attempts = 0
      }
    this.save(key, entries)
  }
  async removeNow(owner: string, resource: Resource): Promise<boolean> {
    return this.process(this.key(owner), resource)
  }
  private async process(key: string, resource: Resource): Promise<boolean> {
    const token = `${key}:${resource.kind}:${resource.id}`
    if (this.processing.has(token)) return false
    const entries = this.read(key),
      entry = entries.find(
        item => item.id === resource.id && item.kind === resource.kind
      )
    if (!entry) return true
    if (entry.active || entry.attempts >= 3 || entry.nextAttempt > this.now())
      return false
    this.processing.add(token)
    try {
      entry.attempts++
      entry.nextAttempt = this.now() + 60000
      this.save(key, entries)
      try {
        await this.provider.remove(resource)
      } catch {
        return false
      }
      const current = this.read(key).filter(
        item => !(item.id === resource.id && item.kind === resource.kind)
      )
      this.save(key, current)
      return true
    } finally {
      this.processing.delete(token)
    }
  }
  async tick(
    references: ReadonlySet<string>,
    busyOwners: ReadonlySet<string>
  ): Promise<void> {
    const all = new Map(
      this.store?.records<ResourceEntry[]>('provider-cleanup') ?? []
    )
    for (const [key, entries] of this.local) all.set(key, entries)
    for (const [key] of all) {
      if (busyOwners.has(key)) continue
      const entries = this.read(key)
      let changed = false
      for (const entry of entries)
        if (entry.active && !references.has(`${entry.kind}:${entry.id}`)) {
          entry.active = false
          entry.nextAttempt = 0
          changed = true
        }
      if (changed) this.save(key, entries)
      for (const entry of this.read(key)) await this.process(key, entry)
    }
  }
}
