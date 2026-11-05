import type { ReadingPorts } from '../domain/routine.js'
import { Routines } from './routines.js'
import { RoutineReading } from './routine-reading.js'
import { localDate, money } from './routine-rules.js'
export class RoutineAlerts {
  private ticking = false
  constructor(
    private readonly data: Routines,
    private readonly ports: ReadingPorts,
    private readonly reading: RoutineReading
  ) {}
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const owner of this.data.owners()) {
        if (!this.ports.allowed(owner) || this.ports.quiet(owner)) continue
        const state = this.data.get(owner),
          timezone = this.ports.timezone(owner),
          date = localDate(this.data.now(), timezone),
          clock = new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
          }).format(this.data.now()),
          soon = new Date(`${date}T00:00:00Z`)
        soon.setUTCDate(soon.getUTCDate() + 3)
        const due: { key: string; text: string }[] = []
        for (const sub of state.subscriptions)
          if (sub.active && sub.next <= soon.toISOString().slice(0, 10))
            due.push({
              key: `subscription:${sub.id}:${sub.next}`,
              text: `Upcoming recorded subscription: ${sub.title} · ${money(sub.currency, sub.minor)} · ${sub.next}. Confirm payment manually; no charge was made.`
            })
        for (const refund of state.refunds)
          if (refund.status === 'waiting' && refund.expected <= date)
            due.push({
              key: `refund:${refund.id}:${refund.revision}`,
              text: `Expected refund ${refund.id} is due for review. /expense refunds`
            })
        for (const item of state.waiting)
          if (item.status === 'waiting' && item.checkAt <= this.data.now())
            due.push({
              key: `waiting:${item.id}:${item.checkAt}`,
              text: `Waiting for ${item.contact}: ${item.request}. /waiting check ${item.id} proposes a separately approved service read.`
            })
        if (state.focus && state.focus.end <= this.data.now())
          due.push({
            key: `focus:${state.focus.token}`,
            text: 'Focus timer finished. Review your progress in /home.'
          })
        const reviewKey = `review:${date}`,
          readingKey = `reading:${date}`,
          cards = state.cards.filter(
            card => card.dueAt <= this.data.now()
          ).length
        if (state.reviewTime && clock >= state.reviewTime && cards)
          due.push({
            key: reviewKey,
            text: `${cards} learning cards are due. /review next starts a free local recall session.`
          })
        const items = this.reading.top(owner)
        if (state.readingTime && clock >= state.readingTime && items.length)
          due.push({
            key: readingKey,
            text: `Selected reading · ${date}\n${items.map(item => `${item.title}\n${item.url}\n${item.reason}`).join('\n\n')}\n/reading opens local controls; a model brief requires a separate plan.`
          })
        const active = new Set([
          ...state.subscriptions
            .filter(item => item.active)
            .map(item => `subscription:${item.id}:${item.next}`),
          ...state.refunds
            .filter(item => item.status === 'waiting')
            .map(item => `refund:${item.id}:${item.revision}`),
          ...state.waiting
            .filter(item => item.status === 'waiting')
            .map(item => `waiting:${item.id}:${item.checkAt}`),
          reviewKey,
          readingKey,
          ...(state.focus ? [`focus:${state.focus.token}`] : [])
        ])
        if (state.claims.some(key => !active.has(key)))
          this.data.update(owner, state => {
            state.claims = state.claims.filter(key => active.has(key))
          })
        for (const item of due) {
          if (this.data.get(owner).claims.includes(item.key)) continue
          this.data.update(owner, state => {
            state.claims.push(item.key)
            state.alerts.push({ ...item, at: this.data.now(), failed: false })
          })
          try {
            await this.ports.notify(owner, item.text)
          } catch {
            if (this.data.get(owner).claims.includes(item.key))
              this.data.update(owner, state => {
                const alert = state.alerts.find(alert => alert.key === item.key)
                if (alert) alert.failed = true
              })
          }
        }
      }
    } finally {
      this.ticking = false
    }
  }
}
