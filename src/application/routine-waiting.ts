import { UserError } from '../domain/conversation.js'
import type { SourceQuote } from '../domain/suite.js'
import type { WaitingReply } from '../domain/routine.js'
import { Routines, routineId, type RoutineScope } from './routines.js'
import { routineHash, routineText } from './routine-rules.js'
export class RoutineWaiting {
  constructor(private readonly data: Routines) {}
  item(owner: string, id: string): WaitingReply {
    const item = this.data.get(owner).waiting.find(item => item.id === id)
    if (!item) throw new UserError('Waiting-for-reply record not found.')
    return item
  }
  add(
    owner: string,
    contact: string,
    request: string,
    source: SourceQuote,
    sentAt: number,
    checkAt: number
  ): WaitingReply {
    this.data.persistent()
    routineText(contact, 200)
    routineText(request, 2000)
    routineText(source.text, 12000)
    if (
      !Number.isFinite(sentAt) ||
      sentAt > this.data.now() ||
      !Number.isFinite(checkAt) ||
      checkAt <= this.data.now()
    )
      throw new UserError(
        'Use a past/current sent time and a future check deadline.'
      )
    const item: WaitingReply = {
      id: routineId(),
      contact: contact.trim(),
      request: request.trim(),
      source,
      sentAt,
      checkAt,
      status: 'waiting',
      connection: null,
      reference: '',
      revision: 1,
      checkedAt: 0,
      reply: '',
      replyAt: null
    }
    this.data.update(owner, state => {
      state.waiting.push(item)
    })
    return item
  }
  bind(owner: string, id: string, connection: string, reference: string): void {
    if (
      !this.data.config.workbench.connections.some(
        item =>
          item.owner === Number(owner.split(':')[0]) && item.id === connection
      )
    )
      throw new UserError(
        'Choose an owner-configured correspondence connection.'
      )
    routineText(reference, 300)
    this.data.update(owner, state => {
      const item = state.waiting.find(item => item.id === id)
      if (!item) throw new UserError('Waiting-for-reply record not found.')
      item.connection = connection
      item.reference = reference
      item.revision++
    })
  }
  control(
    owner: string,
    id: string,
    action: string,
    value: string | number = ''
  ): void {
    const original = this.item(owner, id)
    if (!['reply', 'close', 'remove', 'snooze'].includes(action))
      throw new UserError('Choose reply, close, remove or snooze.')
    if (action === 'reply') routineText(String(value), 6000)
    if (
      action === 'snooze' &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value <= this.data.now())
    )
      throw new UserError('Choose a future check time.')
    this.data.update(owner, state => {
      const item = state.waiting.find(item => item.id === original.id)!
      if (action === 'remove')
        state.waiting = state.waiting.filter(item => item.id !== id)
      else {
        item.revision++
        if (action === 'reply') {
          item.reply = String(value)
          item.replyAt = this.data.now()
          item.status = 'replied'
          item.checkedAt = this.data.now()
        } else if (action === 'close') item.status = 'closed'
        else {
          item.checkAt = value as number
          item.status = 'waiting'
        }
      }
    })
  }
  preview(
    owner: string,
    scope: RoutineScope,
    origin: string,
    id: string,
    revision: number,
    status: string,
    quote: string,
    evidence: string,
    replyAt: number | null
  ) {
    const item = this.item(owner, id)
    if (
      item.revision !== revision ||
      !['waiting', 'replied', 'unknown'].includes(status)
    )
      throw new UserError(
        'Waiting record changed or has an invalid reported status.'
      )
    if (
      status === 'replied' &&
      (!quote.trim() ||
        !evidence.includes(quote) ||
        replyAt === null ||
        !Number.isFinite(replyAt) ||
        replyAt <= Math.max(item.sentAt, item.replyAt ?? item.sentAt) ||
        replyAt > this.data.now() + 60000)
    )
      throw new UserError(
        'A proposed reply needs an exact quote and a valid timestamp after the latest recorded request/reply.'
      )
    return this.data.preview(
      owner,
      scope,
      'waiting',
      origin,
      routineHash(item),
      { id, status, quote, evidence: evidence.slice(0, 12000), replyAt }
    )
  }
  confirm(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number
  ): void {
    const pending = this.data.review(owner, scope, token, revision, 'waiting'),
      payload = JSON.parse(pending.payload) as {
        id: string
        status: string
        quote: string
        evidence: string
        replyAt: number | null
      }
    this.data.accept(
      owner,
      scope,
      token,
      revision,
      routineHash(this.item(owner, payload.id)),
      state => {
        const item = state.waiting.find(item => item.id === payload.id)!
        item.checkedAt = this.data.now()
        item.revision++
        if (payload.status === 'replied') {
          if (!payload.quote || !payload.evidence.includes(payload.quote))
            throw new UserError('Reply evidence changed.')
          item.status = 'replied'
          item.reply = payload.quote
          item.replyAt = payload.replyAt
        }
      }
    )
  }
}
