import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Workflow } from '../workflow.js'
import { MemoryStateStore } from '../../__tests__/helpers.js'
void test('tasks persist, validate deadlines and remain owner scoped through status and deletion', () => {
  const store = new MemoryStateStore(),
    flow = new Workflow(store, () => 100)
  for (const [title, due] of [
    ['', null],
    ['x'.repeat(1001), null],
    ['Valid', 0],
    ['Valid', NaN]
  ] as const)
    assert.throws(() => flow.addTask('a', '1', title, due))
  const task = flow.addTask('a', '1', 'Review draft', 1000)
  assert.equal(new Workflow(store).get('a').tasks.length, 1)
  assert.equal(flow.get('b').tasks.length, 0)
  assert.throws(() => flow.task('b', task.id, 'done'))
  flow.task('a', task.id, 'done')
  flow.task('a', task.id, 'open')
  assert.throws(() => flow.task('a', task.id, 'due', 0))
  assert.throws(() => flow.task('a', task.id, 'due', NaN))
  flow.task('a', task.id, 'due')
  assert.equal(flow.get('a').tasks[0]!.dueAt, null)
  flow.task('a', task.id, 'due', 2000)
  for (let i = 1; i < 100; i++) flow.addTask('a', '1', 'Task', null)
  assert.throws(() => flow.addTask('a', '1', 'Overflow', null))
  flow.task('a', task.id, 'delete')
  assert.equal(flow.get('a').tasks.length, 99)
  flow.deleteThread('a', '1')
  assert.deepEqual(flow.get('a').tasks, [])
  flow.refresh('a')
  flow.erase('a')
  new Workflow().erase('none')
})
void test('glossaries enforce scope, replacement and bounded single-line spellings', () => {
  const flow = new Workflow()
  for (const [p, t] of [
    ['', 'Term'],
    ['p', ''],
    ['p', 'x'.repeat(81)],
    ['p', 'bad\nterm']
  ])
    assert.throws(() => flow.glossary('a', p!, t!, 'Meaning'))
  for (const meaning of ['', 'x'.repeat(201), 'bad\nmeaning'])
    assert.throws(() => flow.glossary('a', 'p', 'Term', meaning))
  flow.glossary('a', 'p', 'Product', 'Preferred')
  flow.glossary('a', 'p', 'product', 'Updated')
  assert.match(flow.terms('a', 'p'), /Updated/)
  assert.equal(flow.terms('b', 'p'), '')
  assert.equal(flow.terms('a', null), '')
  assert.throws(() => flow.glossary('a', 'p', 'missing'))
  flow.glossary('a', 'p', 'product')
  assert.equal(flow.terms('a', 'p'), '')
  for (let i = 0; i < 100; i++) flow.glossary('a', 'p', `t${i}`, 'v')
  assert.throws(() => flow.glossary('a', 'p', 'overflow', 'v'))
  for (let i = 0; i < 19; i++)
    flow.glossary('a', 'large', `t${i}`, 'x'.repeat(200))
  assert.throws(() => flow.glossary('a', 'large', 'next', 'x'.repeat(200)))
  flow.deleteProject('a', 'p')
  assert.equal(flow.terms('a', 'p'), '')
})
void test('quoted messages and single-use approvals reject stale, cross-owner and expired actions', () => {
  let now = 0
  const store = new MemoryStateStore(),
    flow = new Workflow(store, () => now)
  flow.quote('a', 10, '1', 'r', 'An old useful answer')
  assert.match(flow.quoted('a', '1', 10, ['r']), /old useful/)
  assert.match(flow.quoted('a', '1', 10, ['r'], 'useful'), /useful/)
  for (const args of [
    ['b', '1', 10, ['r']],
    ['a', '2', 10, ['r']],
    ['a', '1', 10, []],
    ['a', '1', 11, ['r']]
  ] as const)
    assert.throws(() => flow.quoted(args[0], args[1], args[2], [...args[3]]))
  for (const fragment of ['', 'wrong'])
    assert.throws(() => flow.quoted('a', '1', 10, ['r'], fragment))
  for (let i = 0; i < 101; i++) flow.quote('a', i, '1', 'r', 'Answer')
  assert.equal(flow.get('a').quotes.length, 100)
  const approval = flow.stage('a', {
    thread: '1',
    revision: 'r',
    kind: 'import',
    input: '{}',
    action: 'merge',
    estimate: 0
  })
  for (const [owner, thread, token, revision] of [
    ['b', '1', approval.token, 'r'],
    ['a', '2', approval.token, 'r'],
    ['a', '1', 'wrong', 'r'],
    ['a', '1', approval.token, 'changed']
  ])
    assert.throws(() => flow.approval(owner!, thread!, token!, revision))
  flow.approval('a', '1', approval.token, 'r', true)
  assert.throws(() => flow.approval('a', '1', approval.token, 'r'))
  flow.stage('a', {
    thread: '1',
    revision: undefined,
    kind: 'import',
    input: '{}',
    action: 'merge',
    estimate: 0
  })
  flow.deleteThread('a', '2')
  assert.ok(flow.get('a').approval)
  flow.deleteThread('a', '1')
  assert.equal(flow.get('a').approval, null)
  flow.stage('a', {
    thread: '1',
    revision: undefined,
    kind: 'import',
    input: '{}',
    action: 'merge',
    estimate: 0
  })
  now = 600000
  assert.equal(flow.get('a').approval, null)
  assert.throws(
    () =>
      flow.stage('a', {
        thread: '1',
        revision: undefined,
        kind: 'import',
        input: 'x'.repeat(20000000),
        action: 'merge',
        estimate: 0
      }),
    /20 MB/
  )
})
void test('task reminders retry delivery only, survive restart and ignore completed, deleted or changed work', async () => {
  let now = 0,
    calls = 0
  const store = new MemoryStateStore(),
    flow = new Workflow(store, () => now)
  const due = flow.addTask('a', '1', 'Due', 100)
  flow.addTask('a', '1', 'No deadline', null)
  const done = flow.addTask('a', '1', 'Done', 100)
  flow.task('a', done.id, 'done')
  await flow.tick(
    () => true,
    () => {
      calls++
      return Promise.resolve()
    }
  )
  assert.equal(calls, 0)
  now = 100
  await flow.tick(
    () => false,
    () => {
      calls++
      return Promise.resolve()
    }
  )
  assert.equal(calls, 0)
  for (let i = 0; i < 3; i++) {
    await flow.tick(
      () => true,
      () => {
        calls++
        return Promise.reject(new Error('private'))
      }
    )
    await flow.tick(
      () => true,
      () => {
        calls++
        return Promise.resolve()
      }
    )
    now += 60000
  }
  assert.equal(calls, 3)
  await flow.tick(
    () => true,
    () => {
      calls++
      return Promise.resolve()
    }
  )
  assert.equal(calls, 3)
  flow.task('a', due.id, 'due', now + 1)
  now++
  await flow.tick(
    () => true,
    async () => {
      calls++
      await flow.tick(
        () => true,
        () => Promise.resolve()
      )
    }
  )
  assert.equal(
    flow.get('a').tasks.find(item => item.id === due.id)!.reminded,
    true
  )
  await new Workflow(store, () => now).tick(
    () => true,
    () => {
      throw new Error('No repeat')
    }
  )
  const removed = flow.addTask('a', '1', 'Remove during delivery', now + 1)
  now++
  await flow.tick(
    () => true,
    () => {
      flow.task('a', removed.id, 'delete')
      return Promise.resolve()
    }
  )
  const changed = flow.addTask('a', '1', 'Change during delivery', now + 1)
  now++
  await flow.tick(
    () => true,
    () => {
      flow.task('a', changed.id, 'due', now + 1000)
      return Promise.resolve()
    }
  )
  const completed = flow.addTask('a', '1', 'Complete during delivery', now + 1)
  now++
  await flow.tick(
    () => true,
    () => {
      flow.task('a', completed.id, 'done')
      return Promise.resolve()
    }
  )
})

