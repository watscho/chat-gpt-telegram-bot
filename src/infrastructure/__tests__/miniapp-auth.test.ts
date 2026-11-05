import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { miniAppOwner } from '../miniapp-auth.js'
function sign(fields: Record<string, string>, token = 'token'): string {
  const params = new URLSearchParams(fields),
    data = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')
  params.set(
    'hash',
    createHmac(
      'sha256',
      createHmac('sha256', 'WebAppData').update(token).digest()
    )
      .update(data)
      .digest('hex')
  )
  return params.toString()
}
void test('Mini App authentication verifies signed Telegram data, freshness, unique fields and allowlisted user ownership', () => {
  const now = 2000000000000,
    fields = {
      auth_date: String(now / 1000),
      query_id: 'query',
      user: JSON.stringify({ id: 42 })
    },
    allowed = new Set([42])
  assert.equal(miniAppOwner(sign(fields), 'token', allowed, now), '42:42')
  assert.throws(() => miniAppOwner('', 'token', allowed, now))
  assert.throws(() => miniAppOwner('x'.repeat(16001), 'token', allowed, now))
  for (const raw of [
    'hash=bad&auth_date=1',
    'hash=' + 'a'.repeat(64) + '&auth_date=bad',
    sign(fields) + '&query_id=duplicate',
    sign({ ...fields, auth_date: '9007199254740992' }),
    sign({ ...fields, auth_date: String(now / 1000 + 31) }),
    sign({ ...fields, auth_date: String(now / 1000 - 301) }),
    sign(fields, 'wrong'),
    sign({ ...fields, user: 'bad' }),
    sign({ ...fields, user: 'null' }),
    sign({ ...fields, user: '[]' }),
    sign({ ...fields, user: '{}' }),
    sign({ ...fields, user: '{"id":"42"}' }),
    sign({ ...fields, user: '{"id":1.5}' }),
    sign({ ...fields, user: '{"id":0}' }),
    sign({ ...fields, user: '{"id":99}' }),
    sign({ auth_date: String(now / 1000) })
  ])
    assert.throws(() => miniAppOwner(raw, 'token', allowed, now))
  assert.equal(
    miniAppOwner(
      sign({ ...fields, auth_date: String(now / 1000 - 500) }),
      'token',
      allowed,
      now,
      900
    ),
    '42:42'
  )
  assert.throws(() =>
    miniAppOwner('user={}&hash=' + 'a'.repeat(64), 'token', allowed, now)
  )
})
export { sign }
void test('signature validation sorts reverse ordered Telegram fields', () => {
  const now = 2000000000000
  assert.equal(
    miniAppOwner(
      sign({ user: '{"id":42}', query_id: 'q', auth_date: String(now / 1000) }),
      'token',
      new Set([42]),
      now
    ),
    '42:42'
  )
})
