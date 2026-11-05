import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interval, localTime } from '../scheduling.js'

void test('schedule intervals and local future times are validated without external services', () => {
  assert.equal(interval('2h'), 7200000)
  assert.equal(interval('1d'), 86400000)
  assert.equal(interval('30m'), 1800000)
  for (const value of ['0m', 'invalid', '366d', '999999999999999999999999h'])
    assert.throws(() => interval(value))
  const now = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(
    localTime('2026-11-05 12:30', 'Asia/Tbilisi', now),
    Date.parse('2026-11-05T08:30:00Z')
  )
  assert.equal(
    localTime('2026-11-05 12:30', 'Asia/Kathmandu', now),
    Date.parse('2026-11-05T06:45:00Z')
  )
  for (const [value, zone] of [
    ['bad', 'UTC'],
    ['2026-02-30 10:00', 'UTC'],
    ['2026-11-05 25:00', 'UTC'],
    ['2026-11-05 12:30', 'bad/zone'],
    ['2026-03-08 02:30', 'America/New_York'],
    ['2026-11-01 01:30', 'America/New_York'],
    ['2025-01-01 00:00', 'UTC']
  ])
    assert.throws(() => localTime(value!, zone!, now))
})
