import { UserError } from '../domain/conversation.js'
import { Routines, type RoutineScope } from './routines.js'
import { RoutineCalendar } from './routine-calendar.js'
import { RoutineFinance } from './routine-finance.js'
import { RoutineLearning } from './routine-learning.js'
import { RoutineWaiting } from './routine-waiting.js'
export class RoutineReviews {
  constructor(
    private readonly data: Routines,
    private readonly calendar: RoutineCalendar,
    private readonly finance: RoutineFinance,
    private readonly learning: RoutineLearning,
    private readonly waiting: RoutineWaiting
  ) {}
  confirm(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number
  ): void {
    const pending = this.data.review(owner, scope, token, revision)
    if (pending.kind === 'calendar')
      this.calendar.confirmCalendar(owner, scope, token, revision)
    else if (pending.kind === 'plan')
      this.calendar.confirmPlan(owner, scope, token, revision)
    else if (pending.kind === 'receipt')
      this.finance.confirm(owner, scope, token, revision)
    else if (pending.kind === 'cards')
      this.learning.confirm(owner, scope, token, revision)
    else if (pending.kind === 'waiting')
      this.waiting.confirm(owner, scope, token, revision)
    else if (pending.kind === 'evening')
      this.calendar.close(owner, scope, token, revision)
    else
      throw new UserError('This daily result has no local acceptance action.')
  }
  cancel(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number
  ): void {
    this.data.review(owner, scope, token, revision)
    this.data.update(owner, state => {
      state.pending = null
    })
  }
}
