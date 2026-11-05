import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  routineSetup,
  routineOwner as owner,
  routineScope as scope,
  routineSource
} from '../../__tests__/routines.js'
void test('reply tracking requires owned bindings, fresh evidence and exact reviewed status; snoozing cannot reuse an old reply', () => {
  const s = routineSetup(),
    item = s.waiting.add(
      owner,
      'Alice',
      'Please review',
      routineSource,
      s.now() - 1000,
      s.now() + 60000
    )
  for (const [sent, check] of [
    [NaN, s.now() + 1],
    [s.now() + 1, s.now() + 2],
    [s.now(), NaN],
    [s.now(), s.now()]
  ])
    assert.throws(() =>
      s.waiting.add(owner, 'Alice', 'Request', routineSource, sent!, check!)
    )
  assert.throws(() => s.waiting.item('43:43', item.id))
  assert.throws(() => s.waiting.bind(owner, item.id, 'other', 'thread'))
  assert.throws(() => s.waiting.bind(owner, 'missing', 'mail', 'thread'))
  s.waiting.bind(owner, item.id, 'mail', 'thread')
  assert.throws(() => s.waiting.control(owner, item.id, 'bad'))
  for (const value of ['', NaN, s.now()])
    assert.throws(() => s.waiting.control(owner, item.id, 'snooze', value))
  assert.throws(() => s.waiting.control(owner, item.id, 'reply', ''))
  const current = s.waiting.item(owner, item.id)
  for (const [revision, status, quote, evidence, date] of [
    [999, 'waiting', '', '', null],
    [current.revision, 'bad', '', '', null],
    [current.revision, 'replied', '', '', s.now()],
    [current.revision, 'replied', 'quote', 'other', s.now()],
    [current.revision, 'replied', 'quote', 'quote', null],
    [current.revision, 'replied', 'quote', 'quote', NaN],
    [current.revision, 'replied', 'quote', 'quote', s.now() - 2000],
    [current.revision, 'replied', 'quote', 'quote', s.now() + 60001]
  ] as const)
    assert.throws(() =>
      s.waiting.preview(
        owner,
        scope,
        'bad',
        item.id,
        revision,
        status,
        quote,
        evidence,
        date
      )
    )
  for (const status of ['unknown', 'waiting', 'replied']) {
    const next = s.waiting.item(owner, item.id),
      pending = s.waiting.preview(
        owner,
        scope,
        status,
        item.id,
        next.revision,
        status,
        'Received',
        'Received',
        s.now()
      )
    s.waiting.confirm(owner, scope, pending.token, 1)
  }
  assert.equal(s.waiting.item(owner, item.id).status, 'replied')
  s.waiting.control(owner, item.id, 'snooze', s.now() + 120000)
  const next = s.waiting.item(owner, item.id)
  assert.throws(() =>
    s.waiting.preview(
      owner,
      scope,
      'old',
      item.id,
      next.revision,
      'replied',
      'Received',
      'Received',
      s.now()
    )
  )
  s.waiting.control(owner, item.id, 'reply', 'Thanks')
  s.waiting.control(owner, item.id, 'close')
  s.waiting.control(owner, item.id, 'remove')
  assert.equal(s.data.get(owner).waiting.length, 0)
})
void test('reading subscriptions deduplicate canonical links, attribute sources and keep local preferences and bookmark feedback', async () => {
  const s = routineSetup(),
    first = s.reading.add(owner, 'rss', 'https://example.com/feed', 1),
    second = s.reading.add(owner, 'page', 'https://example.com/page', 2)
  for (const [kind, hours] of [
    ['bad', 1],
    ['rss', 0],
    ['rss', 169],
    ['rss', 1.5]
  ] as const)
    assert.throws(() =>
      s.reading.add(owner, kind, 'https://example.com/other', hours)
    )
  assert.throws(() =>
    s.reading.add(owner, 'rss', 'https://example.com/feed?utm_source=x', 1)
  )
  await s.reading.check(owner, first.id)
  await s.reading.check(owner, second.id)
  const item = s.reading.top(owner)[0]!
  assert.deepEqual(new Set(item.sources), new Set([first.id, second.id]))
  s.reading.topic(owner, 'TypeScript', 3)
  assert.equal(s.reading.top(owner)[0]!.score, 3)
  s.reading.feedback(owner, item.id, 'TypeScript', 'more')
  s.reading.feedback(owner, item.id, 'TypeScript', 'less')
  assert.throws(() => s.reading.feedback(owner, item.id, 'absent', 'more'))
  assert.throws(() => s.reading.feedback(owner, item.id, 'TypeScript', 'bad'))
  for (const topic of ['constructor', 'prototype', '__proto__'])
    assert.throws(() => s.reading.topic(owner, topic, 1))
  for (const weight of [-6, 6, NaN, 1.5])
    assert.throws(() => s.reading.topic(owner, 'x', weight))
  s.reading.topic(owner, 'TypeScript', 'hide')
  assert.equal(s.reading.top(owner).length, 0)
  s.reading.topic(owner, 'TypeScript', 'show')
  s.reading.topic(owner, 'TypeScript', 0)
  s.reading.mark(owner, item.id, 'read')
  assert.equal(s.reading.top(owner).length, 0)
  s.reading.mark(owner, item.id, 'unread')
  s.reading.mark(owner, item.id, 'save')
  s.reading.mark(owner, item.id, 'hide')
  assert.equal(s.data.get(owner).reading[0]!.saved, true)
  assert.throws(() => s.reading.mark(owner, item.id, 'bad'))
  assert.throws(() => s.reading.item(owner, 'missing'))
  s.reading.delivery(owner, '08:00')
  s.reading.delivery(owner, 'off')
  s.reading.control(owner, first.id, 'off')
  await s.reading.check(owner, first.id)
  s.reading.control(owner, first.id, 'on')
  s.reading.control(owner, first.id, 'remove')
  s.reading.control(owner, second.id, 'remove')
  assert.equal(s.data.get(owner).reading.length, 1)
  assert.throws(() => s.reading.control(owner, 'missing', 'off'))
  assert.throws(() => s.reading.control(owner, item.id, 'bad'))
  await assert.rejects(s.reading.check(owner, 'missing'))
  s.reading.stop()
  s.reading.erase(owner)
})
void test('reading workers bound results, sanitize failures and abort in-flight source removal and owner erasure', async () => {
  const s = routineSetup(),
    source = s.reading.add(owner, 'rss', 'https://example.com/feed', 1)
  for (const entries of [
    Array.from({ length: 101 }, () => ({
      url: 'https://example.com',
      title: 'x',
      excerpt: '',
      published: null
    })),
    [{ url: 'https://example.com', title: '', excerpt: '', published: null }],
    [
      {
        url: 'https://example.com',
        title: 'x'.repeat(201),
        excerpt: '',
        published: null
      }
    ],
    [
      {
        url: 'https://example.com',
        title: 'x',
        excerpt: 'x'.repeat(2001),
        published: null
      }
    ],
    [{ url: 'https://example.com', title: 'x', excerpt: '', published: NaN }]
  ]) {
    s.readingPorts.read = () => Promise.resolve(entries)
    await s.reading.check(owner, source.id)
    assert.match(s.data.get(owner).sources[0]!.error, /bounded/)
  }
  s.readingPorts.read = () => Promise.reject(new Error('secret'))
  await s.reading.check(owner, source.id)
  assert.doesNotMatch(s.data.get(owner).sources[0]!.error, /secret/)
  let resolve!: (entries: []) => void
  s.readingPorts.read = () =>
    new Promise(done => {
      resolve = done
    })
  const pending = s.reading.check(owner, source.id)
  await s.reading.check(owner, source.id)
  s.reading.control(owner, source.id, 'off')
  resolve([])
  await pending
  s.reading.control(owner, source.id, 'on')
  const tick = s.reading.tick()
  await s.reading.tick()
  s.reading.erase('43:43')
  s.reading.erase(owner)
  s.data.erase(owner)
  resolve([])
  await tick
  assert.equal(s.data.get(owner).sources.length, 0)
  await s.reading.tick()
})
void test('daily reminders claim before delivery, honor quiet hours and never retry unknown notifications', async () => {
  const s = routineSetup()
  s.finance.subscription(owner, 'Soon', 'USD', '1.00', '2027-01-15', 'month')
  s.finance.subscription(owner, 'Later', 'USD', '1.00', '2028-01-15', 'month')
  const off = s.finance.subscription(
    owner,
    'Off',
    'USD',
    '1.00',
    '2027-01-15',
    'month'
  )
  s.finance.controlSubscription(owner, off.id, 'off')
  const pending = s.finance.manual(
      owner,
      scope,
      'Shop',
      '2027-01-15',
      'USD',
      '2.00',
      'Food'
    ),
    expense = s.finance.confirm(owner, scope, pending.token, 1)[0]!
  s.finance.refund(owner, expense.id, '2027-01-15', '1.00')
  s.waiting.add(
    owner,
    'Alice',
    'Review',
    routineSource,
    s.now() - 1000,
    s.now() + 1000
  )
  const cards = s.learning.preview(owner, scope, 'cards', [
    { front: 'Q', back: 'A', source: routineSource }
  ])
  s.learning.confirm(owner, scope, cards.token, 1)
  s.learning.notify(owner, '08:00')
  const source = s.reading.add(owner, 'rss', 'https://example.com/feed', 1)
  await s.reading.check(owner, source.id)
  s.reading.delivery(owner, '08:00')
  s.data.focus(owner, null, 1)
  s.time(s.now() + 60001)
  s.data.update(owner, state => {
    state.claims.push('obsolete')
  })
  s.readingPorts.allowed = () => false
  await s.alerts.tick()
  assert.equal(s.notices.length, 0)
  s.readingPorts.allowed = () => true
  s.readingPorts.quiet = () => true
  await s.alerts.tick()
  assert.equal(s.notices.length, 0)
  s.readingPorts.quiet = () => false
  await s.alerts.tick()
  assert.equal(s.notices.length, 6)
  await s.alerts.tick()
  assert.equal(s.notices.length, 6)
  s.data.stopFocus(owner)
  s.data.focus(owner, null, 1)
  s.time(s.now() + 60001)
  let reject!: () => void
  s.readingPorts.notify = () =>
    new Promise((_ok, no) => {
      reject = () => no(new Error('transport'))
    })
  const tick = s.alerts.tick()
  await s.alerts.tick()
  reject()
  await tick
  assert.equal(s.data.get(owner).alerts.at(-1)!.failed, true)
  await s.alerts.tick()
})
void test('reading retains bounded unseen identity, prunes only disposable entries, and ignores superseded reads', async () => {
  const s = routineSetup(),
    source = s.reading.add(owner, 'rss', 'https://example.com/feed', 1),
    other = s.reading.add(owner, 'rss', 'https://example.com/other', 2)
  const entry = (i: number) => ({
    url: `https://example.com/${i}`,
    title: 'TypeScript ' + i,
    excerpt: 'Notes',
    published: null
  })
  s.readingPorts.read = () =>
    Promise.resolve([entry(1), { ...entry(2), published: s.now() + 86400001 }])
  await s.reading.check(owner, source.id)
  const items = s.data.get(owner).reading
  assert.equal(items[1]!.published, null)
  s.reading.feedback(owner, items[0]!.id, 'notes', 'more')
  s.data.update(owner, state => {
    state.reading = state.reading.filter(item => item.id !== items[1]!.id)
  })
  await s.reading.check(owner, source.id)
  assert.equal(s.data.get(owner).reading.length, 1)
  const first = s.data.get(owner).reading[0]!
  s.data.update(owner, state => {
    state.reading = Array.from({ length: 500 }, (_, i) => ({
      ...first,
      id: String(i),
      url: `https://example.com/old${i}`,
      read: false,
      saved: false,
      published: i % 2 === 0 ? s.now() : null,
      discovered: s.now()
    }))
  })
  s.readingPorts.read = () => Promise.resolve([entry(3)])
  await s.reading.check(owner, source.id)
  assert.match(s.data.get(owner).sources[0]!.error, /capacity/)
  s.data.update(owner, state => {
    state.reading[0]!.read = true
    state.reading[1]!.hidden = true
    state.reading[1]!.saved = true
  })
  await s.reading.check(owner, source.id)
  assert.equal(s.data.get(owner).reading.length, 500)
  assert.ok(s.data.get(owner).reading.some(item => item.url.endsWith('/3')))
  s.reading.top(owner, 500)
  let resolve!: (value: []) => void
  s.readingPorts.read = () =>
    new Promise(done => {
      resolve = done
    })
  const pending = s.reading.check(owner, source.id)
  s.data.update(owner, state => {
    state.sources.find(item => item.id === source.id)!.revision++
  })
  resolve([])
  await pending
  const stopping = s.reading.check(owner, source.id)
  s.reading.stop()
  resolve([])
  await stopping
  s.readingPorts.allowed = () => false
  await s.reading.check(owner, source.id)
  s.readingPorts.allowed = () => true
  s.readingPorts.read = () => Promise.resolve([])
  s.time(s.now() + 3 * 3600000)
  await s.reading.tick()
  s.reading.control(owner, source.id, 'remove')
  s.reading.control(owner, other.id, 'remove')
  assert.ok(s.data.get(owner).reading.every(item => item.saved))
})
void test('failed delivery does not resurrect erased owner state', async () => {
  const s = routineSetup()
  s.finance.subscription(owner, 'Due', 'USD', '1', '2027-01-15', 'month')
  s.readingPorts.notify = () => {
    s.data.erase(owner)
    return Promise.reject(new Error('delivery failed'))
  }
  await s.alerts.tick()
  assert.equal(s.data.owners().length, 0)
})
