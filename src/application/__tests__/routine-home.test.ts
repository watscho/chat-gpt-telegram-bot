import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  routineSetup,
  routineOwner as owner,
  routineScope as scope,
  routineSource
} from '../../__tests__/routines.js'
import { StudioWorkspace } from '../studio-workspace.js'
void test('signed home actions bind current conversation/project, expose answer only after reveal and accept exact local previews', async () => {
  const s = routineSetup(),
    task = s.task(),
    act = (
      action: string,
      id = '',
      value?: string,
      revision?: number,
      confirm?: boolean
    ) =>
      s.home.action(owner, {
        action: 'home:' + action,
        id,
        ...(value === undefined ? {} : { value }),
        ...(revision === undefined ? {} : { revision }),
        ...(confirm === undefined ? {} : { confirm })
      })
  assert.equal(s.home.snapshot(owner).session, null)
  assert.equal(s.home.snapshot(owner).pending, null)
  act('pins', '', 'review,reading,focus')
  act('calendar-use', 'mail')
  assert.equal(s.home.snapshot(owner).connections[0]!.id, 'mail')
  assert.ok(
    act(
      'calendar-sync',
      '',
      JSON.stringify({ date: '2027-01-15', start: '09:00', end: '18:00' })
    ).mission
  )
  act(
    'manual',
    '',
    JSON.stringify({
      date: '2027-01-15',
      start: '09:00',
      end: '18:00',
      busy: '[]'
    })
  )
  let p = s.data.get(owner).pending!
  act('confirm', p.token, undefined, 1, true)
  act('task', task.id, JSON.stringify({ minutes: '30', priority: '5' }))
  act('plan')
  p = s.data.get(owner).pending!
  act('cancel', p.token, undefined, 1)
  act('plan')
  p = s.data.get(owner).pending!
  act('confirm', p.token, undefined, 1, true)
  act('evening')
  p = s.data.get(owner).pending!
  act(
    'outcome',
    p.token,
    JSON.stringify({ task: task.id, action: 'carry', due: '2027-01-16 10:00' }),
    1
  )
  p = s.data.get(owner).pending!
  act(
    'outcome',
    p.token,
    JSON.stringify({ task: task.id, action: 'keep', due: '' }),
    p.revision
  )
  p = s.data.get(owner).pending!
  act('evening-note', p.token, 'Good day', p.revision)
  p = s.data.get(owner).pending!
  act('confirm', p.token, undefined, p.revision, true)
  act(
    'expense-preview',
    '',
    JSON.stringify({
      merchant: 'Shop',
      date: '2027-01-15',
      currency: 'USD',
      amount: '1.00',
      category: 'Food'
    })
  )
  p = s.data.get(owner).pending!
  assert.equal(s.home.snapshot(owner).pending!.token, p.token)
  act('confirm', p.token, undefined, 1, true)
  act('focus', task.id, '1')
  act('focus-stop')
  act('focus')
  act('focus-stop')
  s.suite.select(owner, routineSource)
  assert.ok(act('cards-plan').mission)
  assert.ok(act('cards-plan', 'selected', 'Focus').mission)
  p = s.learning.preview(owner, scope, 'cards', [
    { front: 'Q', back: 'A', source: routineSource }
  ])
  s.learning.confirm(owner, scope, p.token, 1)
  act('review-next')
  const session = s.data.get(owner).session!
  assert.equal(s.home.snapshot(owner).session!.back, null)
  act('review-reveal', session.token)
  assert.equal(s.home.snapshot(owner).session!.back, 'A')
  act('review-grade', session.token, 'good')
  const waiting = s.waiting.add(
    owner,
    'Alice',
    'Request',
    routineSource,
    s.now() - 1000,
    s.now() + 1000
  )
  s.waiting.bind(owner, waiting.id, 'mail', 'thread')
  assert.ok(act('waiting-check', waiting.id).mission)
  assert.ok(act('waiting-draft', waiting.id).mission)
  assert.ok(act('waiting-draft', waiting.id, 'Focus').mission)
  act('waiting-close', waiting.id)
  const source = s.reading.add(owner, 'rss', 'https://example.com/feed', 1)
  await s.reading.check(owner, source.id)
  const id = s.data.get(owner).reading[0]!.id
  for (const weight of ['1', 'hide', 'show'])
    act('reading-topic', '', JSON.stringify({ topic: 'TypeScript', weight }))
  assert.ok(act('reading-brief').mission)
  assert.ok(act('reading-brief', id, 'Focus').mission)
  act('reading-mark', id, 'read')
  const workspace = new StudioWorkspace(
    s.studio,
    s.profiles,
    s.ws,
    s.workflow,
    s.usage,
    s.jobs,
    undefined,
    s.home
  )
  assert.ok(workspace.snapshot(owner).home)
  assert.equal(
    workspace.action(owner, { action: 'home:focus-stop', id: '' }).home!.focus,
    null
  )
  assert.throws(
    () => s.view.action(owner, { action: 'home:focus-stop', id: '' }),
    /unavailable/
  )
})
void test('home rejects malformed or stale writes and hides pending material after a scope change', () => {
  const s = routineSetup(),
    bad = (body: Record<string, unknown>) =>
      assert.throws(() => s.home.action(owner, body))
  for (const body of [
    { action: 'home:pins', id: '', extra: true },
    { id: '' },
    { action: 'home:pins' },
    { action: 'home:pins', id: 'x'.repeat(121) },
    { action: 'home:pins', id: '', value: {} },
    { action: 'home:pins', id: '', value: 'x'.repeat(20001) }
  ])
    bad(body)
  for (const value of [
    'bad',
    'null',
    '[]',
    '{}',
    '{"minutes":2,"priority":"1"}',
    '{"minutes":"2","priority":"1","extra":"x"}'
  ])
    bad({ action: 'home:task', id: 'x', value })
  bad({ action: 'home:focus', id: 'other' })
  bad({ action: 'home:confirm', id: 'x' })
  bad({ action: 'home:confirm', id: 'x', revision: 1 })
  bad({ action: 'home:evening', id: '' })
  bad({ action: 'home:unknown', id: '' })
  const p = s.finance.manual(
    owner,
    scope,
    'Shop',
    '2027-01-15',
    'USD',
    '1.00',
    'Food'
  )
  assert.ok(s.home.snapshot(owner).pending)
  const project = s.ws.create(owner, 'Private')
  s.ws.configure(owner, '1', { project: project.id })
  assert.equal(s.home.snapshot(owner).pending, null)
  assert.throws(() =>
    s.home.action(owner, { action: 'home:cancel', id: p.token, revision: 1 })
  )
})
void test('routine plan factories preserve explicit sources, reject invalid inputs and freeze model choice', () => {
  const s = routineSetup()
  assert.throws(() =>
    s.plans.calendarRead(owner, '1', '2027-01-15', '09:00', '18:00')
  )
  assert.throws(() => s.plans.window(owner, '2027-01-14', '09:00', '18:00'))
  for (const raw of [
    'bad',
    '{}',
    JSON.stringify(Array(201).fill({})),
    '[null]',
    '[[]]',
    '[{"title":3}]',
    '[{"title":"x","start":3,"end":"x"}]',
    '[{"title":"x","start":"x","end":3}]'
  ])
    assert.throws(() =>
      s.plans.manual(owner, '1', '2027-01-15', '09:00', '18:00', raw)
    )
  s.plans.manual(
    owner,
    '1',
    '2027-01-15',
    '09:00',
    '18:00',
    '[{"title":"Meeting","start":"2027-01-15 10:00","end":"2027-01-15 11:00"}]'
  )
  assert.throws(() =>
    s.plans.receipt(owner, '1', { images: [], documents: [] }, '')
  )
  assert.throws(() => s.plans.cards(owner, '1', 'selected', ''))
  const item = s.waiting.add(
    owner,
    'Alice',
    'Request',
    routineSource,
    s.now() - 1000,
    s.now() + 1000
  )
  assert.throws(() => s.plans.checkReply(owner, '1', item.id))
  assert.throws(() => s.plans.followup(owner, '1', item.id, '', true))
  s.waiting.control(owner, item.id, 'close')
  assert.throws(() => s.plans.followup(owner, '1', item.id, '', false))
  assert.throws(() => s.plans.checkReply(owner, '1', item.id))
  for (const ids of [[], Array.from({ length: 6 }, () => 'id'), ['id', 'id']])
    assert.throws(() => s.plans.brief(owner, '1', ids, ''))
})
void test('home resolves newest open plan while course card plans include bounded selected accepted record excerpts', () => {
  const s = routineSetup(),
    task = s.task()
  s.available()
  const p = s.calendar.plan(owner, scope, 'UTC')
  s.calendar.confirmPlan(owner, scope, p.token, 1)
  s.data.update(owner, state => {
    state.days.push({ ...state.days[0]!, id: 'other', date: '2027-01-14' })
  })
  s.home.action(owner, { action: 'home:evening', id: '' })
  assert.equal(
    (JSON.parse(s.data.get(owner).pending!.payload) as { day: string }).day,
    s.data.get(owner).days[0]!.id
  )
  assert.throws(
    () => s.home.action(owner, { action: 'home:task', id: task.id }),
    /valid daily action/
  )
  for (const large of [false, true]) {
    const record = s.suite.putRecord(owner, {
      kind: 'course',
      title: 'Course',
      thread: '1',
      project: null,
      fields: { goal: 'Learn' },
      rows: Array.from({ length: large ? 8 : 1 }, () => ({
        question: large ? 'x'.repeat(1900) : 'Q',
        answer: 'A'
      })),
      sources: [routineSource]
    })
    const mission = s.plans.cards(owner, '1', record.id, '')
    assert.ok(mission.input.sources![0]!.text.length <= 12000)
  }
})