void test('task delivery is claimed durably before sending and skips work changed by an earlier notification', async () => {
  let now = 0
  const store = new MemoryStateStore(),
    flow = new Workflow(store, () => now)
  const first = flow.addTask('a', '1', 'First', 100),
    removed = flow.addTask('a', '1', 'Removed', 100),
    done = flow.addTask('a', '1', 'Done', 100),
    changed = flow.addTask('a', '1', 'Changed', 100)
  const put = store.putRecord.bind(store)
  store.putRecord = () => {
    throw new Error('Disk unavailable')
  }
  now = 100
  let sent = 0
  await assert.rejects(
    flow.tick(
      () => true,
      () => {
        sent++
        return Promise.resolve()
      }
    )
  )
  assert.equal(sent, 0)
  store.putRecord = put
  await flow.tick(
    () => true,
    (_owner, task) => {
      sent++
      assert.equal(task.id, first.id)
      assert.equal(
        store
          .getRecord<{ tasks: { id: string; attempts: number }[] }>(
            'workflow',
            'a'
          )!
          .tasks.find(item => item.id === first.id)!.attempts,
        1
      )
      flow.task('a', removed.id, 'delete')
      flow.task('a', done.id, 'done')
      flow.task('a', changed.id, 'due', now + 1000)
      return Promise.resolve()
    }
  )
  assert.equal(sent, 1)
})
