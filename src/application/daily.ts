import { randomUUID } from 'node:crypto'
import { UserError } from '../domain/conversation.js'
import type { DailyState, Focus, TaskProposal } from '../domain/daily.js'
import type { StateStore } from '../domain/state.js'
import { localTime } from './scheduling.js'
import { structuredArtifact } from './structured.js'

export class Daily {
  private readonly cache = new Map<string, DailyState>()
  private readonly owners = new Set<string>()
  private restored = false
  private ticking = false
  constructor(
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  get(owner: string): DailyState {
    this.owners.add(owner)
    const state = structuredClone(
      this.cache.get(owner) ??
        this.store?.getRecord<DailyState>('daily', owner) ?? {
          onboarding: null,
          onboarded: false,
          notes: false,
          favorites: [],
          recent: [],
          pending: null,
          plan: null,
          morning: null
        }
    )
    const pendingExpired =
      state.pending !== null && state.pending.expiresAt <= this.now()
    const planExpired =
      state.plan !== null && state.plan.expiresAt <= this.now()
    if (pendingExpired) state.pending = null
    if (planExpired) state.plan = null
    if (pendingExpired || planExpired) this.save(owner, state)
    return state
  }
  save(owner: string, state: DailyState): void {
    if (Buffer.byteLength(JSON.stringify(state)) > 100000)
      throw new UserError(
        'Daily settings exceed 100 KB. Clear pending work first.'
      )
    this.store?.putRecord('daily', owner, state)
    this.cache.set(owner, structuredClone(state))
    this.owners.add(owner)
  }
  focus(owner: string, value: string): void {
    if (!['work', 'study', 'personal'].includes(value))
      throw new UserError('Choose work, study or personal.')
    const state = this.get(owner)
    state.onboarding = value as Focus
    this.save(owner, state)
  }
  complete(owner: string): void {
    const state = this.get(owner)
    state.onboarded = true
    this.save(owner, state)
  }
  notes(owner: string, value: string): void {
    if (!['on', 'off'].includes(value))
      throw new UserError('Usage: /notes on|off.')
    const state = this.get(owner)
    state.notes = value === 'on'
    this.save(owner, state)
  }
  favorite(owner: string, id: string, add: boolean): void {
    const state = this.get(owner)
    state.favorites = state.favorites.filter(item => item !== id)
    if (add) state.favorites.push(id)
    if (state.favorites.length > 20)
      throw new UserError('Keep at most 20 favorite scenarios.')
    this.save(owner, state)
  }
  used(owner: string, id: string): void {
    const state = this.get(owner)
    state.recent = [id, ...state.recent.filter(item => item !== id)].slice(
      0,
      10
    )
    this.save(owner, state)
  }
  pending(
    owner: string,
    thread: string,
    revision: string | undefined,
    scenario: string
  ): void {
    const state = this.get(owner)
    state.pending = {
      scenario,
      thread,
      revision,
      expiresAt: this.now() + 600000
    }
    this.save(owner, state)
  }
  takePending(
    owner: string,
    thread: string,
    revision: string | undefined
  ): string | null {
    const state = this.get(owner),
      pending = state.pending
    if (!pending) return null
    state.pending = null
    this.save(owner, state)
    if (pending.thread !== thread || pending.revision !== revision)
      throw new UserError(
        'Scenario input expired or its conversation changed. Choose the scenario again.'
      )
    return pending.scenario
  }
  stage(
    owner: string,
    thread: string,
    revision: string | undefined,
    raw: string,
    timezone: string
  ): NonNullable<DailyState['plan']> {
    structuredArtifact(
      raw,
      { format: 'json', fields: ['summary', 'task', 'due'] },
      100000
    )
    const value = JSON.parse(raw) as {
      rows: {
        summary: string | null
        task: string | null
        due: string | null
      }[]
    }
    if (value.rows.length > 10)
      throw new UserError(
        'Task review supports at most 10 proposed tasks. Request a shorter plan.'
      )
    const items: TaskProposal[] = [],
      warnings: string[] = []
    for (const row of value.rows) {
      if (!row.task?.trim()) continue
      let dueAt: number | null = null
      if (row.due) {
        try {
          dueAt = localTime(row.due, timezone, this.now())
        } catch {
          warnings.push(
            `Deadline needs review: ${row.due.slice(0, 80)}. Task will have no deadline.`
          )
        }
      }
      const title = row.task.trim().slice(0, 1000)
      if (!items.some(item => item.title === title && item.dueAt === dueAt))
        items.push({ title, dueAt })
    }
    const state = this.get(owner)
    const plan = {
      token: randomUUID().slice(0, 12),
      thread,
      revision,
      expiresAt: this.now() + 600000,
      summary: value.rows
        .map(row => row.summary)
        .filter(Boolean)
        .join('\n')
        .slice(0, 4000),
      warnings,
      items
    }
    state.plan = plan
    this.save(owner, state)
    return structuredClone(plan)
  }
  plan(
    owner: string,
    thread: string,
    revision: string | undefined,
    token: string
  ): NonNullable<DailyState['plan']> {
    const plan = this.get(owner).plan
    if (
      !plan ||
      plan.thread !== thread ||
      plan.revision !== revision ||
      plan.token !== token
    )
      throw new UserError(
        'Task review expired or changed. Create a new review.'
      )
    return plan
  }
  clearPlan(owner: string): void {
    const state = this.get(owner)
    state.plan = null
    this.save(owner, state)
  }
  morning(owner: string, value: string): void {
    if (value !== 'off' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
      throw new UserError('Usage: /morning HH:MM or off.')
    const state = this.get(owner)
    state.morning =
      value === 'off'
        ? null
        : { time: value, date: '', attempts: 0, nextAttempt: 0, sent: false }
    this.save(owner, state)
  }
  async tick(
    allowed: (owner: string) => boolean,
    timezone: (owner: string) => string,
    quiet: (owner: string) => boolean,
    deliver: (owner: string) => Promise<void>
  ): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      if (!this.restored) {
        for (const [owner, state] of this.store?.records<DailyState>('daily') ??
          []) {
          this.owners.add(owner)
          if (!this.cache.has(owner)) this.cache.set(owner, state)
        }
        this.restored = true
      }
      for (const owner of this.owners) {
        if (!allowed(owner) || quiet(owner)) continue
        const state = this.get(owner),
          morning = state.morning
        if (!morning) continue
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone(owner),
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
          })
            .formatToParts(this.now())
            .map(part => [part.type, part.value])
        )
        const date = `${parts.year}-${parts.month}-${parts.day}`
        if (morning.date !== date)
          Object.assign(morning, {
            date,
            attempts: 0,
            nextAttempt: 0,
            sent: false
          })
        if (
          `${parts.hour}:${parts.minute}` < morning.time ||
          morning.sent ||
          morning.attempts >= 3 ||
          morning.nextAttempt > this.now()
        )
          continue
        morning.attempts++
        morning.nextAttempt = this.now() + 60000
        this.save(owner, state)
        try {
          await deliver(owner)
        } catch {
          continue
        }
        const current = this.get(owner)
        if (
          current.morning?.time === morning.time &&
          current.morning.date === date
        ) {
          current.morning.sent = true
          this.save(owner, current)
        }
      }
    } finally {
      this.ticking = false
    }
  }
  deleteThread(owner: string, thread: string): void {
    const state = this.get(owner)
    if (state.pending?.thread === thread) state.pending = null
    if (state.plan?.thread === thread) state.plan = null
    this.save(owner, state)
  }
  refresh(owner: string): void {
    this.cache.delete(owner)
    this.owners.add(owner)
  }
  erase(owner: string): void {
    this.store?.deleteRecord('daily', owner)
    this.cache.delete(owner)
    this.owners.delete(owner)
  }
}
