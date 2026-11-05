import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  routineSetup,
  routineOwner as owner,
  routineScope as scope,
  routineSource
} from '../../__tests__/routines.js'
import { Routines } from '../routines.js'
import {
  canonicalReadingURL,
  clockTime,
  decimalAmount,
  freeWindows,
  gradeCard,
  localDate,
  minorAmount,
  money,
  nextCharge,
  routineDate,
  routineText
} from '../routine-rules.js'
void test('routine rules preserve exact currency arithmetic, calendar dates, free windows and independent local recall scheduling', () => {
  assert.equal(decimalAmount('USD', '12.3'), '1230')
  assert.equal(decimalAmount('JPY', '12'), '12')
  assert.equal(decimalAmount('KWD', '0.125'), '125')
  assert.equal(money('USD', '-5'), 'USD -0.05')
  assert.equal(money('JPY', '12'), 'JPY 12')
  assert.equal(minorAmount('EUR', '0001'), '1')
  for (const [currency, amount] of [
    ['USD', '1.001'],
    ['JPY', '1.0'],
    ['unknown', '1'],
    ['USD', '-1'],
    ['USD', '1e3']
  ])
    assert.throws(() => decimalAmount(currency!, amount!))
  for (const [currency, value] of [
    ['unknown', '1'],
    ['USD', '1.0'],
    ['USD', 'x'.repeat(15)]
  ])
    assert.throws(() => minorAmount(currency!, value!))
  assert.equal(nextCharge('2027-01-31', 'month', 31), '2027-02-28')
  assert.equal(nextCharge('2027-02-28', 'month', 31), '2027-03-31')
  assert.equal(nextCharge('2028-02-29', 'year', 29), '2029-02-28')
  for (const date of ['2027-02-30', 'bad', '2027-1-01'])
    assert.throws(() => routineDate(date))
  assert.equal(
    localDate(Date.parse('2027-01-15T22:00Z'), 'Asia/Tbilisi'),
    '2027-01-16'
  )
  assert.equal(clockTime('off'), null)
  assert.equal(clockTime('09:00'), '09:00')
  assert.throws(() => clockTime('25:00'))
  assert.throws(() => routineText(' '))
  assert.throws(() => routineText('long', 2))
  assert.deepEqual(
    freeWindows(100, 1000, [
      { start: 300, end: 500, title: 'One' },
      { start: 450, end: 700, title: 'Overlap' },
      { start: 0, end: 50, title: 'Before' },
      { start: 1001, end: 1200, title: 'After' }
    ]).map(block => [block.start, block.end]),
    [
      [100, 300],
      [700, 1000]
    ]
  )
  for (const [start, end, events] of [
    [NaN, 1000, []],
    [1, NaN, []],
    [10, 1, []],
    [0, 57600001, []],
    [0, 10, Array(201).fill({ start: 1, end: 2, title: '' })],
    [0, 10, [{ start: NaN, end: 2, title: '' }]],
    [0, 10, [{ start: 1, end: NaN, title: '' }]],
    [0, 10, [{ start: 2, end: 1, title: '' }]]
  ] as [number, number, import('../../domain/routine.js').TimeBlock[]][])
    assert.throws(() => freeWindows(start, end, events))
  assert.equal(
    canonicalReadingURL('https://example.com/a?utm_source=x&b=2&a=1#part'),
    'https://example.com/a?a=1&b=2'
  )
  for (const url of [
    'invalid',
    'http://example.com',
    'https://u:p@example.com',
    'https://example.com:8443',
    'https://example.com/' + 'x'.repeat(2050)
  ])
    assert.throws(() => canonicalReadingURL(url))
})
void test('routine state isolates owners, expires scopes and rejects stale tokens before atomic acceptance', () => {
  const s = routineSetup(),
    pending = s.data.preview(owner, scope, 'cards', 'origin', 'base', {
      cards: []
    })
  assert.equal(s.data.get('43:43').pending, null)
  for (const [wrongScope, token, revision, kind] of [
    [{ ...scope, thread: '2' }, pending.token, 1, undefined],
    [{ ...scope, project: '1' }, pending.token, 1, undefined],
    [scope, 'wrong', 1, undefined],
    [scope, pending.token, 2, undefined],
    [scope, pending.token, 1, 'calendar']
  ] as const)
    assert.throws(() => s.data.review(owner, wrongScope, token, revision, kind))
  assert.throws(() =>
    s.data.accept(owner, scope, pending.token, 1, 'changed', () => {})
  )
  const updated = s.data.replace(owner, scope, pending.token, 1, {
    cards: ['new']
  })
  assert.equal(updated.revision, 2)
  s.data.accept(owner, scope, pending.token, 2, 'base', state => {
    state.connection = 'chosen'
  })
  assert.equal(s.data.get(owner).connection, 'chosen')
  assert.throws(() =>
    s.data.preview(owner, scope, 'cards', 'origin', 'base', {})
  )
  assert.throws(() => s.data.review(owner, scope, pending.token, 2))
  s.data.preview(owner, scope, 'cards', 'next', 'base', {})
  s.time(s.now() + 600001)
  assert.equal(s.data.get(owner).pending, null)
  s.data.shortcuts(owner, ['review', 'reading', 'focus'])
  assert.deepEqual(s.data.get(owner).shortcuts, ['review', 'reading', 'focus'])
  for (const values of [
    [],
    ['plan', 'plan', 'focus'],
    ['plan', 'expense', 'bad']
  ])
    assert.throws(() => s.data.shortcuts(owner, values))
  s.data.focus(owner, null, 25)
  assert.throws(() => s.data.focus(owner, null, 25))
  s.data.stopFocus(owner)
  for (const minutes of [0, 181, 1.5])
    assert.throws(() => s.data.focus(owner, null, minutes))
  s.data.preview(owner, scope, 'plan', 'thread-source', 'base', {})
  s.data.deleteThread(owner, '2')
  assert.ok(s.data.get(owner).pending)
  s.data.deleteThread(owner, '1')
  assert.equal(s.data.get(owner).pending, null)
  assert.deepEqual(s.data.owners(), [owner])
  s.data.erase(owner)
  assert.equal(s.data.get(owner).connection, null)
  const local = new Routines(s.settings, undefined, s.now)
  assert.throws(() => local.persistent())
  local.update(owner, state => {
    state.connection = 'local'
  })
  assert.equal(local.get(owner).connection, 'local')
  assert.deepEqual(local.owners(), [owner])
  local.erase(owner)
})
void test('calendar planning respects busy intervals, deadlines and reviewed task revisions; evening recovery never repeats task effects', () => {
  const s = routineSetup(),
    first = s.task('Priority task'),
    second = s.task('Small task'),
    blocked = s.task('Cannot meet deadline', s.now() + 60000)
  s.calendar.preference(owner, first.id, 30, 9)
  s.calendar.preference(owner, second.id, 10, 1)
  s.available([
    { start: s.now() + 30 * 60000, end: s.now() + 90 * 60000, title: 'Meeting' }
  ])
  const preview = s.calendar.plan(owner, scope, 'UTC'),
    plan = s.calendar.confirmPlan(owner, scope, preview.token, 1)
  assert.equal(plan.slots[0]!.task, first.id)
  assert.equal(plan.slots[1]!.start, s.now() + 90 * 60000)
  assert.ok(plan.unscheduled.includes(blocked.id))
  let evening = s.calendar.evening(owner, scope, plan.date)
  evening = s.calendar.editEvening(
    owner,
    scope,
    evening.token,
    evening.revision,
    first.id,
    'done',
    null
  )
  evening = s.calendar.editEvening(
    owner,
    scope,
    evening.token,
    evening.revision,
    second.id,
    'carry',
    s.now() + 86400000
  )
  evening = s.calendar.noteEvening(
    owner,
    scope,
    evening.token,
    evening.revision,
    'Finished the important work'
  )
  const original = s.store.putRecord.bind(s.store)
  let fail = true
  s.store.putRecord = (kind, key, value) => {
    if (kind === 'routines' && fail) {
      fail = false
      throw new Error('Interrupted routine commit')
    }
    original(kind, key, value)
  }
  assert.throws(
    () => s.calendar.close(owner, scope, evening.token, evening.revision),
    /Interrupted/
  )
  assert.equal(
    s.workflow.get(owner).tasks.find(task => task.id === first.id)!.status,
    'done'
  )
  s.calendar.close(owner, scope, evening.token, evening.revision)
  assert.equal(s.data.get(owner).days[0]!.closed, true)
  assert.equal(s.workflow.get(owner).routineReceipts!.length, 1)
  assert.equal(s.workflow.get(owner).tasks.length, 3)
  assert.throws(() => s.calendar.evening(owner, scope, plan.date))
  s.calendar.remove(owner, plan.id)
  assert.throws(() => s.calendar.remove(owner, plan.id))
})
void test('expense previews keep integer totals separate by currency and subscriptions/refunds require explicit recorded actions', () => {
  const s = routineSetup()
  let pending = s.finance.manual(
    owner,
    scope,
    'Coffee',
    '2027-01-15',
    'USD',
    '12.30',
    'Food'
  )
  pending = s.finance.correct(
    owner,
    scope,
    pending.token,
    1,
    0,
    'minor',
    '1250'
  )
  const first = s.finance.confirm(
    owner,
    scope,
    pending.token,
    pending.revision
  )[0]!
  assert.equal(s.finance.totals(owner, '2027-01'), 'USD 12.50')
  const refund = s.finance.refund(owner, first.id, '2027-01-16', '2.50')
  assert.throws(() => s.finance.refund(owner, first.id, '2027-01-16', '11.00'))
  s.finance.receiveRefund(owner, refund.id, '2027-01-16')
  assert.equal(s.finance.totals(owner, '2027-01'), 'USD 10.00')
  assert.throws(() => s.finance.receiveRefund(owner, refund.id, '2027-01-16'))
  assert.throws(() => s.finance.remove(owner, first.id))
  const closed = s.finance.refund(owner, first.id, '2027-01-16', '1.00')
  s.finance.closeRefund(owner, closed.id)
  const sub = s.finance.subscription(
    owner,
    'Music',
    'EUR',
    '3.99',
    '2027-01-31',
    'month'
  )
  s.finance.paid(owner, sub.id, '2027-01-31')
  assert.equal(s.data.get(owner).subscriptions[0]!.next, '2027-02-28')
  assert.throws(() => s.finance.paid(owner, sub.id, '2027-01-31'))
  s.finance.controlSubscription(owner, sub.id, 'off')
  s.finance.controlSubscription(owner, sub.id, 'on')
  s.finance.controlSubscription(owner, sub.id, 'remove')
  assert.match(s.finance.totals(owner, '2028-01'), /No recorded/)
  s.finance.clear(owner)
  assert.equal(s.data.get(owner).expenses.length, 0)
})
void test('learning review hides answers until reveal and consumes each grade once with explicit source-bound accepted cards', () => {
  const s = routineSetup(),
    pending = s.learning.preview(owner, scope, 'cards', [
      {
        front: 'When is a claim stored?',
        back: 'Before its effect.',
        source: routineSource
      }
    ])
  s.learning.confirm(owner, scope, pending.token, 1)
  const session = s.learning.next(owner, scope)!
  assert.equal('back' in session, false)
  assert.throws(() => s.learning.grade(owner, scope, session.token, 'good'))
  assert.equal(
    s.learning.reveal(owner, scope, session.token),
    'Before its effect.'
  )
  s.learning.grade(owner, scope, session.token, 'good')
  assert.throws(() => s.learning.grade(owner, scope, session.token, 'good'))
  assert.equal(s.learning.next(owner, scope), null)
  assert.equal(s.learning.progress(owner).reviews, 1)
  const card = s.data.get(owner).cards[0]!
  for (const grade of ['again', 'hard', 'good', 'easy'])
    assert.ok(gradeCard(card, grade, s.now()).dueAt > s.now())
  assert.throws(() => gradeCard(card, 'unknown', s.now()))
  s.learning.notify(owner, '09:00')
  s.learning.notify(owner, 'off')
  s.learning.remove(owner, card.id)
  assert.throws(() => s.learning.remove(owner, card.id))
})
