import type { SourceQuote } from './suite.js'
export type RoutineKind = 'calendar' | 'receipt' | 'cards' | 'waiting' | 'brief'
export interface RoutineSpec {
  kind: RoutineKind
  phase: 'compose' | 'apply'
  fields: string[]
  params: Record<string, string>
  model: string | null
}
export interface TimeBlock {
  start: number
  end: number
  title: string
}
export interface CalendarSnapshot {
  revision: number
  start: number
  end: number
  events: TimeBlock[]
  asOf: number
  source: string
  connection: string | null
}
export interface DaySlot extends TimeBlock {
  task: string
}
export interface DayPlan {
  id: string
  date: string
  revision: number
  calendar: number
  slots: DaySlot[]
  unscheduled: string[]
  notes: string
  closed: boolean
  outcomes: {
    task: string
    action: 'done' | 'keep' | 'carry' | 'cancel'
    dueAt: number | null
  }[]
}
export interface Expense {
  id: string
  date: string
  merchant: string
  currency: string
  minor: string
  category: string
  kind: 'charge' | 'refund'
  origin: string
  source: string
  original: string | null
}
export interface Subscription {
  id: string
  title: string
  currency: string
  minor: string
  next: string
  cadence: 'month' | 'year'
  anchor: number
  active: boolean
  revision: number
}
export interface Refund {
  id: string
  expense: string
  minor: string
  expected: string
  status: 'waiting' | 'received' | 'closed'
  revision: number
}
export interface ReviewCard {
  id: string
  front: string
  back: string
  source: SourceQuote
  dueAt: number
  level: number
  lapses: number
  reviews: number
  revision: number
  origin: string
}
export interface WaitingReply {
  id: string
  contact: string
  request: string
  source: SourceQuote
  sentAt: number
  checkAt: number
  status: 'waiting' | 'replied' | 'closed'
  connection: string | null
  reference: string
  revision: number
  checkedAt: number
  reply: string
  replyAt: number | null
}
export interface ReadingSource {
  id: string
  kind: 'rss' | 'page'
  url: string
  enabled: boolean
  interval: number
  nextAt: number
  revision: number
  error: string
}
export interface ReadingItem {
  id: string
  url: string
  title: string
  excerpt: string
  sources: string[]
  published: number | null
  discovered: number
  read: boolean
  saved: boolean
  hidden: boolean
}
export type HomeAction =
  'plan' | 'evening' | 'expense' | 'review' | 'waiting' | 'reading' | 'focus'
export interface RoutineReview {
  token: string
  revision: number
  thread: string
  project: string | null
  expiresAt: number
  kind: RoutineKind | 'plan' | 'evening'
  origin: string
  base: string
  payload: string
}
export interface RoutineState {
  revision: number
  connection: string | null
  calendar: CalendarSnapshot | null
  preferences: Record<string, { minutes: number; priority: number }>
  days: DayPlan[]
  expenses: Expense[]
  subscriptions: Subscription[]
  refunds: Refund[]
  cards: ReviewCard[]
  session: {
    token: string
    card: string
    revision: number
    thread: string
    project: string | null
    expiresAt: number
    revealed: boolean
  } | null
  waiting: WaitingReply[]
  sources: ReadingSource[]
  reading: ReadingItem[]
  topics: Record<string, number>
  hiddenTopics: string[]
  readingTime: string | null
  reviewTime: string | null
  shortcuts: HomeAction[]
  focus: {
    token: string
    task: string | null
    start: number
    end: number
  } | null
  pending: RoutineReview | null
  accepted: string[]
  claims: string[]
  seen: string[]
  alerts: { key: string; text: string; at: number; failed: boolean }[]
}
export interface ReadingEntry {
  url: string
  title: string
  excerpt: string
  published: number | null
}
export interface ReadingPorts {
  allowed(owner: string): boolean
  quiet(owner: string): boolean
  timezone(owner: string): string
  read(
    kind: 'rss' | 'page',
    url: string,
    signal: AbortSignal
  ): Promise<ReadingEntry[]>
  notify(owner: string, text: string): Promise<void>
}
