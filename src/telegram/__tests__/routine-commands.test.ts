import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  routineSetup,
  routineOwner as owner,
  routineSource
} from '../../__tests__/routines.js'
void test('home and day commands review local changes with exact revisions and never silently run a paid plan', async () => {
  const s = routineSetup(),
    run = (text: string) => s.commands.handle(s.ctx, text),
    task = s.task()
  assert.equal(await run('hello'), false)
  assert.equal(await s.commands.callback(s.ctx, 'other'), false)
  for (const command of [
    '/home',
    '/home workspace',
    '/home shortcuts plan expense evening',
    '/day',
    '/day calendar',
    '/day calendar use mail',
    '/day calendar sync 2027-01-15 09:00 18:00',
    '/day calendar use none',
    `/day task ${task.id} 25 1`
  ])
    await run(command)
  assert.equal(s.studio.get(owner).missions[0]!.state, 'draft')
  assert.equal(s.model.calls.length, 0)
  await assert.rejects(run('/day preview'))
  await run('/day calendar manual 2027-01-15 09:00 18:00 | []')
  let pending = s.data.get(owner).pending!
  await run(`/day confirm ${pending.token} ${pending.revision}`)
  await run('/day plan')
  await run('/day preview')
  pending = s.data.get(owner).pending!
  await run(`/day cancel ${pending.token} ${pending.revision}`)
  await run('/day plan')
  pending = s.data.get(owner).pending!
  await run(`/day confirm ${pending.token} ${pending.revision}`)
  await run('/day')
  await run('/home')
  await run('/day evening')
  pending = s.data.get(owner).pending!
  await run(
    `/day evening set ${pending.token} ${pending.revision} ${task.id} carry | 2027-01-16 10:00`
  )
  pending = s.data.get(owner).pending!
  await run(
    `/day evening set ${pending.token} ${pending.revision} ${task.id} keep`
  )
  pending = s.data.get(owner).pending!
  await run(
    `/day evening note ${pending.token} ${pending.revision} | Useful day`
  )
  pending = s.data.get(owner).pending!
  await run(`/day confirm ${pending.token} ${pending.revision}`)
  await run('/home')
  for (const command of [
    '/day alerts',
    '/day alerts clear',
    '/day export',
    `/day remove ${s.data.get(owner).days[0]!.id}`,
    '/focus',
    '/home',
    '/focus stop',
    `/focus 1 ${task.id}`,
    '/focus stop',
    '/focus 1 none',
    '/focus stop'
  ])
    await run(command)
  await assert.rejects(run('/focus 25 other'))
  await assert.rejects(run('/day bad'))
  await assert.rejects(
    run(`/day review ${s.studio.get(owner).missions[0]!.id}`)
  )
  for (const callback of [
    'routine:workspace',
    'routine:home:expense',
    'routine:home:reading',
    'routine:home:waiting',
    'routine:home:focus'
  ])
    await s.commands.callback(s.ctx, callback)
  await run('/focus stop')
  await assert.rejects(s.commands.callback(s.ctx, 'routine:bad'))
  await assert.rejects(s.commands.callback(s.ctx, 'routine:home:bad'))
  assert.ok(s.files.some(file => file.name === 'daily-routines.json'))
})
void test('expense commands require visible payment/refund confirmation and support corrections and exports', async () => {
  const s = routineSetup(),
    run = (text: string) => s.commands.handle(s.ctx, text)
  for (const command of [
    '/expense',
    '/expense scan | Read total',
    '/expense add | Shop | 2027-01-15 | USD | 12.34 | Food'
  ])
    await run(command)
  let pending = s.data.get(owner).pending!
  await run(
    `/expense correct ${pending.token} ${pending.revision} 1 minor | 1235`
  )
  pending = s.data.get(owner).pending!
  await run(`/day confirm ${pending.token} ${pending.revision}`)
  const expense = s.data.get(owner).expenses[0]!
  for (const command of [
    '/expense',
    '/expense total',
    '/expense total 2027-01',
    '/expense subscriptions',
    '/expense subscription add month | Music | EUR | 3.99 | 2027-01-31'
  ])
    await run(command)
  const sub = s.data.get(owner).subscriptions[0]!
  await run(`/expense subscription paid ${sub.id} 2027-01-31`)
  assert.equal(s.data.get(owner).expenses.length, 1)
  await run(`/expense subscription paid ${sub.id} 2027-01-31 confirm`)
  for (const action of ['off', 'on', 'remove'])
    await run(`/expense subscription ${action} ${sub.id}`)
  await assert.rejects(run('/expense subscription paid missing 2027-01-31'))
  await run(`/expense refund ${expense.id} 2027-01-16 1.00`)
  const refund = s.data.get(owner).refunds[0]!
  await run('/expense refunds')
  await run(`/expense received ${refund.id} 2027-01-16`)
  assert.equal(s.data.get(owner).refunds[0]!.status, 'waiting')
  await run(`/expense received ${refund.id} 2027-01-16 confirm`)
  await assert.rejects(run('/expense received missing 2027-01-16 confirm'))
  await assert.rejects(run(`/expense refund ${expense.id} 2027-01-16`))
  await run(`/expense refund ${expense.id} 2027-01-16 1.00`)
  await run(`/expense close ${s.data.get(owner).refunds.at(-1)!.id}`)
  await run('/expense export')
  await assert.rejects(run('/expense clear'))
  await run('/expense clear confirm')
  await run('/expense add | Cafe | 2027-01-15 | USD | 1.00 | Food')
  pending = s.data.get(owner).pending!
  await run(`/day confirm ${pending.token} 1`)
  await run(`/expense remove ${s.data.get(owner).expenses[0]!.id}`)
  await assert.rejects(run('/expense bad'))
})
void test('recall and correspondence commands preserve source selection and propose inert model/service missions', async () => {
  const s = routineSetup(),
    run = (text: string) => s.commands.handle(s.ctx, text)
  await run('/review')
  await run('/review next')
  await run('/review add | Question | Answer')
  const pending = s.data.get(owner).pending!
  await run(`/day confirm ${pending.token} 1`)
  await s.commands.callback(s.ctx, 'routine:home:review')
  let session = s.data.get(owner).session!
  await run(`/review reveal ${session.token}`)
  await run(`/review grade ${session.token} again`)
  s.time(s.now() + 600001)
  await run('/review next')
  session = s.data.get(owner).session!
  await s.commands.callback(s.ctx, `routine:reveal:${session.token}`)
  await s.commands.callback(s.ctx, `routine:grade:${session.token}:good`)
  await run('/review notify 08:00')
  await run(`/review remove ${s.data.get(owner).cards[0]!.id}`)
  await assert.rejects(run('/review bad'))
  s.suite.select(owner, routineSource)
  await run('/review from')
  await run('/review from selected | Focus')
  await run('/waiting')
  s.suite.clearSelected(owner)
  await assert.rejects(run('/waiting add | Alice | Request | 2027-01-16 10:00'))
  s.ctx.quote = () => routineSource.text
  await run(
    '/waiting add | Alice | Request | 2027-01-16 10:00 | 2027-01-15 08:00'
  )
  const id = s.data.get(owner).waiting[0]!.id
  await run('/waiting')
  await run(`/waiting show ${id}`)
  await run(`/waiting bind ${id} mail | thread-1`)
  await run(`/waiting check ${id}`)
  await run(`/waiting draft ${id} | Follow up`)
  await run(`/waiting send ${id} | Follow up`)
  await run(`/waiting reply ${id} | Received`)
  await run(`/waiting snooze ${id} | 2027-01-17 10:00`)
  await run(`/waiting close ${id}`)
  await run(`/waiting remove ${id}`)
  s.ctx.quote = () => ''
  s.suite.select(owner, routineSource)
  await run('/waiting add | Bob | Request | 2027-01-16 10:00')
  await assert.rejects(run('/waiting bad'))
  assert.ok(
    s.studio.get(owner).missions.every(mission => mission.state === 'draft')
  )
  assert.equal(s.model.calls.length, 0)
})
void test('reading commands expose source lifecycle, explicit topic feedback and opt-in model briefs', async () => {
  const s = routineSetup(),
    run = (text: string) => s.commands.handle(s.ctx, text)
  await run('/reading')
  await run('/reading add rss 1 https://example.com/feed')
  const source = s.data.get(owner).sources[0]!
  await run('/reading sources')
  await run(`/reading check ${source.id}`)
  await run('/reading')
  const id = s.data.get(owner).reading[0]!.id
  for (const command of [
    '/reading topic 2 | TypeScript',
    '/reading topic hide | TypeScript',
    '/reading topic show | TypeScript',
    '/reading topics',
    `/reading more ${id} | TypeScript`,
    `/reading less ${id} | TypeScript`,
    '/reading delivery 08:00',
    '/reading brief | Focus',
    `/reading brief ${id} | Focus`,
    '/reading export'
  ])
    await run(command)
  for (const action of ['read', 'unread', 'save', 'hide'])
    await run(`/reading ${action} ${id}`)
  for (const action of ['off', 'on', 'remove'])
    await run(`/reading ${action} ${source.id}`)
  await assert.rejects(run('/reading bad'))
  assert.equal(s.model.calls.length, 0)
})
void test('malformed routine commands remain local errors and expose missing explicit fields', async () => {
  const s = routineSetup(),
    run = (text: string) => s.commands.handle(s.ctx, text)
  for (const command of [
    '/review add',
    '/review add | Question',
    '/reading topic hide',
    '/reading more missing',
    '/reading less missing',
    '/expense add',
    '/expense add | Shop',
    '/expense add | Shop | 2027-01-15',
    '/expense add | Shop | 2027-01-15 | USD',
    '/expense add | Shop | 2027-01-15 | USD | 1',
    '/expense subscription add month',
    '/expense subscription add month | Music',
    '/expense subscription add month | Music | USD',
    '/expense subscription add month | Music | USD | 1',
    '/day calendar manual 2027-01-15 09:00 18:00',
    '/day evening',
    '/day evening set missing 1 task carry',
    '/day evening note missing 1',
    '/waiting add',
    '/waiting add | Alice',
    '/waiting add | Alice | Request',
    '/waiting add | Alice | Request | 2027-01-16 10:00'
  ])
    await assert.rejects(run(command), command)
  s.suite.select(owner, routineSource)
  for (const command of [
    '/waiting add',
    '/waiting add | Alice',
    '/waiting add | Alice | Request'
  ])
    await assert.rejects(run(command))
  await run('/waiting add | Alice | Request | 2027-01-16 10:00')
  const item = s.data.get(owner).waiting[0]!
  await assert.rejects(run(`/waiting bind ${item.id} mail`))
  await assert.rejects(run(`/waiting snooze ${item.id}`))
  await assert.rejects(run(`/waiting reply ${item.id}`))
  s.settings.workbench.connections = []
  await run('/day calendar')
  assert.match(s.messages.at(-1)!, /Available: none/)
  const pending = s.data.preview(
    owner,
    { thread: '1', project: null },
    'cards',
    'long',
    'base',
    { text: 'x'.repeat(11000) }
  )
  await s.commands.preview(s.ctx, pending)
  assert.match(s.messages.at(-1)!, /shortened/)
  assert.equal(s.model.calls.length, 0)
})
void test('completed daily mission reopens only local validation and renders full files without another model call', async () => {
  const s = routineSetup(),
    run = (text: string) => s.commands.handle(s.ctx, text)
  s.suite.select(owner, routineSource)
  const mission = s.plans.cards(owner, '1', 'selected', ''),
    compose = mission.steps[0]!
  compose.state = 'done'
  compose.output = {
    text: JSON.stringify([
      {
        front: 'Q',
        back: 'A',
        source: routineSource.id,
        quote: 'A durable claim'
      }
    ]),
    images: []
  }
  mission.state = 'done'
  s.studio.get(owner)
  const state = s.store.getRecord<import('../../domain/studio.js').StudioState>(
    'studio',
    owner
  )!
  state.missions[0] = mission
  s.store.putRecord('studio', owner, state)
  s.studio.refresh(owner)
  await run(`/day review ${mission.id}`)
  assert.ok(s.files.some(file => file.name === 'daily-review.json'))
  assert.equal(s.model.calls.length, 0)
  s.data.update(owner, state => {
    state.days = [
      {
        id: '1',
        date: '2027-01-14',
        revision: 1,
        calendar: 1,
        slots: [],
        unscheduled: [],
        notes: '',
        closed: true,
        outcomes: []
      },
      {
        id: '2',
        date: '2027-01-15',
        revision: 1,
        calendar: 1,
        slots: [],
        unscheduled: [],
        notes: '',
        closed: false,
        outcomes: []
      },
      {
        id: '3',
        date: '2027-01-13',
        revision: 1,
        calendar: 1,
        slots: [],
        unscheduled: [],
        notes: '',
        closed: false,
        outcomes: []
      }
    ]
  })
  await run('/day')
  await run('/day evening')
  await run('/waiting')
  await run('/home')
})
void test('home includes waiting records and local reopened result supports a file-free adapter reply', async t => {
  const s = routineSetup()
  s.waiting.add(
    owner,
    'Alice',
    'Request',
    routineSource,
    s.now() - 1000,
    s.now() + 1000
  )
  await s.commands.home(s.ctx)
  assert.match(s.messages.at(-1)!, /1 waiting replies/)
  const mission = s.plans.receipt(
    owner,
    '1',
    { images: [{ mime: 'image/png', data: 'QQ==' }], documents: [] },
    ''
  )
  mission.state = 'done'
  const state = s.studio.get(owner)
  state.missions[0] = mission
  s.store.putRecord('studio', owner, state)
  s.studio.refresh(owner)
  t.mock.method(s.routineExecutor, 'execute', () =>
    Promise.resolve({ text: 'Local adapter reply', images: [] })
  )
  await s.commands.handle(s.ctx, `/day review ${mission.id}`)
  assert.equal(s.messages.at(-1), 'Local adapter reply')
})
