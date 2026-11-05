import { RoutineReviews } from '../application/routine-reviews.js'
import { UserError, type Document, type Image } from '../domain/conversation.js'
import type { RoutineReview } from '../domain/routine.js'
import type { SuiteContext } from './suite-commands.js'
import { StudioCommands } from './studio-commands.js'
import { Routines, routineId } from '../application/routines.js'
import { RoutineCalendar } from '../application/routine-calendar.js'
import { RoutineFinance } from '../application/routine-finance.js'
import { RoutineLearning } from '../application/routine-learning.js'
import { RoutineWaiting } from '../application/routine-waiting.js'
import { RoutineReading } from '../application/routine-reading.js'
import { RoutinePlans } from '../application/routine-plans.js'
import { RoutineExecutor } from '../application/routine-executor.js'
import { Workspaces } from '../application/workspaces.js'
import { Workflow } from '../application/workflow.js'
import { Studio } from '../application/studio.js'
import { Suite } from '../application/suite.js'
import { localDate, money, routineHash } from '../application/routine-rules.js'
import { localTime } from '../application/scheduling.js'
export interface RoutineContext extends SuiteContext {
  materials(): Promise<{ images: Image[]; documents: Document[] }>
}
export class RoutineCommands {
  constructor(
    private readonly data: Routines,
    private readonly calendar: RoutineCalendar,
    private readonly finance: RoutineFinance,
    private readonly learning: RoutineLearning,
    private readonly waiting: RoutineWaiting,
    private readonly reading: RoutineReading,
    private readonly plans: RoutinePlans,
    private readonly executor: RoutineExecutor,
    private readonly studio: Studio,
    private readonly studioCommands: StudioCommands,
    private readonly ws: Workspaces,
    private readonly workflow: Workflow,
    private readonly suite: Suite,
    private readonly reviews: RoutineReviews
  ) {}
  private scope(ctx: RoutineContext) {
    return {
      thread: ctx.thread,
      project: this.ws.thread(ctx.owner, ctx.thread).project
    }
  }
  private date(ctx: RoutineContext): string {
    return localDate(this.data.now(), this.ws.get(ctx.owner).timezone)
  }
  private time(ctx: RoutineContext, value: string): number {
    return localTime(value, this.ws.get(ctx.owner).timezone, this.data.now())
  }
  async preview(ctx: RoutineContext, pending: RoutineReview): Promise<void> {
    await ctx.file(Buffer.from(pending.payload), 'daily-review.json')
    await ctx.text(
      `Daily ${pending.kind} preview ${pending.token} · revision ${pending.revision}. Review the attached full JSON before accepting.\n${pending.payload.slice(0, 10000)}${pending.payload.length > 10000 ? '\n[Preview shortened; inspect the attachment.]' : ''}\n/day confirm ${pending.token} ${pending.revision} · /day cancel ${pending.token} ${pending.revision}. Expires in 10 minutes.`
    )
  }
  async home(ctx: RoutineContext): Promise<void> {
    const state = this.data.get(ctx.owner),
      progress = this.learning.progress(ctx.owner),
      today = state.days.find(day => day.date === this.date(ctx)),
      tasks = this.workflow
        .get(ctx.owner)
        .tasks.filter(task => task.status === 'open'),
      labels = {
        plan: 'Plan day',
        evening: 'Close day',
        expense: 'Record expense',
        review: 'Practice',
        waiting: 'Waiting replies',
        reading: 'Reading',
        focus: 'Focus 25 min'
      }
    await ctx.text(
      `My day · ${this.date(ctx)} · ${this.ws.get(ctx.owner).timezone}\n${tasks.length} open tasks · ${progress.due} due cards · ${state.waiting.filter(item => item.status === 'waiting').length} waiting replies\n${today ? `${today.slots.length} planned tasks · ${today.closed ? 'day closed' : 'review progress'}` : 'No accepted day plan yet.'}\n${state.focus ? `Focus ends ${new Date(state.focus.end).toISOString()}` : 'No focus timer.'}\n${this.finance.totals(ctx.owner, this.date(ctx).slice(0, 7))}\n/home shortcuts plan expense evening customizes three different actions. /home workspace opens the signed panel.`,
      {
        inline_keyboard: [
          state.shortcuts.map(action => ({
            text: labels[action],
            callback_data: `routine:home:${action}`
          })),
          [{ text: 'Open workspace', callback_data: 'routine:workspace' }]
        ]
      }
    )
  }
  async callback(ctx: RoutineContext, value: string): Promise<boolean> {
    if (!value.startsWith('routine:')) return false
    const [, kind, id, grade] = value.split(':')
    if (kind === 'workspace') await ctx.workspace()
    else if (kind === 'home') {
      const command = {
        plan: '/day plan',
        evening: '/day evening',
        expense: '/expense',
        review: '/review next',
        waiting: '/waiting',
        reading: '/reading',
        focus: '/focus 25'
      }[id!]
      if (!command) throw new UserError('Choose a current home shortcut.')
      await this.handle(ctx, command)
    } else if (kind === 'reveal') {
      const back = this.learning.reveal(ctx.owner, this.scope(ctx), id!)
      await ctx.text(back, {
        inline_keyboard: [
          ['again', 'hard', 'good', 'easy'].map(grade => ({
            text: grade,
            callback_data: `routine:grade:${id}:${grade}`
          }))
        ]
      })
    } else if (kind === 'grade') {
      this.learning.grade(ctx.owner, this.scope(ctx), id!, grade!)
      await ctx.text('Recall recorded. /review next opens another due card.')
    } else throw new UserError('Unknown daily routine control.')
    return true
  }
  async handle(ctx: RoutineContext, text: string): Promise<boolean> {
    const match = text.match(
      /^\/(home|day|expense|review|waiting|reading|focus)(?:@\w+)?(?:\s+|$)/i
    )
    if (!match) return false
    const command = match[1]!.toLowerCase(),
      arg = text.slice(match[0].length).trim(),
      split = arg.split('|').map(item => item.trim()),
      parts = split[0]!.split(/\s+/),
      [action, id, third, fourth] = parts
    if (command === 'home') {
      if (action === 'shortcuts') {
        this.data.shortcuts(ctx.owner, parts.slice(1))
        await this.home(ctx)
      } else if (action === 'workspace') await ctx.workspace()
      else await this.home(ctx)
      return true
    }
    if (command === 'focus') {
      if (action === 'stop') {
        this.data.stopFocus(ctx.owner)
        await ctx.text('Focus timer stopped.')
      } else {
        const minutes = Number(action || '25'),
          task =
            id && id !== 'none'
              ? this.workflow.get(ctx.owner).tasks.find(task => task.id === id)
              : null
        if (id && id !== 'none' && !task)
          throw new UserError('Choose an owned task or none.')
        this.data.focus(ctx.owner, task?.id ?? null, minutes)
        await ctx.text(
          `Focus timer started for ${minutes} minutes. /focus stop ends it; a local notification is attempted when due.`
        )
      }
      return true
    }
    if (command === 'day') {
      await this.day(ctx, parts, split)
      return true
    }
    if (command === 'expense') {
      await this.expense(ctx, parts, split)
      return true
    }
    if (command === 'review') {
      if (!action) {
        const progress = this.learning.progress(ctx.owner)
        await ctx.text(
          `${progress.cards} cards · ${progress.due} due · ${progress.reviews} reviews · ${progress.lapses} lapses\n/review next; reveal TOKEN; grade TOKEN again|hard|good|easy; add | front | back; from COURSE_ID_OR_selected | focus; notify HH:MM|off; remove ID`
        )
      } else if (action === 'add') {
        const front = split[1] ?? '',
          back = split[2] ?? ''
        await this.preview(
          ctx,
          this.learning.preview(
            ctx.owner,
            this.scope(ctx),
            `manual-card:${routineId()}`,
            [
              {
                front,
                back,
                source: {
                  id: routineHash({ front, back }).slice(0, 20),
                  title: 'Explicit manual learning card',
                  text: back,
                  thread: ctx.thread,
                  project: this.scope(ctx).project
                }
              }
            ]
          )
        )
      } else if (action === 'from')
        await this.studioCommands.show(
          ctx,
          this.plans.cards(
            ctx.owner,
            ctx.thread,
            id ?? 'selected',
            split.slice(1).join('|')
          )
        )
      else if (action === 'next') {
        const card = this.learning.next(ctx.owner, this.scope(ctx))
        if (!card)
          await ctx.text(
            'No cards are due. /review shows progress and creation controls.'
          )
        else
          await ctx.text(`${card.front}\nSource: ${card.source}`, {
            inline_keyboard: [
              [
                {
                  text: 'Reveal answer',
                  callback_data: `routine:reveal:${card.token}`
                }
              ]
            ]
          })
      } else if (action === 'reveal')
        await this.callback(ctx, `routine:reveal:${id}`)
      else if (action === 'grade')
        await this.callback(ctx, `routine:grade:${id}:${third}`)
      else if (action === 'notify') {
        this.learning.notify(ctx.owner, id!)
        await ctx.text('Daily review notification setting saved.')
      } else if (action === 'remove') {
        this.learning.remove(ctx.owner, id!)
        await ctx.text('Learning card removed.')
      } else throw new UserError('Unknown review action. Use /review.')
      return true
    }
    if (command === 'waiting') {
      await this.correspondence(ctx, parts, split)
      return true
    }
    if (!action) {
      const items = this.reading.top(ctx.owner)
      await ctx.text(
        items
          .map(
            item =>
              `${item.id} · ${item.title}\n${item.url}\n${item.excerpt}\n${item.reason}`
          )
          .join('\n\n') ||
          'No unread selected-source items. /reading add rss|page HOURS URL'
      )
      await ctx.text(
        '/reading sources; add rss|page HOURS URL; check SOURCE_ID; on|off|remove SOURCE_ID; topic -5..5|hide|show | phrase; more|less ITEM | phrase; read|unread|hide|save ITEM; delivery HH:MM|off; brief [ID,ID] | focus; export'
      )
      return true
    }
    if (action === 'add') {
      const source = this.reading.add(ctx.owner, id!, fourth!, Number(third))
      await ctx.text(
        `Reading source ${source.id} enabled. Public reads run at the selected interval; no automatic model brief.`
      )
    } else if (action === 'sources')
      await ctx.text(JSON.stringify(this.data.get(ctx.owner).sources, null, 2))
    else if (action === 'check') {
      await this.reading.check(ctx.owner, id!)
      await ctx.text(
        JSON.stringify(
          this.data.get(ctx.owner).sources.find(source => source.id === id),
          null,
          2
        )
      )
    } else if (['on', 'off', 'remove'].includes(action)) {
      this.reading.control(ctx.owner, id!, action)
      await ctx.text('Reading source updated.')
    } else if (action === 'topic') {
      const value = id === 'hide' || id === 'show' ? id : Number(id)
      this.reading.topic(ctx.owner, split[1] ?? '', value)
      await ctx.text('Reading topic preference saved.')
    } else if (action === 'topics')
      await ctx.text(
        JSON.stringify(
          {
            weights: this.data.get(ctx.owner).topics,
            hidden: this.data.get(ctx.owner).hiddenTopics
          },
          null,
          2
        )
      )
    else if (action === 'more' || action === 'less') {
      this.reading.feedback(ctx.owner, id!, split[1] ?? '', action)
      await ctx.text('Reading relevance preference updated.')
    } else if (['read', 'unread', 'hide', 'save'].includes(action)) {
      this.reading.mark(ctx.owner, id!, action)
      await ctx.text('Reading item updated.')
    } else if (action === 'delivery') {
      this.reading.delivery(ctx.owner, id!)
      await ctx.text('Local selected-source delivery schedule saved.')
    } else if (action === 'brief')
      await this.studioCommands.show(
        ctx,
        this.plans.brief(
          ctx.owner,
          ctx.thread,
          id ? id.split(',') : this.reading.top(ctx.owner).map(item => item.id),
          split.slice(1).join('|')
        )
      )
    else if (action === 'export') {
      const state = this.data.get(ctx.owner)
      await ctx.file(
        Buffer.from(
          JSON.stringify(
            {
              sources: state.sources,
              items: state.reading,
              topics: state.topics,
              hidden: state.hiddenTopics
            },
            null,
            2
          )
        ),
        'reading.json'
      )
    } else throw new UserError('Unknown reading action. Use /reading.')
    return true
  }
  private async day(
    ctx: RoutineContext,
    parts: string[],
    split: string[]
  ): Promise<void> {
    const [action, id, third, fourth, fifth, sixth] = parts,
      scope = this.scope(ctx)
    if (!action) {
      await ctx.text(
        `Day plans\n${
          this.data
            .get(ctx.owner)
            .days.map(
              day =>
                `${day.id} · ${day.date} · ${day.closed ? 'closed' : 'open'} · ${day.slots.length} slots`
            )
            .join('\n') || 'No accepted plans.'
        }\n/day calendar; task TASK MINUTES PRIORITY; plan; preview; confirm TOKEN REVISION; cancel TOKEN REVISION; evening [DATE]; evening set TOKEN REVISION TASK done|keep|cancel|carry | future local deadline; evening note TOKEN REVISION | note; review MISSION_ID; remove PLAN_ID; alerts; export`
      )
      return
    }
    if (action === 'calendar') {
      if (id === 'use') {
        this.calendar.connection(ctx.owner, third!)
        await ctx.text('Calendar connection selection saved.')
      } else if (id === 'sync')
        await this.studioCommands.show(
          ctx,
          this.plans.calendarRead(
            ctx.owner,
            ctx.thread,
            third!,
            fourth!,
            fifth!
          )
        )
      else if (id === 'manual')
        await this.preview(
          ctx,
          this.plans.manual(
            ctx.owner,
            ctx.thread,
            third!,
            fourth!,
            fifth!,
            split[1] ?? ''
          )
        )
      else
        await ctx.text(
          `Calendar: ${JSON.stringify(this.data.get(ctx.owner).calendar)}\nConfigured connection: ${this.data.get(ctx.owner).connection ?? 'none'}\nAvailable: ${
            this.data.config.workbench.connections
              .filter(item => item.owner === Number(ctx.owner.split(':')[0]))
              .map(item => item.id)
              .join(', ') || 'none'
          }\n/day calendar use CONNECTION_OR_none\n/day calendar sync YYYY-MM-DD HH:MM HH:MM\n/day calendar manual YYYY-MM-DD HH:MM HH:MM | [] (or explicit busy intervals with title/start/end local strings)`
        )
      return
    }
    if (action === 'task') {
      this.calendar.preference(ctx.owner, id!, Number(third), Number(fourth))
      await ctx.text('Task duration/priority saved.')
      return
    }
    if (action === 'plan') {
      await this.preview(
        ctx,
        this.calendar.plan(ctx.owner, scope, this.ws.get(ctx.owner).timezone)
      )
      return
    }
    if (action === 'preview') {
      const pending = this.data.get(ctx.owner).pending
      if (!pending) throw new UserError('No current daily preview.')
      await this.preview(
        ctx,
        this.data.review(ctx.owner, scope, pending.token, pending.revision)
      )
      return
    }
    if (action === 'confirm') {
      this.reviews.confirm(ctx.owner, scope, id!, Number(third))
      await ctx.text(
        'Reviewed daily change saved. /home shows the current dashboard.'
      )
      return
    }
    if (action === 'cancel') {
      this.reviews.cancel(ctx.owner, scope, id!, Number(third))
      await ctx.text('Local daily preview cancelled.')
      return
    }
    if (action === 'evening') {
      if (id === 'set')
        await this.preview(
          ctx,
          this.calendar.editEvening(
            ctx.owner,
            scope,
            third!,
            Number(fourth),
            fifth!,
            sixth!,
            sixth === 'carry' ? this.time(ctx, split[1] ?? '') : null
          )
        )
      else if (id === 'note')
        await this.preview(
          ctx,
          this.calendar.noteEvening(
            ctx.owner,
            scope,
            third!,
            Number(fourth),
            split.slice(1).join('|')
          )
        )
      else {
        const date =
          id ??
          this.data
            .get(ctx.owner)
            .days.filter(day => !day.closed)
            .sort((a, b) => b.date.localeCompare(a.date))[0]?.date ??
          this.date(ctx)
        await this.preview(ctx, this.calendar.evening(ctx.owner, scope, date))
      }
      return
    }
    if (action === 'review') {
      const mission = this.studio.mission(ctx.owner, id!),
        step = mission.steps.at(-1)!
      if (
        !['done', 'paused'].includes(mission.state) ||
        step.kind !== 'local' ||
        !step.routine ||
        mission.thread !== ctx.thread ||
        mission.project !== scope.project
      )
        throw new UserError(
          'Choose a completed daily model workflow in its source conversation/project.'
        )
      const result = await this.executor.execute(
        ctx.owner,
        mission,
        step,
        AbortSignal.timeout(this.data.config.requestTimeoutMs)
      )
      await ctx.text(result.text)
      for (const file of result.files ?? [])
        await ctx.file(Buffer.from(file.data, 'base64'), file.name)
      return
    }
    if (action === 'remove') {
      this.calendar.remove(ctx.owner, id!)
      await ctx.text(
        'Retained day plan removed. Existing tasks and calendar events retain their current state.'
      )
      return
    }
    if (action === 'alerts') {
      if (id === 'clear')
        this.data.update(ctx.owner, state => {
          state.alerts = []
        })
      await ctx.text(JSON.stringify(this.data.get(ctx.owner).alerts, null, 2))
      return
    }
    if (action === 'export') {
      await ctx.file(
        Buffer.from(JSON.stringify(this.data.get(ctx.owner), null, 2)),
        'daily-routines.json'
      )
      return
    }
    throw new UserError('Unknown day action. Use /day.')
  }
  private async expense(
    ctx: RoutineContext,
    parts: string[],
    split: string[]
  ): Promise<void> {
    const [action, id, third, fourth, fifth] = parts,
      scope = this.scope(ctx)
    if (!action) {
      await ctx.text(
        `${this.finance.totals(ctx.owner, this.date(ctx).slice(0, 7))}\n${this.data
          .get(ctx.owner)
          .expenses.slice(-10)
          .map(
            item =>
              `${item.id} · ${item.date} · ${item.merchant} · ${item.kind} · ${money(item.currency, item.minor)}`
          )
          .join(
            '\n'
          )}\n/expense scan | focus (attach/reply to receipt); add | merchant | date | currency | decimal amount | category; correct TOKEN REVISION ROW FIELD | value; total YYYY-MM; remove ID; subscriptions; subscription add month|year | title | currency | decimal | next date; subscription paid ID DATE confirm; subscription on|off|remove ID; refund EXPENSE_ID EXPECTED_DATE [decimal]; refunds; received REFUND_ID DATE confirm; close REFUND_ID; export; clear confirm`
      )
      return
    }
    if (action === 'scan') {
      await this.studioCommands.show(
        ctx,
        this.plans.receipt(
          ctx.owner,
          ctx.thread,
          await ctx.materials(),
          split.slice(1).join('|')
        )
      )
      return
    }
    if (action === 'add') {
      await this.preview(
        ctx,
        this.finance.manual(
          ctx.owner,
          scope,
          split[1] ?? '',
          split[2] ?? '',
          split[3] ?? '',
          split[4] ?? '',
          split[5] ?? ''
        )
      )
      return
    }
    if (action === 'correct') {
      await this.preview(
        ctx,
        this.finance.correct(
          ctx.owner,
          scope,
          id!,
          Number(third),
          Number(fourth) - 1,
          fifth!,
          split.slice(1).join('|')
        )
      )
      return
    }
    if (action === 'total') {
      await ctx.text(
        this.finance.totals(ctx.owner, id ?? this.date(ctx).slice(0, 7))
      )
      return
    }
    if (action === 'remove') {
      this.finance.remove(ctx.owner, id!)
      await ctx.text('Expense removed.')
      return
    }
    if (action === 'clear') {
      if (id !== 'confirm')
        throw new UserError(
          'Export first, then /expense clear confirm removes the entire local ledger and refund history.'
        )
      this.finance.clear(ctx.owner)
      await ctx.text(
        'Financial ledger and refund history cleared. Subscription settings are retained.'
      )
      return
    }
    if (action === 'export') {
      const state = this.data.get(ctx.owner)
      await ctx.file(
        Buffer.from(
          JSON.stringify(
            {
              expenses: state.expenses,
              subscriptions: state.subscriptions,
              refunds: state.refunds
            },
            null,
            2
          )
        ),
        'expenses.json'
      )
      return
    }
    if (action === 'subscriptions') {
      await ctx.text(
        JSON.stringify(this.data.get(ctx.owner).subscriptions, null, 2)
      )
      return
    }
    if (action === 'subscription') {
      if (id === 'add') {
        const sub = this.finance.subscription(
          ctx.owner,
          split[1] ?? '',
          split[2] ?? '',
          split[3] ?? '',
          split[4] ?? '',
          third!
        )
        await ctx.text(
          `Subscription ${sub.id}: ${money(sub.currency, sub.minor)} next ${sub.next}. Reminders require no model; payments are recorded explicitly.`
        )
      } else if (id === 'paid') {
        const sub = this.data
          .get(ctx.owner)
          .subscriptions.find(item => item.id === third)
        if (!sub) throw new UserError('Subscription not found.')
        if (fifth !== 'confirm') {
          await ctx.text(
            `Record ${money(sub.currency, sub.minor)} for ${sub.title} on ${fourth}, then advance the recorded billing date ${sub.next}? /expense subscription paid ${third} ${fourth} confirm`
          )
          return
        }
        const expense = this.finance.paid(ctx.owner, third!, fourth!)
        await ctx.text(
          `Recorded payment ${expense.id}. No provider charge was requested.`
        )
      } else {
        this.finance.controlSubscription(ctx.owner, third!, id!)
        await ctx.text('Subscription setting updated.')
      }
      return
    }
    if (action === 'refund') {
      const refund = this.finance.refund(ctx.owner, id!, third!, fourth)
      await ctx.text(
        `Expected refund ${refund.id} recorded. /expense received ${refund.id} YYYY-MM-DD confirm records receipt explicitly.`
      )
      return
    }
    if (action === 'refunds') {
      await ctx.text(JSON.stringify(this.data.get(ctx.owner).refunds, null, 2))
      return
    }
    if (action === 'received') {
      const refund = this.data
        .get(ctx.owner)
        .refunds.find(item => item.id === id)
      if (!refund) throw new UserError('Refund not found.')
      if (fourth !== 'confirm') {
        await ctx.text(
          `Record receipt of refund ${refund.id}, ${refund.minor} original-currency minor units, on ${third}? /expense received ${id} ${third} confirm`
        )
        return
      }
      this.finance.receiveRefund(ctx.owner, id!, third!)
      await ctx.text('Refund receipt recorded.')
      return
    }
    if (action === 'close') {
      this.finance.closeRefund(ctx.owner, id!)
      await ctx.text('Expected refund closed without recording money movement.')
      return
    }
    throw new UserError('Unknown expense action. Use /expense.')
  }
  private async correspondence(
    ctx: RoutineContext,
    parts: string[],
    split: string[]
  ): Promise<void> {
    const [action, id, third] = parts
    if (!action) {
      await ctx.text(
        `${
          this.data
            .get(ctx.owner)
            .waiting.map(
              item =>
                `${item.id} · ${item.contact} · ${item.status} · check ${new Date(item.checkAt).toISOString()}`
            )
            .join('\n') || 'No waiting-for-reply records.'
        }\n/waiting add | contact | request | future local check date | optional sent local date (reply to exact source or select a Suite excerpt)\n/waiting show ID; bind ID CONNECTION | provider reference; check ID; draft ID | focus; send ID | focus; reply ID | copied response; snooze ID | future local date; close|remove ID`
      )
      return
    }
    if (action === 'add') {
      const quote = ctx.quote(),
        selected = this.suite.get(ctx.owner).selected[0],
        source = quote
          ? {
              id: routineHash(quote).slice(0, 20),
              title: 'Explicitly replied correspondence',
              text: quote.slice(0, 12000),
              thread: ctx.thread,
              project: this.scope(ctx).project
            }
          : selected
      if (!source)
        throw new UserError(
          'Reply to the original request or explicitly select its source excerpt.'
        )
      const item = this.waiting.add(
        ctx.owner,
        split[1] ?? '',
        split[2] ?? '',
        source,
        split[4]
          ? localTime(split[4], this.ws.get(ctx.owner).timezone, 0)
          : this.data.now(),
        this.time(ctx, split[3] ?? '')
      )
      await ctx.text(
        `Waiting record ${item.id} saved. A due notification asks you to review; external reads require a separate plan.`
      )
      return
    }
    if (action === 'show') {
      await ctx.file(
        Buffer.from(JSON.stringify(this.waiting.item(ctx.owner, id!), null, 2)),
        `waiting-${id}.json`
      )
      return
    }
    if (action === 'bind') {
      this.waiting.bind(ctx.owner, id!, third!, split[1] ?? '')
      await ctx.text('Explicit correspondence connection/reference saved.')
      return
    }
    if (action === 'check') {
      await this.studioCommands.show(
        ctx,
        this.plans.checkReply(ctx.owner, ctx.thread, id!)
      )
      return
    }
    if (action === 'draft' || action === 'send') {
      await this.studioCommands.show(
        ctx,
        this.plans.followup(
          ctx.owner,
          ctx.thread,
          id!,
          split.slice(1).join('|'),
          action === 'send'
        )
      )
      return
    }
    if (action === 'reply') {
      this.waiting.control(ctx.owner, id!, 'reply', split.slice(1).join('|'))
      await ctx.text('Explicit copied response recorded.')
      return
    }
    if (action === 'snooze') {
      this.waiting.control(
        ctx.owner,
        id!,
        'snooze',
        this.time(ctx, split[1] ?? '')
      )
      await ctx.text('Reply check deadline updated.')
      return
    }
    if (action === 'close' || action === 'remove') {
      this.waiting.control(ctx.owner, id!, action)
      await ctx.text('Waiting record updated.')
      return
    }
    throw new UserError('Unknown correspondence action. Use /waiting.')
  }
}
