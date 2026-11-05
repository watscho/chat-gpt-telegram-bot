import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Daily } from '../daily.js'
import { Workflow } from '../workflow.js'
import { MemoryStateStore } from '../../__tests__/helpers.js'
const raw = (
  rows: { summary: string | null; task: string | null; due: string | null }[]
) => JSON.stringify({ rows })
void test('daily preferences, favorites and recent scenarios persist with bounded private state', () => {
  const store = new MemoryStateStore(),
    data = new Daily(store)
  assert.equal(data.get('a').onboarded, false)
  assert.throws(() => data.focus('a', 'bad'))
  data.focus('a', 'work')
  data.complete('a')
  data.notes('a', 'on')
  data.notes('a', 'off')
  assert.throws(() => data.notes('a', 'bad'))
  for (let i = 0; i < 20; i++) data.favorite('a', String(i), true)
  data.favorite('a', '1', true)
  assert.throws(() => data.favorite('a', 'over', true))
  data.favorite('a', '1', false)
  for (let i = 0; i < 12; i++) data.used('a', String(i))
  data.used('a', '11')
  const saved = new Daily(store).get('a')
  assert.equal(saved.favorites.length, 19)
  assert.equal(saved.recent.length, 10)
  assert.equal(data.get('b').favorites.length, 0)
  const tooBig = data.get('a')
  tooBig.recent = ['x'.repeat(100001)]
  assert.throws(() => data.save('a', tooBig))
  data.refresh('a')
  assert.equal(data.get('a').onboarded, true)
  data.erase('a')
  assert.equal(store.getRecord('daily', 'a'), undefined)
  new Daily().erase('none')
})
void test('scenario input and reviewed proposals are expiring owner/thread/revision bound snapshots', () => {
  let now = Date.parse('2026-11-05T10:00:00Z')
  const data = new Daily(undefined, () => now)
  assert.equal(data.takePending('a', '1', undefined), null)
  data.pending('a', '1', 'r', 'polish')
  assert.throws(() => data.takePending('a', '2', 'r'))
  data.pending('a', '1', 'r', 'polish')
  assert.throws(() => data.takePending('a', '1', 'changed'))
  data.pending('a', '1', undefined, 'polish')
  assert.equal(data.takePending('a', '1', undefined), 'polish')
  data.pending('a', '1', 'r', 'polish')
  now += 600001
  assert.equal(data.takePending('a', '1', 'r'), null)
  assert.throws(() => data.stage('a', '1', 'r', '{}', 'UTC'))
  assert.throws(() =>
    data.stage(
      'a',
      '1',
      'r',
      raw(
        Array.from({ length: 11 }, () => ({
          summary: null,
          task: 'x',
          due: null
        }))
      ),
      'UTC'
    )
  )
  const plan = data.stage(
    'a',
    '1',
    'r',
    raw([
      { summary: 'Summary', task: null, due: null },
      { summary: null, task: '  Task  ', due: '2099-01-01 09:00' },
      { summary: null, task: 'Task', due: '2099-01-01 09:00' },
      { summary: null, task: 'x'.repeat(1001), due: 'invalid' },
      { summary: null, task: 'No deadline', due: null }
    ]),
    'UTC'
  )
  assert.equal(plan.items.length, 3)
  assert.equal(plan.items[1]!.title.length, 1000)
  assert.equal(plan.items[1]!.dueAt, null)
  assert.equal(plan.warnings.length, 1)
  assert.equal(data.plan('a', '1', 'r', plan.token).summary, 'Summary')
  for (const [owner, thread, revision, token] of [
    ['b', '1', 'r', plan.token],
    ['a', '2', 'r', plan.token],
    ['a', '1', 'other', plan.token],
    ['a', '1', 'r', 'bad']
  ])
    assert.throws(() => data.plan(owner!, thread!, revision, token!))
  data.deleteThread('a', 'other')
  assert.ok(data.get('a').plan)
  data.pending('a', '1', 'r', 'plan')
  data.deleteThread('a', '1')
  assert.equal(data.get('a').plan, null)
  assert.equal(data.get('a').pending, null)
  data.stage(
    'a',
    '1',
    undefined,
    raw([{ summary: null, task: 'T', due: null }]),
    'UTC'
  )
  now += 600001
  assert.equal(data.get('a').plan, null)
  data.clearPlan('a')
})
void test('reviewed tasks commit atomically and repeat confirmations cannot duplicate created tasks', () => {
  const store = new MemoryStateStore(),
    flow = new Workflow(store, () => 100)
  const items = [
    { title: 'One', dueAt: null },
    { title: 'Two', dueAt: 1000 }
  ]
  assert.equal(flow.addReviewedTasks('a', '1', 'token', items), 2)
  assert.equal(flow.addReviewedTasks('a', '1', 'token', items), 0)
  for (const item of [
    { title: '', dueAt: null },
    { title: 'x'.repeat(1001), dueAt: null },
    { title: 'x', dueAt: 0 },
    { title: 'x', dueAt: NaN }
  ])
    assert.throws(() => flow.addReviewedTasks('a', '1', 'bad', [item]))
  assert.throws(() =>
    flow.addReviewedTasks(
      'a',
      '1',
      'big',
      Array.from({ length: 11 }, () => items[0]!)
    )
  )
  const state = flow.get('a')
  state.tasks = Array.from({ length: 100 }, (_, i) => ({
    ...state.tasks[0]!,
    id: String(i)
  }))
  flow.save('a', state)
  assert.throws(() => flow.addReviewedTasks('a', '1', 'full', items))
  const local = new Workflow(undefined, () => 100)
  assert.equal(local.addReviewedTasks('a', '1', 'local', items), 2)
  const broken = new MemoryStateStore()
  broken.putRecord = () => {
    throw new Error('Disk')
  }
  const failure = new Workflow(broken)
  assert.throws(() =>
    failure.addReviewedTasks('a', '1', 'safe', [{ title: 'T', dueAt: null }])
  )
  assert.equal(failure.get('a').tasks.length, 0)
})
void test('morning dashboard honors timezone/quiet hours, bounded delivery claims, restart and settings changes', async () => {
  let now = Date.parse('2026-11-05T07:00:00Z'),
    sends = 0
  const store = new MemoryStateStore(),
    data = new Daily(store, () => now)
  assert.throws(() => data.morning('a', '24:00'))
  assert.throws(() => data.morning('a', 'bad'))
  data.morning('a', '08:00')
  data.morning('other', 'off')
  const restored = new Daily(store, () => now)
  const tick = (allowed = true, quiet = false, fail = false) =>
    restored.tick(
      () => allowed,
      () => 'UTC',
      () => quiet,
      () => {
        sends++
        return fail ? Promise.reject(new Error('Transport')) : Promise.resolve()
      }
    )
  await tick(false)
  await tick(true, true)
  await tick()
  assert.equal(sends, 0)
  now += 3600000
  await tick(true, false, true)
  await tick()
  assert.equal(sends, 1)
  now += 60000
  await tick(true, false, true)
  now += 60000
  await tick(true, false, true)
  now += 60000
  await tick()
  assert.equal(sends, 3)
  now += 86400000
  await tick()
  await tick()
  assert.equal(sends, 4)
  restored.morning('a', '08:00')
  await restored.tick(
    () => true,
    () => 'UTC',
    () => false,
    async owner => {
      sends++
      await tick()
      restored.morning(owner, 'off')
    }
  )
  assert.equal(sends, 5)
  assert.equal(restored.get('a').morning, null)
  const local = new Daily(undefined, () => now)
  await local.tick(
    () => true,
    () => 'UTC',
    () => false,
    () => Promise.resolve()
  )
  local.morning('a', '08:00')
  await local.tick(
    () => true,
    () => 'UTC',
    () => false,
    () => Promise.resolve()
  )
  assert.equal(local.get('a').morning!.sent, true)
  restored.morning('a', '08:00')
  restored.refresh('a')
  const put = store.putRecord.bind(store)
  store.putRecord = () => {
    throw new Error('Disk')
  }
  await assert.rejects(tick())
  assert.equal(sends, 5)
  store.putRecord = put
})
