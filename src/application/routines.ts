import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import type { StateStore } from '../domain/state.js'
import type {
  HomeAction,
  RoutineReview,
  RoutineState
} from '../domain/routine.js'
import { UserError } from '../domain/conversation.js'
export const routineId = (): string => randomUUID().slice(0, 12)
export interface RoutineScope {
  thread: string
  project: string | null
}
export class Routines {
  private readonly local = new Map<string, RoutineState>()
  constructor(
    readonly config: Config,
    private readonly store?: StateStore,
    readonly now = Date.now
  ) {}
  get(owner: string): RoutineState {
    const state = structuredClone<RoutineState>(
      this.store?.getRecord<RoutineState>('routines', owner) ??
        this.local.get(owner) ?? {
          revision: 0,
          connection: null,
          calendar: null,
          preferences: {},
          days: [],
          expenses: [],
          subscriptions: [],
          refunds: [],
          cards: [],
          session: null,
          waiting: [],
          sources: [],
          reading: [],
          topics: {},
          hiddenTopics: [],
          readingTime: null,
          reviewTime: null,
          shortcuts: ['plan', 'expense', 'evening'],
          focus: null,
          pending: null,
          accepted: [],
          claims: [],
          seen: [],
          alerts: []
        }
    )
    let changed = false
    if (state.pending && state.pending.expiresAt <= this.now()) {
      state.pending = null
      changed = true
    }
    if (state.session && state.session.expiresAt <= this.now()) {
      state.session = null
      changed = true
    }
    if (changed) this.save(owner, state)
    return state
  }
  private save(owner: string, state: RoutineState): void {
    if (
      state.days.length > 31 ||
      state.expenses.length > 500 ||
      state.subscriptions.length > 50 ||
      state.refunds.length > 100 ||
      state.cards.length > 200 ||
      state.waiting.length > 100 ||
      state.sources.length > 20 ||
      state.reading.length > 500 ||
      Object.keys(state.preferences).length > 100 ||
      Object.keys(state.topics).length > 20 ||
      state.hiddenTopics.length > 20 ||
      state.claims.length > 1000 ||
      state.seen.length > 5000 ||
      Buffer.byteLength(JSON.stringify(state)) >
        Math.min(2000000, this.config.maxJobBytes)
    )
      throw new UserError(
        'Daily routine storage/capacity is full. Export and remove unused records or sources first.'
      )
    state.revision++
    this.store?.putRecord('routines', owner, state)
    if (!this.store) this.local.set(owner, structuredClone(state))
  }
  update(owner: string, change: (state: RoutineState) => void): RoutineState {
    const state = this.get(owner)
    change(state)
    state.accepted = state.accepted.slice(-1000)
    state.alerts = state.alerts.slice(-100)
    this.save(owner, state)
    return structuredClone(state)
  }
  owners(): string[] {
    return [
      ...new Set([
        ...(this.store?.records('routines') ?? []).map(([owner]) => owner),
        ...this.local.keys()
      ])
    ]
  }
  persistent(): void {
    if (!this.store || this.config.statePath === ':memory:')
      throw new UserError(
        'Enable persistent state before scheduling routine deliveries.'
      )
  }
  preview(
    owner: string,
    scope: RoutineScope,
    kind: RoutineReview['kind'],
    origin: string,
    base: string,
    payload: unknown
  ): RoutineReview {
    const pending: RoutineReview = {
      ...scope,
      kind,
      origin,
      base,
      token: routineId(),
      revision: 1,
      expiresAt: this.now() + 600000,
      payload: JSON.stringify(payload)
    }
    this.update(owner, state => {
      if (state.accepted.includes(origin))
        throw new UserError('This routine result was already accepted.')
      state.pending = pending
    })
    return pending
  }
  review(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number,
    kind?: RoutineReview['kind']
  ): RoutineReview {
    const pending = this.get(owner).pending
    if (
      !pending ||
      pending.token !== token ||
      pending.revision !== revision ||
      pending.thread !== scope.thread ||
      pending.project !== scope.project ||
      (kind && kind !== pending.kind)
    )
      throw new UserError(
        'Routine review expired or changed. Reopen its exact source preview.'
      )
    return pending
  }
  replace(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number,
    payload: unknown
  ): RoutineReview {
    const pending = this.review(owner, scope, token, revision)
    pending.payload = JSON.stringify(payload)
    pending.revision++
    pending.expiresAt = this.now() + 600000
    this.update(owner, state => {
      state.pending = pending
    })
    return pending
  }
  accept(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number,
    base: string,
    apply: (state: RoutineState, pending: RoutineReview) => void
  ): RoutineState {
    const pending = this.review(owner, scope, token, revision)
    if (pending.base !== base)
      throw new UserError(
        'Source records changed. Create or reopen a fresh routine review.'
      )
    return this.update(owner, state => {
      if (state.accepted.includes(pending.origin))
        throw new UserError('This routine result was already accepted.')
      apply(state, pending)
      state.accepted.push(pending.origin)
      state.pending = null
    })
  }
  shortcuts(owner: string, values: string[]): void {
    if (
      values.length !== 3 ||
      new Set(values).size !== 3 ||
      values.some(
        value =>
          ![
            'plan',
            'evening',
            'expense',
            'review',
            'waiting',
            'reading',
            'focus'
          ].includes(value)
      )
    )
      throw new UserError(
        'Choose exactly three different shortcuts: plan, evening, expense, review, waiting, reading or focus.'
      )
    this.update(owner, state => {
      state.shortcuts = values as HomeAction[]
    })
  }
  focus(owner: string, task: string | null, minutes: number): void {
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 180)
      throw new UserError('Choose a focus duration from 1 to 180 minutes.')
    this.persistent()
    this.update(owner, state => {
      if (state.focus && state.focus.end > this.now())
        throw new UserError(
          'Stop the current focus timer before starting another.'
        )
      state.focus = {
        token: routineId(),
        task,
        start: this.now(),
        end: this.now() + minutes * 60000
      }
    })
  }
  stopFocus(owner: string): void {
    this.update(owner, state => {
      state.focus = null
    })
  }
  deleteThread(owner: string, thread: string): void {
    this.update(owner, state => {
      if (state.pending?.thread === thread) state.pending = null
      if (state.session?.thread === thread) state.session = null
    })
  }
  erase(owner: string): void {
    this.store?.deleteRecord('routines', owner)
    this.local.delete(owner)
  }
}
