import { createHmac, timingSafeEqual } from 'node:crypto'
import { UserError } from '../domain/conversation.js'
export function miniAppOwner(
  raw: string,
  token: string,
  allowed: ReadonlySet<number>,
  now = Date.now(),
  maxAgeSeconds = 300
): string {
  if (!raw || raw.length > 16000)
    throw new UserError('Open this screen from the Telegram bot.')
  const params = new URLSearchParams(raw),
    keys = [...params.keys()]
  if (new Set(keys).size !== keys.length)
    throw new UserError('Invalid Telegram authorization.')
  const hash = params.get('hash') ?? '',
    date = params.get('auth_date') ?? ''
  if (!/^[a-f0-9]{64}$/.test(hash) || !/^\d+$/.test(date))
    throw new UserError('Invalid Telegram authorization.')
  const instant = Number(date)
  if (
    !Number.isSafeInteger(instant) ||
    instant * 1000 > now + 30000 ||
    instant * 1000 < now - maxAgeSeconds * 1000
  )
    throw new UserError(
      'Telegram authorization expired. Reopen this screen from the bot.'
    )
  params.delete('hash')
  const data = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  const expected = createHmac('sha256', secret).update(data).digest()
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex')))
    throw new UserError('Invalid Telegram authorization.')
  let user: unknown
  try {
    user = JSON.parse(params.get('user') ?? 'null')
  } catch {
    throw new UserError('Invalid Telegram user.')
  }
  if (
    !user ||
    typeof user !== 'object' ||
    Array.isArray(user) ||
    !('id' in user) ||
    typeof user.id !== 'number' ||
    !Number.isSafeInteger(user.id) ||
    user.id < 1 ||
    !allowed.has(user.id)
  )
    throw new UserError('This user is not allowed to use the assistant.')
  return `${user.id}:${user.id}`
}
