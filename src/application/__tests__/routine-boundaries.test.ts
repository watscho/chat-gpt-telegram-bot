import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  routineSetup,
  routineOwner as owner,
  routineScope as scope,
  routineSource
} from '../../__tests__/routines.js'
import {
  routineHash,
  freeWindows,
  daySlots,
  readingScore
} from '../routine-rules.js'
void test('routine capacities fail atomically and stale/duplicate acceptance cannot append records', () => {
  const s = routineSetup(),
    state = s.data.get(owner)
  for (const [field, length] of [
    ['days', 32],
    ['expenses', 501],
    ['subscriptions', 51],
    ['refunds', 101],
    ['cards', 201],
    ['waiting', 101],
    ['sources', 21],
    ['reading', 501],
    ['hiddenTopics', 21],
    ['claims', 1001],
    ['seen', 5001]
  ] as const)
    assert.throws(() =>
      s.data.update(owner, state => {
        ;(state[field] as unknown[]).length = length
      })
    )
  for (const field of ['preferences', 'topics'] as const)
    assert.throws(() =>
      s.data.update(owner, state => {
        state[field] = Object.fromEntries(
          Array.from({ length: field === 'preferences' ? 101 : 21 }, (_, i) => [
            i,
            0
          ])
        ) as never
      })
    )
  s.settings.maxJobBytes = 1
  assert.throws(() =>
    s.data.update(owner, state => {
      state.connection = 'changed'
    })
  )
  s.settings.maxJobBytes = 2000000
  assert.equal(s.data.get(owner).connection, null)
  const p = s.data.preview(owner, scope, 'cards', 'same', 'append', [])
  s.data.update(owner, state => {
    state.accepted.push('same')
  })
  assert.throws(() =>
    s.data.accept(owner, scope, p.token, 1, 'append', () => {})
  )
  assert.equal(s.data.get(owner).revision, state.revision + 2)
  s.settings.statePath = ':memory:'
  assert.throws(() => s.data.persistent())
})
void test('calendar boundaries invalidate stale sources, missing tasks, changed plans and expired carry deadlines', () => {
  const s = routineSetup(),
    task = s.task(),
    value = {
      start: s.now(),
      end: s.now() + 3600000,
      events: [],
      source: 'manual',
      asOf: s.now(),
      connection: null
    }
  assert.throws(() => s.calendar.connection(owner, 'bad'))
  assert.throws(() => s.calendar.plan(owner, scope, 'UTC'))
  for (const asOf of [s.now() + 1, s.now() - 900001])
    assert.throws(() =>
      s.calendar.preview(owner, scope, 'bad', { ...value, asOf })
    )
  assert.throws(() =>
    s.calendar.preview(owner, scope, 'bad', { ...value, connection: 'mail' })
  )
  for (const [minutes, priority] of [
    [NaN, 1],
    [0, 1],
    [481, 1],
    [1, NaN],
    [1, -1],
    [1, 10]
  ])
    assert.throws(() =>
      s.calendar.preference(owner, task.id, minutes!, priority!)
    )
  assert.throws(() => s.calendar.preference(owner, 'missing', 1, 1))
  let p = s.data.preview(owner, scope, 'cards', 'wrong', routineHash(null), {})
  assert.throws(() => s.calendar.confirmCalendar(owner, scope, p.token, 1))
  p = s.calendar.preview(owner, scope, 'manual', value)
  s.data.update(owner, state => {
    state.pending!.payload = JSON.stringify({ ...value, connection: 'mail' })
  })
  assert.throws(() => s.calendar.confirmCalendar(owner, scope, p.token, 1))
  s.data.update(owner, state => {
    state.pending!.payload = JSON.stringify({
      ...value,
      asOf: s.now() - 900001
    })
  })
  assert.throws(() => s.calendar.confirmCalendar(owner, scope, p.token, 1))
  s.available()
  s.time(s.now() + 900001)
  assert.throws(() => s.calendar.plan(owner, scope, 'UTC'))
  s.time(value.start)
  s.available()
  p = s.calendar.plan(owner, scope, 'UTC')
  s.calendar.confirmPlan(owner, scope, p.token, 1)
  p = s.calendar.plan(owner, scope, 'UTC')
  s.calendar.confirmPlan(owner, scope, p.token, 1)
  assert.equal(s.data.get(owner).days.length, 1)
  assert.equal(s.data.get(owner).days[0]!.revision, 2)
  s.workflow.task(owner, task.id, 'done')
  p = s.calendar.evening(owner, scope, '2027-01-15')
  assert.equal(
    (JSON.parse(p.payload) as import('../routine-calendar.js').EveningInput)
      .items[0]!.action,
    'done'
  )
  for (const [id, action, due] of [
    ['missing', 'done', null],
    [task.id, 'bad', null],
    [task.id, 'carry', null],
    [task.id, 'carry', NaN],
    [task.id, 'carry', s.now()]
  ] as const)
    assert.throws(() =>
      s.calendar.editEvening(owner, scope, p.token, 1, id, action, due)
    )
  p = s.calendar.editEvening(
    owner,
    scope,
    p.token,
    1,
    task.id,
    'carry',
    s.now() + 1000
  )
  s.time(s.now() + 1001)
  assert.throws(
    () => s.calendar.close(owner, scope, p.token, p.revision),
    /deadline/
  )
  s.time(value.start)
  p = s.calendar.evening(owner, scope, '2027-01-15')
  s.workflow.task(owner, task.id, 'open')
  assert.throws(
    () => s.calendar.close(owner, scope, p.token, 1),
    /Tasks or day/
  )
  p = s.calendar.evening(owner, scope, '2027-01-15')
  const flow = s.workflow.get(owner)
  flow.routineReceipts = [{ token: p.token, base: 'wrong' }]
  s.workflow.save(owner, flow)
  assert.throws(() => s.calendar.close(owner, scope, p.token, 1), /receipt/)
  p = s.calendar.evening(owner, scope, '2027-01-15')
  s.data.update(owner, state => {
    state.days[0]!.closed = true
  })
  assert.throws(() => s.calendar.close(owner, scope, p.token, 1))
  assert.throws(() => s.calendar.plan(owner, scope, 'UTC'))
  s.data.update(owner, state => {
    state.days[0]!.closed = false
  })
  s.workflow.task(owner, task.id, 'delete')
  p = s.calendar.evening(owner, scope, '2027-01-15')
  assert.deepEqual(
    (JSON.parse(p.payload) as import('../routine-calendar.js').EveningInput)
      .items,
    []
  )
  s.calendar.close(owner, scope, p.token, 1)
})
void test('financial boundary checks reject duplicate receipt hashes, invalid correction targets and unsafe refund mutations', () => {
  const s = routineSetup(),
    row = {
      merchant: 'Shop',
      date: '2027-01-15',
      currency: 'USD',
      minor: '100',
      category: 'Food',
      kind: 'charge' as const,
      source: 'sha256:one'
    }
  assert.throws(() => s.finance.validate({ ...row, kind: 'bad' as 'charge' }))
  assert.throws(() => s.finance.preview(owner, scope, 'empty', []))
  assert.throws(() =>
    s.finance.preview(
      owner,
      scope,
      'big',
      Array.from({ length: 21 }, () => row)
    )
  )
  assert.throws(() =>
    s.finance.preview(owner, scope, 'refund', [{ ...row, kind: 'refund' }])
  )
  let p = s.finance.preview(owner, scope, 'one', [row])
  assert.throws(() =>
    s.finance.correct(owner, scope, p.token, 1, 99, 'minor', '1')
  )
  assert.throws(() =>
    s.finance.correct(owner, scope, p.token, 1, 0, 'source', 'x')
  )
  s.finance.confirm(owner, scope, p.token, 1)
  assert.throws(() => s.finance.preview(owner, scope, 'two', [row]))
  assert.throws(() => s.finance.totals(owner, '2027-13'))
  assert.throws(() => s.finance.remove(owner, 'missing'))
  p = s.data.preview(
    owner,
    scope,
    'cards',
    'wrong',
    routineHash(s.data.get(owner).expenses),
    []
  )
  assert.throws(() => s.finance.confirm(owner, scope, p.token, 1))
  assert.throws(() =>
    s.finance.subscription(owner, 'Music', 'USD', '1', '2027-01-15', 'week')
  )
  assert.throws(() => s.finance.controlSubscription(owner, 'missing', 'on'))
  const sub = s.finance.subscription(
    owner,
    'Music',
    'USD',
    '1',
    '2027-01-15',
    'month'
  )
  assert.throws(() => s.finance.controlSubscription(owner, sub.id, 'bad'))
  assert.throws(() => s.finance.paid(owner, 'missing', '2027-01-15'))
  const expense = s.data.get(owner).expenses[0]!
  assert.throws(() => s.finance.refund(owner, 'missing', '2027-01-15'))
  assert.throws(() => s.finance.refund(owner, expense.id, '2027-01-15', '0'))
  const refund = s.finance.refund(owner, expense.id, '2027-01-15')
  s.finance.receiveRefund(owner, refund.id, '2027-01-15')
  assert.throws(() =>
    s.finance.remove(owner, s.data.get(owner).expenses.at(-1)!.id)
  )
  assert.throws(() => s.finance.closeRefund(owner, refund.id))
  assert.throws(() => s.finance.receiveRefund(owner, 'missing', '2027-01-15'))
  assert.throws(() => s.finance.closeRefund(owner, 'missing'))
  p = s.finance.manual(owner, scope, 'Other', '2027-01-15', 'EUR', '2', 'Food')
  s.finance.confirm(owner, scope, p.token, 1)
  assert.match(s.finance.totals(owner, '2027-01'), /EUR.*\nUSD/)
})
void test('learning scopes and expiry protect sessions and source cards; deterministic scheduler handles full windows and rank ties', () => {
  const s = routineSetup(),
    card = { front: 'Q', back: 'A', source: routineSource }
  assert.throws(() => s.learning.preview(owner, scope, 'none', []))
  assert.throws(() =>
    s.learning.preview(
      owner,
      scope,
      'many',
      Array.from({ length: 21 }, () => card)
    )
  )
  let p = s.data.preview(owner, scope, 'receipt', 'wrong', 'append', [])
  assert.throws(() => s.learning.confirm(owner, scope, p.token, 1))
  p = s.learning.preview(owner, scope, 'cards', [
    card,
    { ...card, front: 'Second' }
  ])
  s.learning.confirm(owner, scope, p.token, 1)
  let session = s.learning.next(owner, scope)!
  for (const wrong of [
    { thread: '2', project: null },
    { thread: '1', project: '2' }
  ])
    assert.throws(() => s.learning.reveal(owner, wrong, session.token))
  assert.throws(() => s.learning.reveal(owner, scope, 'wrong'))
  s.data.update(owner, state => {
    state.cards.find(card => card.id === session.card)!.revision++
  })
  assert.throws(() => s.learning.reveal(owner, scope, session.token))
  session = s.learning.next(owner, scope)!
  s.data.deleteThread(owner, '1')
  assert.equal(s.data.get(owner).session, null)
  session = s.learning.next(owner, scope)!
  s.time(s.now() + 600001)
  assert.equal(s.data.get(owner).session, null)
  session = s.learning.next(owner, scope)!
  s.learning.remove(owner, session.card)
  assert.equal(s.data.get(owner).session, null)
  session = s.learning.next(owner, scope)!
  s.data.update(owner, state => {
    state.cards = []
  })
  assert.throws(() => s.learning.reveal(owner, scope, session.token))
  const task = s.task(),
    other = s.task()
  s.workflow.task(owner, other.id, 'done')
  assert.deepEqual(
    daySlots(s.workflow.get(owner).tasks, {}, [], s.now()).unscheduled,
    [task.id]
  )
  assert.deepEqual(
    freeWindows(0, 100, [{ start: 0, end: 100, title: 'All busy' }]),
    []
  )
  const item = {
    id: 'item',
    url: 'https://example.com',
    sources: [],
    published: null,
    discovered: 0,
    saved: false,
    title: 'TypeScript',
    excerpt: 'notes',
    read: false,
    hidden: false
  }
  assert.equal(readingScore(item, {}, [])!.score, 0)
  assert.equal(readingScore({ ...item, hidden: true }, {}, []), null)
  assert.equal(readingScore(item, { absent: 1 }, [])!.score, 0)
})
void test('calendar acceptance rechecks preview kind, missing calendar and stale evidence, and cancellation removes only selected existing tasks', () => {
  const s = routineSetup(),
    task = s.task(),
    second = s.task('Keep'),
    third = s.task('Cancel')
  s.available()
  let p = s.calendar.plan(owner, scope, 'UTC')
  s.data.update(owner, state => {
    state.pending!.kind = 'cards'
  })
  assert.throws(
    () => s.calendar.confirmPlan(owner, scope, p.token, 1),
    /fresh day-plan/
  )
  p = s.calendar.plan(owner, scope, 'UTC')
  s.data.update(owner, state => {
    state.calendar!.asOf = s.now() - 900001
    state.pending!.base = routineHash({
      calendar: state.calendar,
      preferences: state.preferences,
      tasks: s.workflow.get(owner).tasks
    })
  })
  assert.throws(() => s.calendar.confirmPlan(owner, scope, p.token, 1))
  s.available()
  p = s.calendar.plan(owner, scope, 'UTC')
  s.data.update(owner, state => {
    state.calendar = null
    state.pending!.base = routineHash({
      calendar: null,
      preferences: state.preferences,
      tasks: s.workflow.get(owner).tasks
    })
  })
  assert.throws(() => s.calendar.confirmPlan(owner, scope, p.token, 1))
  s.available()
  p = s.calendar.plan(owner, scope, 'UTC')
  s.calendar.confirmPlan(owner, scope, p.token, 1)
  p = s.calendar.evening(owner, scope, '2027-01-15')
  p = s.calendar.editEvening(owner, scope, p.token, 1, third.id, 'cancel', null)
  s.calendar.close(owner, scope, p.token, p.revision)
  assert.deepEqual(
    new Set(s.workflow.get(owner).tasks.map(task => task.id)),
    new Set([task.id, second.id])
  )
  s.data.update(owner, state => {
    state.days = []
  })
  assert.throws(() => s.calendar.evening(owner, scope, '2027-01-15'))
})
void test('routine dispatch rejects unsupported acceptance and corrupted reply evidence without state changes', () => {
  const s = routineSetup(),
    item = s.waiting.add(
      owner,
      'Alice',
      'Request',
      routineSource,
      s.now() - 1000,
      s.now() + 1000
    )
  let p = s.waiting.preview(
    owner,
    scope,
    'reply',
    item.id,
    1,
    'replied',
    'Received',
    'Received',
    s.now()
  )
  s.data.update(owner, state => {
    const payload = JSON.parse(state.pending!.payload) as { evidence: string }
    payload.evidence = 'changed'
    state.pending!.payload = JSON.stringify(payload)
  })
  assert.throws(() => s.waiting.confirm(owner, scope, p.token, 1), /evidence/)
  p = s.waiting.preview(
    owner,
    scope,
    'reply2',
    item.id,
    1,
    'waiting',
    '',
    '',
    null
  )
  s.reviews.confirm(owner, scope, p.token, 1)
  assert.equal(s.waiting.item(owner, item.id).status, 'waiting')
  p = s.data.preview(owner, scope, 'brief', 'brief', 'base', {})
  assert.throws(() => s.reviews.confirm(owner, scope, p.token, 1))
  s.reviews.cancel(owner, scope, p.token, 1)
  const a = s.task('A', s.now() + 10000000),
    b = s.task('B', s.now() + 20000000),
    c = s.task('C')
  assert.equal(
    daySlots(
      [c, b, a],
      {},
      [{ start: s.now(), end: s.now() + 10000000, title: '' }],
      s.now()
    ).slots[0]!.task,
    a.id
  )
})
void test('grading one recall card preserves other retained cards and their progress', () => {
  const s = routineSetup(),
    p = s.learning.preview(owner, scope, 'cards', [
      { front: 'One', back: 'A', source: routineSource },
      { front: 'Two', back: 'B', source: routineSource }
    ])
  s.learning.confirm(owner, scope, p.token, 1)
  const session = s.learning.next(owner, scope)!
  s.learning.reveal(owner, scope, session.token)
  s.learning.grade(owner, scope, session.token, 'good')
  assert.equal(
    s.data.get(owner).cards.filter(card => card.reviews === 0).length,
    1
  )
})
