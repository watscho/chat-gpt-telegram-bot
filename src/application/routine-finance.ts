import { UserError } from '../domain/conversation.js'
import type { Expense, Subscription, Refund } from '../domain/routine.js'
import { Routines, routineId, type RoutineScope } from './routines.js'
import {
  decimalAmount,
  minorAmount,
  money,
  nextCharge,
  routineDate,
  routineHash,
  routineText
} from './routine-rules.js'
export type ExpenseInput = Pick<
  Expense,
  'date' | 'merchant' | 'currency' | 'minor' | 'category' | 'kind' | 'source'
>
export class RoutineFinance {
  constructor(private readonly data: Routines) {}
  validate(value: ExpenseInput): ExpenseInput {
    routineDate(value.date)
    routineText(value.merchant, 200)
    routineText(value.category, 100)
    routineText(value.source, 300)
    minorAmount(value.currency, value.minor)
    if (!['charge', 'refund'].includes(value.kind))
      throw new UserError('Choose a charge or a reviewed linked refund.')
    return value
  }
  preview(
    owner: string,
    scope: RoutineScope,
    origin: string,
    rows: ExpenseInput[]
  ) {
    if (
      !rows.length ||
      rows.length > 20 ||
      rows.some(row => row.kind !== 'charge')
    )
      throw new UserError(
        'Review 1..20 receipt charges; use explicit linked-refund controls for refunds.'
      )
    rows.forEach(row => this.validate(row))
    const state = this.data.get(owner)
    if (
      state.expenses.some(item =>
        rows.some(
          row => item.source === row.source && row.source.startsWith('sha256:')
        )
      )
    )
      throw new UserError(
        'This exact receipt source was already recorded. Inspect the existing charge.'
      )
    return this.data.preview(
      owner,
      scope,
      'receipt',
      origin,
      routineHash(state.expenses),
      rows
    )
  }
  confirm(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number
  ): Expense[] {
    const existing = this.data.get(owner).expenses
    const state = this.data.accept(
      owner,
      scope,
      token,
      revision,
      routineHash(existing),
      (state, pending) => {
        if (pending.kind !== 'receipt')
          throw new UserError('Choose a receipt review.')
        const rows = JSON.parse(pending.payload) as ExpenseInput[]
        rows.forEach(row => this.validate(row))
        state.expenses.push(
          ...rows.map((row, index) => ({
            ...row,
            id: routineId(),
            origin: `${pending.origin}:${index}`,
            original: null
          }))
        )
      }
    )
    return state.expenses.filter(
      item => !existing.some(old => old.id === item.id)
    )
  }
  correct(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number,
    index: number,
    field: string,
    value: string
  ) {
    const pending = this.data.review(owner, scope, token, revision, 'receipt'),
      rows = JSON.parse(pending.payload) as ExpenseInput[],
      row = rows[index]
    if (
      !row ||
      !['merchant', 'date', 'currency', 'minor', 'category'].includes(field)
    )
      throw new UserError(
        'Choose a receipt row and merchant, date, currency, minor or category.'
      )
    const corrected = { ...row, [field]: value.trim() }
    this.validate(corrected)
    rows[index] = corrected
    return this.data.replace(owner, scope, token, revision, rows)
  }
  clear(owner: string): void {
    this.data.update(owner, state => {
      state.expenses = []
      state.refunds = []
    })
  }
  manual(
    owner: string,
    scope: RoutineScope,
    merchant: string,
    date: string,
    currency: string,
    amount: string,
    category: string
  ) {
    return this.preview(owner, scope, `manual:${routineId()}`, [
      {
        merchant: merchant.trim(),
        date,
        currency,
        minor: decimalAmount(currency, amount),
        category: category.trim(),
        kind: 'charge',
        source: 'Explicit manual entry'
      }
    ])
  }
  totals(owner: string, month: string): string {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new UserError('Use YYYY-MM for a monthly expense summary.')
    const amounts = new Map<string, bigint>()
    for (const expense of this.data
      .get(owner)
      .expenses.filter(item => item.date.startsWith(month)))
      amounts.set(
        expense.currency,
        (amounts.get(expense.currency) ?? 0n) +
          (expense.kind === 'refund' ? -1n : 1n) * BigInt(expense.minor)
      )
    return (
      [...amounts]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, minor]) => money(currency, minor.toString()))
        .join('\n') || 'No recorded expenses for this month.'
    )
  }
  remove(owner: string, id: string): void {
    this.data.update(owner, state => {
      if (!state.expenses.some(item => item.id === id))
        throw new UserError('Expense not found.')
      if (state.expenses.find(item => item.id === id)!.kind === 'refund')
        throw new UserError(
          'A recorded refund is linked evidence. Export/clear the ledger explicitly to remove the full financial history.'
        )
      if (
        state.refunds.some(item => item.expense === id) ||
        state.expenses.some(item => item.original === id)
      )
        throw new UserError(
          'Resolve/remove linked refund records before deleting the original charge.'
        )
      state.expenses = state.expenses.filter(item => item.id !== id)
    })
  }
  subscription(
    owner: string,
    title: string,
    currency: string,
    amount: string,
    next: string,
    cadence: string
  ): Subscription {
    this.data.persistent()
    routineText(title, 200)
    routineDate(next)
    if (!['month', 'year'].includes(cadence))
      throw new UserError('Choose month or year billing cadence.')
    const value: Subscription = {
      id: routineId(),
      title: title.trim(),
      currency,
      minor: decimalAmount(currency, amount),
      next,
      cadence: cadence as 'month' | 'year',
      anchor: Number(next.slice(8)),
      active: true,
      revision: 1
    }
    this.data.update(owner, state => {
      state.subscriptions.push(value)
    })
    return value
  }
  controlSubscription(owner: string, id: string, action: string): void {
    this.data.update(owner, state => {
      const item = state.subscriptions.find(item => item.id === id)
      if (!item || !['on', 'off', 'remove'].includes(action))
        throw new UserError(
          'Choose an existing subscription and on, off or remove.'
        )
      if (action === 'remove')
        state.subscriptions = state.subscriptions.filter(item => item.id !== id)
      else {
        item.active = action === 'on'
        item.revision++
      }
    })
  }
  paid(owner: string, id: string, date: string): Expense {
    routineDate(date)
    let result!: Expense
    this.data.update(owner, state => {
      const sub = state.subscriptions.find(item => item.id === id)
      if (!sub) throw new UserError('Subscription not found.')
      const origin = `subscription:${id}:${date}`
      if (state.expenses.some(item => item.origin === origin))
        throw new UserError(
          'This subscription payment date was already recorded.'
        )
      result = {
        id: routineId(),
        date,
        merchant: sub.title,
        currency: sub.currency,
        minor: sub.minor,
        category: 'subscription',
        kind: 'charge',
        source: `Explicit subscription payment ${id}`,
        origin,
        original: null
      }
      state.expenses.push(result)
      sub.next = nextCharge(sub.next, sub.cadence, sub.anchor)
      sub.revision++
    })
    return result
  }
  refund(
    owner: string,
    expenseId: string,
    expected: string,
    amount?: string
  ): Refund {
    routineDate(expected)
    this.data.persistent()
    let refund!: Refund
    this.data.update(owner, state => {
      const original = state.expenses.find(
        item => item.id === expenseId && item.kind === 'charge'
      )
      if (!original)
        throw new UserError('Choose an existing charge for the refund.')
      const minor =
        amount === undefined
          ? original.minor
          : decimalAmount(original.currency, amount)
      const assigned = state.refunds
        .filter(item => item.expense === expenseId && item.status !== 'closed')
        .reduce((sum, item) => sum + BigInt(item.minor), 0n)
      if (
        BigInt(minor) <= 0n ||
        assigned + BigInt(minor) > BigInt(original.minor)
      )
        throw new UserError(
          'Refunds must be positive and cannot exceed the original charge.'
        )
      refund = {
        id: routineId(),
        expense: expenseId,
        minor,
        expected,
        status: 'waiting',
        revision: 1
      }
      state.refunds.push(refund)
    })
    return refund
  }
  receiveRefund(owner: string, id: string, date: string): void {
    routineDate(date)
    this.data.update(owner, state => {
      const refund = state.refunds.find(item => item.id === id)
      if (!refund || refund.status !== 'waiting')
        throw new UserError('Choose a waiting refund.')
      const expense = state.expenses.find(item => item.id === refund.expense)!
      state.expenses.push({
        ...expense,
        id: routineId(),
        date,
        minor: refund.minor,
        kind: 'refund',
        original: expense.id,
        origin: `refund:${id}`,
        source: `Explicit received refund ${id}`
      })
      refund.status = 'received'
      refund.revision++
    })
  }
  closeRefund(owner: string, id: string): void {
    this.data.update(owner, state => {
      const refund = state.refunds.find(item => item.id === id)
      if (!refund || refund.status !== 'waiting')
        throw new UserError('Choose a waiting refund.')
      refund.status = 'closed'
      refund.revision++
    })
  }
}
