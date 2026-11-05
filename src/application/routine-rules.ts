import { createHash } from 'node:crypto'
import { UserError } from '../domain/conversation.js'
import type {
  DaySlot,
  TimeBlock,
  ReviewCard,
  ReadingItem
} from '../domain/routine.js'
import type { Task } from '../domain/workflow.js'
export const routineHash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function routineText(value: string, max = 1000): string {
  if (!value.trim() || value.length > max)
    throw new UserError(`Use nonempty text within ${max} characters.`)
  return value.trim()
}
export function routineDate(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new UserError('Use a valid YYYY-MM-DD date.')
  return value
}
export function localDate(now: number, timezone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(now)
      .map(part => [part.type, part.value])
  )
  return `${p.year}-${p.month}-${p.day}`
}
export function clockTime(value: string): string | null {
  if (value === 'off') return null
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new UserError('Use HH:MM or off.')
  return value
}
export const currencyDigits: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  GEL: 2,
  JPY: 0,
  BHD: 3,
  KWD: 3
}
export function minorAmount(currency: string, value: string): string {
  if (!Object.hasOwn(currencyDigits, currency) || !/^\d{1,14}$/.test(value))
    throw new UserError(
      'Choose USD/EUR/GBP/GEL/JPY/BHD/KWD and a nonnegative integer minor-unit amount.'
    )
  return BigInt(value).toString()
}
export function decimalAmount(currency: string, value: string): string {
  const digits = currencyDigits[currency]
  if (
    digits === undefined ||
    !new RegExp(`^\\d{1,11}${digits ? `(?:\\.\\d{1,${digits}})?` : ''}$`).test(
      value
    )
  )
    throw new UserError(
      'Amount must use the chosen currency decimal precision.'
    )
  const [whole, fraction = ''] = value.split('.')
  return minorAmount(
    currency,
    `${whole}${fraction.padEnd(digits, '0')}`.replace(/^0+(?=\d)/, '')
  )
}
export function money(currency: string, minor: string): string {
  const digits = currencyDigits[currency]!
  const negative = minor.startsWith('-'),
    value = BigInt(minor)
      .toString()
      .replace('-', '')
      .padStart(digits + 1, '0')
  return `${currency} ${negative ? '-' : ''}${digits ? `${value.slice(0, -digits)}.${value.slice(-digits)}` : value}`
}
export function nextCharge(
  date: string,
  cadence: 'month' | 'year',
  anchor: number
): string {
  const value = new Date(`${routineDate(date)}T00:00:00Z`)
  const year = value.getUTCFullYear() + (cadence === 'year' ? 1 : 0),
    month = value.getUTCMonth() + (cadence === 'month' ? 1 : 0),
    last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(anchor, last)))
    .toISOString()
    .slice(0, 10)
}
export function freeWindows(
  start: number,
  end: number,
  busy: TimeBlock[]
): TimeBlock[] {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 57600000 ||
    busy.length > 200 ||
    busy.some(
      block =>
        !Number.isFinite(block.start) ||
        !Number.isFinite(block.end) ||
        block.end <= block.start
    )
  )
    throw new UserError(
      'Choose a valid window up to 16 hours and at most 200 finite event intervals.'
    )
  const result: TimeBlock[] = []
  let cursor = start
  for (const block of [...busy].sort((a, b) => a.start - b.start)) {
    const a = Math.max(start, block.start),
      b = Math.min(end, block.end)
    if (b <= cursor || a >= end) continue
    if (a > cursor) result.push({ start: cursor, end: a, title: 'Available' })
    cursor = Math.max(cursor, b)
  }
  if (cursor < end) result.push({ start: cursor, end, title: 'Available' })
  return result
}
export function daySlots(
  tasks: Task[],
  preferences: Record<string, { minutes: number; priority: number }>,
  windows: TimeBlock[],
  now: number
): { slots: DaySlot[]; unscheduled: string[] } {
  const free = windows.map(block => ({
      ...block,
      start: Math.max(now, block.start)
    })),
    slots: DaySlot[] = [],
    unscheduled: string[] = []
  const sorted = tasks
    .filter(task => task.status === 'open')
    .sort(
      (a, b) =>
        (preferences[b.id]?.priority ?? 0) -
          (preferences[a.id]?.priority ?? 0) ||
        (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
        a.id.localeCompare(b.id)
    )
  for (const task of sorted) {
    const duration = (preferences[task.id]?.minutes ?? 25) * 60000,
      window = free.find(
        block =>
          block.start + duration <= block.end &&
          (task.dueAt === null || block.start + duration <= task.dueAt)
      )
    if (!window) {
      unscheduled.push(task.id)
      continue
    }
    slots.push({
      task: task.id,
      title: task.title,
      start: window.start,
      end: window.start + duration
    })
    window.start += duration + 300000
  }
  return { slots, unscheduled }
}
export function gradeCard(
  card: ReviewCard,
  grade: string,
  now: number
): ReviewCard {
  if (!['again', 'hard', 'good', 'easy'].includes(grade))
    throw new UserError('Choose again, hard, good or easy.')
  const days = [1, 3, 7, 14, 30, 60],
    level =
      grade === 'again'
        ? 0
        : Math.min(
            6,
            card.level + (grade === 'easy' ? 2 : grade === 'good' ? 1 : 0)
          )
  return {
    ...card,
    level,
    lapses: card.lapses + (grade === 'again' ? 1 : 0),
    reviews: card.reviews + 1,
    revision: card.revision + 1,
    dueAt:
      now +
      (grade === 'again'
        ? 600000
        : grade === 'hard'
          ? 86400000
          : days[Math.max(0, level - 1)]! * 86400000)
  }
}
export function canonicalReadingURL(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new UserError('Choose a public HTTPS source URL.')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    value.length > 2048
  )
    throw new UserError(
      'Choose a public HTTPS source URL without credentials or custom ports.'
    )
  url.hash = ''
  for (const key of [...url.searchParams.keys()])
    if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  return url.href
}
export function readingScore(
  item: ReadingItem,
  topics: Record<string, number>,
  hidden: string[]
): { score: number; reason: string } | null {
  if (item.read || item.hidden) return null
  const text = `${item.title} ${item.excerpt}`.normalize('NFKC').toLowerCase()
  if (hidden.some(topic => text.includes(topic))) return null
  const matches = Object.entries(topics).filter(([topic]) =>
      text.includes(topic)
    ),
    score = matches.reduce((sum, [, weight]) => sum + weight, 0)
  return {
    score,
    reason: matches.length
      ? `Matched topics: ${matches.map(([topic]) => topic).join(', ')}`
      : 'Selected source; no topic match'
  }
}
