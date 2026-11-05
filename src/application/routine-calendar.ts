import { UserError } from '../domain/conversation.js'
import type { CalendarSnapshot, DayPlan } from '../domain/routine.js'
import { Workflow } from './workflow.js'
import { Routines, routineId, type RoutineScope } from './routines.js'
import {
  daySlots,
  freeWindows,
  localDate,
  routineHash,
  routineText
} from './routine-rules.js'
export interface EveningInput {
  day: string
  notes: string
  items: DayPlan['outcomes']
}
export class RoutineCalendar {
  constructor(
    private readonly data: Routines,
    private readonly workflow: Workflow
  ) {}
  connection(owner: string, id: string): void {
    if (
      id !== 'none' &&
      !this.data.config.workbench.connections.some(
        connection =>
          connection.id === id &&
          connection.owner === Number(owner.split(':')[0])
      )
    )
      throw new UserError(
        'Choose an owner-configured calendar connection or none.'
      )
    this.data.update(owner, state => {
      state.connection = id === 'none' ? null : id
      state.calendar = null
    })
  }
  preview(
    owner: string,
    scope: RoutineScope,
    origin: string,
    value: Omit<CalendarSnapshot, 'revision'>
  ) {
    freeWindows(value.start, value.end, value.events)
    routineText(value.source, 300)
    if (value.asOf > this.data.now() || this.data.now() - value.asOf > 900000)
      throw new UserError(
        'Calendar evidence is older than 15 minutes. Read or confirm availability again.'
      )
    if (
      value.connection !== this.data.get(owner).connection &&
      value.connection !== null
    )
      throw new UserError(
        'Calendar connection changed. Create a new read review.'
      )
    return this.data.preview(
      owner,
      scope,
      'calendar',
      origin,
      routineHash(this.data.get(owner).calendar),
      value
    )
  }
  confirmCalendar(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number
  ): CalendarSnapshot {
    const state = this.data.accept(
      owner,
      scope,
      token,
      revision,
      routineHash(this.data.get(owner).calendar),
      (state, pending) => {
        if (pending.kind !== 'calendar')
          throw new UserError('Choose a calendar preview.')
        const value = JSON.parse(pending.payload) as Omit<
          CalendarSnapshot,
          'revision'
        >
        freeWindows(value.start, value.end, value.events)
        if (value.connection !== null && value.connection !== state.connection)
          throw new UserError('Calendar connection changed.')
        if (this.data.now() - value.asOf > 900000)
          throw new UserError('Calendar evidence expired.')
        state.calendar = {
          ...value,
          revision: (state.calendar?.revision ?? 0) + 1
        }
      }
    )
    return state.calendar!
  }
  preference(
    owner: string,
    id: string,
    minutes: number,
    priority: number
  ): void {
    if (
      !this.workflow.get(owner).tasks.some(task => task.id === id) ||
      !Number.isSafeInteger(minutes) ||
      minutes < 1 ||
      minutes > 480 ||
      !Number.isSafeInteger(priority) ||
      priority < 0 ||
      priority > 9
    )
      throw new UserError(
        'Choose an owned task, duration 1..480 minutes and priority 0..9.'
      )
    this.data.update(owner, state => {
      state.preferences[id] = { minutes, priority }
    })
  }
  private base(owner: string): string {
    const state = this.data.get(owner)
    return routineHash({
      calendar: state.calendar,
      preferences: state.preferences,
      tasks: this.workflow.get(owner).tasks
    })
  }
  plan(owner: string, scope: RoutineScope, timezone: string) {
    const state = this.data.get(owner),
      calendar = state.calendar
    if (
      !calendar ||
      calendar.end <= this.data.now() ||
      this.data.now() - calendar.asOf > 900000
    )
      throw new UserError(
        'Review a fresh calendar/manual availability window before planning.'
      )
    const existing = state.days.find(
      day => day.date === localDate(calendar.start, timezone)
    )
    if (existing?.closed)
      throw new UserError(
        'This day was closed. Remove its retained plan explicitly before creating another.'
      )
    const scheduled = daySlots(
        this.workflow.get(owner).tasks,
        state.preferences,
        freeWindows(calendar.start, calendar.end, calendar.events),
        this.data.now()
      ),
      plan: DayPlan = {
        id: existing?.id ?? routineId(),
        date: localDate(calendar.start, timezone),
        revision: (existing?.revision ?? 0) + 1,
        calendar: calendar.revision,
        ...scheduled,
        notes:
          'Five-minute buffers; unscheduled tasks remain unchanged. Calendar data is a reviewed snapshot, not live availability.',
        closed: false,
        outcomes: []
      }
    return this.data.preview(
      owner,
      scope,
      'plan',
      `plan:${routineId()}`,
      this.base(owner),
      plan
    )
  }
  confirmPlan(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number
  ): DayPlan {
    let plan!: DayPlan
    this.data.accept(
      owner,
      scope,
      token,
      revision,
      this.base(owner),
      (state, pending) => {
        if (
          pending.kind !== 'plan' ||
          !state.calendar ||
          this.data.now() - state.calendar.asOf > 900000
        )
          throw new UserError('Choose a fresh day-plan review.')
        plan = JSON.parse(pending.payload) as DayPlan
        state.days = [...state.days.filter(day => day.id !== plan.id), plan]
      }
    )
    return plan
  }
  evening(owner: string, scope: RoutineScope, date: string) {
    const day = this.data.get(owner).days.find(day => day.date === date)
    if (!day || day.closed)
      throw new UserError('Choose an accepted day plan that is not closed.')
    const tasks = this.workflow.get(owner).tasks
    const payload: EveningInput = {
      day: day.id,
      notes: '',
      items: day.slots.flatMap(slot => {
        const task = tasks.find(task => task.id === slot.task)
        return task
          ? [
              {
                task: task.id,
                action:
                  task.status === 'done'
                    ? ('done' as const)
                    : ('keep' as const),
                dueAt: null
              }
            ]
          : []
      })
    }
    return this.data.preview(
      owner,
      scope,
      'evening',
      `evening:${day.id}:${day.revision}`,
      routineHash({ day, tasks }),
      payload
    )
  }
  editEvening(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number,
    id: string,
    action: string,
    dueAt: number | null
  ) {
    const pending = this.data.review(owner, scope, token, revision, 'evening'),
      payload = JSON.parse(pending.payload) as EveningInput,
      item = payload.items.find(item => item.task === id)
    if (
      !item ||
      !['done', 'keep', 'carry', 'cancel'].includes(action) ||
      (action === 'carry' &&
        (dueAt === null || !Number.isFinite(dueAt) || dueAt <= this.data.now()))
    )
      throw new UserError(
        'Choose a reviewed task and done, keep, carry with a future deadline, or cancel.'
      )
    item.action = action as typeof item.action
    item.dueAt = action === 'carry' ? dueAt : null
    return this.data.replace(owner, scope, token, revision, payload)
  }
  noteEvening(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number,
    note: string
  ) {
    const pending = this.data.review(owner, scope, token, revision, 'evening'),
      payload = JSON.parse(pending.payload) as EveningInput
    payload.notes = routineText(note, 2000)
    return this.data.replace(owner, scope, token, revision, payload)
  }
  close(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number
  ): void {
    const pending = this.data.review(owner, scope, token, revision, 'evening'),
      payload = JSON.parse(pending.payload) as EveningInput,
      day = this.data.get(owner).days.find(day => day.id === payload.day),
      flow = this.workflow.get(owner)
    if (!day || day.closed)
      throw new UserError('Day plan changed or is already closed.')
    const receipt = flow.routineReceipts?.find(
      item => item.token === pending.token
    )
    if (!receipt) {
      if (routineHash({ day, tasks: flow.tasks }) !== pending.base)
        throw new UserError(
          'Tasks or day plan changed. Reopen the evening review.'
        )
      for (const item of payload.items) {
        const task = flow.tasks.find(task => task.id === item.task)!
        if (item.action === 'cancel') {
          flow.tasks = flow.tasks.filter(task => task.id !== item.task)
          continue
        }
        if (item.action === 'done') task.status = 'done'
        if (item.action === 'carry') {
          if (item.dueAt === null || item.dueAt <= this.data.now())
            throw new UserError(
              'Carry-forward deadline expired. Review the next date again.'
            )
          task.status = 'open'
          task.dueAt = item.dueAt
          task.reminded = false
          task.attempts = 0
          task.nextAttempt = 0
          delete task.delivery
        }
      }
      flow.routineReceipts = [
        ...(flow.routineReceipts ?? []),
        { token: pending.token, base: pending.base }
      ].slice(-100)
      this.workflow.save(owner, flow)
    } else if (receipt.base !== pending.base)
      throw new UserError(
        'Evening recovery receipt does not match this review.'
      )
    this.data.accept(owner, scope, token, revision, pending.base, state => {
      const target = state.days.find(item => item.id === day.id)!
      target.closed = true
      target.revision++
      target.notes = payload.notes
      target.outcomes = payload.items
    })
  }
  remove(owner: string, id: string): void {
    this.data.update(owner, state => {
      if (!state.days.some(day => day.id === id))
        throw new UserError('Day plan not found.')
      state.days = state.days.filter(day => day.id !== id)
    })
  }
}
