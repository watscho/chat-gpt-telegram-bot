import { UserError } from '../domain/conversation.js'
import { Routines } from './routines.js'
import { RoutineCalendar } from './routine-calendar.js'
import { RoutineFinance } from './routine-finance.js'
import { RoutineLearning } from './routine-learning.js'
import { RoutineWaiting } from './routine-waiting.js'
import { RoutineReading } from './routine-reading.js'
import { RoutinePlans } from './routine-plans.js'
import { RoutineReviews } from './routine-reviews.js'
import { Profiles } from './profiles.js'
import { Workspaces } from './workspaces.js'
import { Workflow } from './workflow.js'
import { localDate } from './routine-rules.js'
import { localTime } from './scheduling.js'
function fields(value: unknown, keys: string[]): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof value === 'string' ? value : '')
  } catch {
    throw new UserError('Provide valid daily action fields.')
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== keys.length ||
    keys.some(
      key =>
        !Object.hasOwn(parsed, key) ||
        typeof (parsed as Record<string, unknown>)[key] !== 'string'
    )
  )
    throw new UserError('Daily action fields do not match the selected form.')
  return parsed as Record<string, string>
}
export class RoutineHome {
  constructor(
    private readonly data: Routines,
    private readonly calendar: RoutineCalendar,
    private readonly finance: RoutineFinance,
    private readonly learning: RoutineLearning,
    private readonly waiting: RoutineWaiting,
    private readonly reading: RoutineReading,
    private readonly plans: RoutinePlans,
    private readonly reviews: RoutineReviews,
    private readonly profiles: Profiles,
    private readonly ws: Workspaces,
    private readonly workflow: Workflow
  ) {}
  snapshot(owner: string) {
    const state = this.data.get(owner),
      thread = this.profiles.get(owner).active,
      project = this.ws.thread(owner, thread).project,
      timezone = this.ws.get(owner).timezone,
      date = localDate(this.data.now(), timezone),
      pending =
        state.pending?.thread === thread && state.pending.project === project
          ? state.pending
          : null,
      session =
        state.session?.thread === thread && state.session.project === project
          ? state.session
          : null,
      card = state.cards.find(card => card.id === session?.card)
    return {
      now: this.data.now(),
      date,
      timezone,
      shortcuts: state.shortcuts,
      calendar: state.calendar,
      connection: state.connection,
      connections: this.data.config.workbench.connections
        .filter(item => item.owner === Number(owner.split(':')[0]))
        .map(item => ({ id: item.id, title: item.title })),
      tasks: this.workflow
        .get(owner)
        .tasks.filter(task => task.status === 'open')
        .map(task => ({
          ...task,
          minutes: state.preferences[task.id]?.minutes ?? 25,
          priority: state.preferences[task.id]?.priority ?? 0
        })),
      days: state.days,
      pending: pending
        ? {
            token: pending.token,
            revision: pending.revision,
            kind: pending.kind,
            payload: pending.payload
          }
        : null,
      session:
        session && card
          ? {
              token: session.token,
              front: card.front,
              back: session.revealed ? card.back : null,
              source: card.source.title
            }
          : null,
      learning: this.learning.progress(owner),
      totals: this.finance.totals(owner, date.slice(0, 7)),
      expenses: state.expenses.slice(-20),
      subscriptions: state.subscriptions,
      refunds: state.refunds,
      waiting: state.waiting.map(item => ({
        id: item.id,
        contact: item.contact,
        request: item.request,
        status: item.status,
        checkAt: item.checkAt,
        connection: item.connection
      })),
      reading: this.reading.top(owner),
      sources: state.sources,
      topics: state.topics,
      hiddenTopics: state.hiddenTopics,
      readingTime: state.readingTime,
      reviewTime: state.reviewTime,
      focus: state.focus,
      alerts: state.alerts.slice(-10),
      mission: null as string | null
    }
  }
  action(owner: string, body: Record<string, unknown>) {
    if (
      Object.keys(body).some(
        key => !['action', 'id', 'revision', 'value', 'confirm'].includes(key)
      ) ||
      typeof body.action !== 'string' ||
      typeof body.id !== 'string' ||
      body.id.length > 120 ||
      (body.value !== undefined &&
        (typeof body.value !== 'string' || body.value.length > 20000))
    )
      throw new UserError('Invalid home-panel action.')
    const action = body.action,
      id = body.id,
      thread = this.profiles.get(owner).active,
      scope = { thread, project: this.ws.thread(owner, thread).project },
      timezone = this.ws.get(owner).timezone
    let mission: string | null = null
    if (action === 'home:pins') {
      this.data.shortcuts(owner, String(body.value).split(','))
    } else if (action === 'home:plan')
      this.calendar.plan(owner, scope, timezone)
    else if (action === 'home:calendar-use') this.calendar.connection(owner, id)
    else if (action === 'home:calendar-sync' || action === 'home:manual') {
      const value = fields(
        body.value,
        action === 'home:manual'
          ? ['date', 'start', 'end', 'busy']
          : ['date', 'start', 'end']
      )
      if (action === 'home:manual')
        this.plans.manual(
          owner,
          thread,
          value.date!,
          value.start!,
          value.end!,
          value.busy!
        )
      else
        mission = this.plans.calendarRead(
          owner,
          thread,
          value.date!,
          value.start!,
          value.end!
        ).id
    } else if (action === 'home:task') {
      const value = fields(body.value, ['minutes', 'priority'])
      this.calendar.preference(
        owner,
        id,
        Number(value.minutes),
        Number(value.priority)
      )
    } else if (action === 'home:confirm' || action === 'home:cancel') {
      if (!Number.isSafeInteger(body.revision))
        throw new UserError('Open a fresh daily review.')
      if (action === 'home:confirm') {
        if (body.confirm !== true)
          throw new UserError('Confirm the exact displayed daily changes.')
        this.reviews.confirm(owner, scope, id, Number(body.revision))
      } else this.reviews.cancel(owner, scope, id, Number(body.revision))
    } else if (action === 'home:evening') {
      const date =
        id ||
        this.data
          .get(owner)
          .days.filter(day => !day.closed)
          .sort((a, b) => b.date.localeCompare(a.date))[0]?.date
      if (!date)
        throw new UserError('Accept a day plan before the evening review.')
      this.calendar.evening(owner, scope, date)
    } else if (action === 'home:outcome') {
      const value = fields(body.value, ['task', 'action', 'due'])
      this.calendar.editEvening(
        owner,
        scope,
        id,
        Number(body.revision),
        value.task!,
        value.action!,
        value.action === 'carry'
          ? localTime(value.due!, timezone, this.data.now())
          : null
      )
    } else if (action === 'home:evening-note')
      this.calendar.noteEvening(
        owner,
        scope,
        id,
        Number(body.revision),
        String(body.value)
      )
    else if (action === 'home:focus') {
      if (id && !this.workflow.get(owner).tasks.some(task => task.id === id))
        throw new UserError('Choose an owned focus task.')
      this.data.focus(owner, id || null, Number(body.value ?? '25'))
    } else if (action === 'home:focus-stop') this.data.stopFocus(owner)
    else if (action === 'home:review-next') this.learning.next(owner, scope)
    else if (action === 'home:review-reveal')
      this.learning.reveal(owner, scope, id)
    else if (action === 'home:review-grade')
      this.learning.grade(owner, scope, id, String(body.value))
    else if (action === 'home:cards-plan')
      mission = this.plans.cards(
        owner,
        thread,
        id || 'selected',
        String(body.value ?? '')
      ).id
    else if (action === 'home:expense-preview') {
      const value = fields(body.value, [
        'merchant',
        'date',
        'currency',
        'amount',
        'category'
      ])
      this.finance.manual(
        owner,
        scope,
        value.merchant!,
        value.date!,
        value.currency!,
        value.amount!,
        value.category!
      )
    } else if (action === 'home:waiting-check')
      mission = this.plans.checkReply(owner, thread, id).id
    else if (action === 'home:waiting-draft')
      mission = this.plans.followup(
        owner,
        thread,
        id,
        String(body.value ?? ''),
        false
      ).id
    else if (action === 'home:waiting-close')
      this.waiting.control(owner, id, 'close')
    else if (action === 'home:reading-mark')
      this.reading.mark(owner, id, String(body.value))
    else if (action === 'home:reading-brief')
      mission = this.plans.brief(
        owner,
        thread,
        id ? id.split(',') : this.reading.top(owner).map(item => item.id),
        String(body.value ?? '')
      ).id
    else if (action === 'home:reading-topic') {
      const value = fields(body.value, ['topic', 'weight']),
        weight =
          value.weight === 'hide' || value.weight === 'show'
            ? value.weight
            : Number(value.weight)
      this.reading.topic(owner, value.topic!, weight)
    } else
      throw new UserError(
        'Unknown home action. Use Telegram for source subscriptions, correspondence bindings and financial payment/refund confirmations.'
      )
    const view = this.snapshot(owner)
    view.mission = mission
    return view
  }
}
export type HomeView = ReturnType<RoutineHome['snapshot']>
