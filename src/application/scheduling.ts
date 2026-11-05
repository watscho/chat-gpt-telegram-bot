import { UserError } from '../domain/conversation.js'

export function interval(value: string): number {
  const match = value.match(/^(\d+)(m|h|d)$/)
  if (!match) throw new UserError('Use an interval such as 30m, 2h or 1d.')
  const amount =
    Number(match[1]) * { m: 60000, h: 3600000, d: 86400000 }[match[2]!]!
  if (!Number.isSafeInteger(amount) || amount < 60000 || amount > 31536000000)
    throw new UserError('Interval must be between one minute and 365 days.')
  return amount
}
export function localTime(
  value: string,
  timezone: string,
  now: number
): number {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))
    throw new UserError('Use YYYY-MM-DD HH:MM in your configured timezone.')
  const [year, month, day, hour, minute] = value.split(/[- :]/).map(Number) as [
    number,
    number,
    number,
    number,
    number
  ]
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  const normalized = new Date(naive)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
  if (normalized !== value)
    throw new UserError('Invalid calendar date or time.')
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
  } catch {
    throw new UserError('Invalid IANA timezone.')
  }
  const matches: number[] = []
  // Enumerating possible quarter-hour UTC offsets detects DST gaps and ambiguity.
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = naive - offset * 60000
    const parts = Object.fromEntries(
      format.formatToParts(candidate).map(part => [part.type, part.value])
    )
    if (
      `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` ===
      value
    )
      matches.push(candidate)
  }
  if (matches.length !== 1)
    throw new UserError(
      'That local time is ambiguous or does not exist because of a clock change. Choose another time.'
    )
  if (matches[0]! <= now) throw new UserError('Choose a time in the future.')
  return matches[0]!
}
