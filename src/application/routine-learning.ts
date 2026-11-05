import { UserError } from '../domain/conversation.js'
import type { SourceQuote } from '../domain/suite.js'
import { Routines, routineId, type RoutineScope } from './routines.js'
import { clockTime, gradeCard, routineText } from './routine-rules.js'
export interface CardInput {
  front: string
  back: string
  source: SourceQuote
}
export class RoutineLearning {
  constructor(private readonly data: Routines) {}
  private validate(card: CardInput): void {
    routineText(card.front, 1000)
    routineText(card.back, 4000)
    routineText(card.source.id, 100)
    routineText(card.source.title, 200)
    routineText(card.source.text, 12000)
  }
  preview(
    owner: string,
    scope: RoutineScope,
    origin: string,
    cards: CardInput[]
  ) {
    if (!cards.length || cards.length > 20)
      throw new UserError('Review 1..20 learning cards at a time.')
    cards.forEach(card => this.validate(card))
    return this.data.preview(owner, scope, 'cards', origin, 'append', cards)
  }
  confirm(
    owner: string,
    scope: RoutineScope,
    token: string,
    revision: number
  ): void {
    this.data.accept(
      owner,
      scope,
      token,
      revision,
      'append',
      (state, pending) => {
        if (pending.kind !== 'cards')
          throw new UserError('Choose a learning-card review.')
        const cards = JSON.parse(pending.payload) as CardInput[]
        cards.forEach(card => this.validate(card))
        state.cards.push(
          ...cards.map((card, index) => ({
            ...card,
            id: routineId(),
            dueAt: this.data.now(),
            level: 0,
            lapses: 0,
            reviews: 0,
            revision: 1,
            origin: `${pending.origin}:${index}`
          }))
        )
      }
    )
  }
  next(owner: string, scope: RoutineScope) {
    const card = this.data
      .get(owner)
      .cards.filter(card => card.dueAt <= this.data.now())
      .sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id))[0]
    if (!card) return null
    const session = {
      ...scope,
      token: routineId(),
      card: card.id,
      revision: card.revision,
      expiresAt: this.data.now() + 600000,
      revealed: false
    }
    this.data.update(owner, state => {
      state.session = session
    })
    return { ...session, front: card.front, source: card.source.title }
  }
  private session(owner: string, scope: RoutineScope, token: string) {
    const state = this.data.get(owner),
      session = state.session,
      card = state.cards.find(card => card.id === session?.card)
    if (
      !session ||
      !card ||
      session.token !== token ||
      session.thread !== scope.thread ||
      session.project !== scope.project ||
      session.revision !== card.revision
    )
      throw new UserError(
        'Card review expired or changed. Open the next due card.'
      )
    return { session, card }
  }
  reveal(owner: string, scope: RoutineScope, token: string): string {
    const { session, card } = this.session(owner, scope, token)
    this.data.update(owner, state => {
      state.session = { ...session, revealed: true }
    })
    return card.back
  }
  grade(
    owner: string,
    scope: RoutineScope,
    token: string,
    grade: string
  ): void {
    const { session, card } = this.session(owner, scope, token)
    if (!session.revealed)
      throw new UserError('Reveal the answer before rating recall.')
    const updated = gradeCard(card, grade, this.data.now())
    this.data.update(owner, state => {
      state.cards = state.cards.map(item =>
        item.id === card.id ? updated : item
      )
      state.session = null
    })
  }
  notify(owner: string, time: string): void {
    this.data.persistent()
    const value = clockTime(time)
    this.data.update(owner, state => {
      state.reviewTime = value
    })
  }
  remove(owner: string, id: string): void {
    this.data.update(owner, state => {
      if (!state.cards.some(card => card.id === id))
        throw new UserError('Learning card not found.')
      state.cards = state.cards.filter(card => card.id !== id)
      if (state.session?.card === id) state.session = null
    })
  }
  progress(owner: string) {
    const cards = this.data.get(owner).cards
    return {
      cards: cards.length,
      due: cards.filter(card => card.dueAt <= this.data.now()).length,
      reviews: cards.reduce((sum, card) => sum + card.reviews, 0),
      lapses: cards.reduce((sum, card) => sum + card.lapses, 0)
    }
  }
}
