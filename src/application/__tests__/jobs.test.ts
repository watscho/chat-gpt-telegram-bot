import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config, MemoryStateStore } from '../../__tests__/helpers.js'
import type { JobInput } from '../../domain/jobs.js'
import type { ModelReply } from '../../domain/conversation.js'
import { UserError } from '../../domain/conversation.js'
import { Jobs, type WorkerPorts } from '../jobs.js'

const input: JobInput = {
  prompt: 'Research a topic',
  documents: [],
  images: [],
  instructions: '',
  memories: []
}
function setup(overrides = {}) {
  let now = Date.parse('2026-01-01T00:00:00Z')
  const store = new MemoryStateStore()
  const executed: string[] = [],
    delivered: string[] = []
  const flags = { available: true, fail: false, delivery: false }
  const ports: WorkerPorts = {
    allowed: owner => owner !== 'blocked',
    available: () => flags.available,
    input: (_owner, _thread, prompt) => ({ ...input, prompt }),
    execute: (_owner, job) => {
      executed.push(job.id)
      return flags.fail
        ? Promise.reject(new Error('provider-secret'))
        : Promise.resolve({ text: 'Result', images: [] })
    },
    deliver: (_owner, job) => {
      delivered.push(job.id)
      return flags.delivery
        ? Promise.reject(new Error('telegram-secret'))
        : Promise.resolve()
    }
  }
  const settings = { ...config(), ...overrides }
  const queue = new Jobs(settings, ports, store, () => now)
  return {
    queue,
    settings,
    store,
    ports,
    flags,
    executed,
    delivered,
    advance: (ms: number) => {
      now += ms
    },
    now: () => now
  }
}
void test('jobs execute once, persist results and retry delivery without repeating paid work', async () => {
  const app = setup()
  const job = app.queue.enqueue('a', '1', 'research', input)
  app.flags.delivery = true
  await app.queue.tick()
  assert.equal(app.queue.get('a').jobs[0]?.state, 'succeeded')
  assert.equal(app.queue.get('a').jobs[0]?.delivery, 'failed')
  assert.equal(app.queue.get('a').jobs[0]?.input.prompt, '')
  assert.equal(app.executed.length, 1)
  await app.queue.tick()
  assert.equal(app.delivered.length, 1)
  for (let i = 0; i < 2; i++) {
    app.advance(60000)
    await app.queue.tick()
  }
  app.advance(60000)
  await app.queue.tick()
  assert.equal(app.delivered.length, 3)
  assert.equal(app.executed.length, 1)
  app.flags.delivery = false
  await app.queue.result('a', job.id)
  await assert.rejects(app.queue.result('b', job.id), /retained result/)
  app.queue.remove('a', job.id)
  assert.equal(app.queue.get('a').jobs.length, 0)
  assert.throws(() => app.queue.remove('a', job.id), /not found/)
  const second = app.queue.enqueue('a', '1', 'summary', input)
  await app.queue.tick()
  assert.equal(app.queue.get('a').jobs[0]?.delivery, 'sent')
  await app.queue.tick()
  assert.equal(app.delivered.filter(id => id === second.id).length, 1)
})
void test('quota-sized queues, owner permissions, failures and queued cancellation are enforced', async () => {
  const app = setup({ maxJobs: 1 })
  assert.throws(
    () => app.queue.enqueue('a', '1', 'research', { ...input, prompt: '' }),
    /empty/
  )
  assert.throws(
    () =>
      app.queue.enqueue('a', '1', 'research', {
        ...input,
        prompt: 'x'.repeat(8001)
      }),
    /long/
  )
  assert.throws(
    () => app.queue.enqueue('a', '1', 'compare', input),
    /two reference/
  )
  const first = app.queue.enqueue('a', '1', 'research', input)
  assert.throws(() => app.queue.enqueue('a', '1', 'research', input), /limit/)
  assert.throws(() => app.queue.cancel('b', first.id), /No queued/)
  app.queue.cancel('a', first.id)
  assert.throws(() => app.queue.cancel('a', first.id))
  await app.queue.tick()
  assert.equal(app.executed.length, 0)
  app.queue.remove('a', first.id)
  app.flags.fail = true
  app.queue.enqueue('a', '1', 'research', input)
  app.queue.enqueue('blocked', '1', 'research', input)
  app.flags.available = false
  await app.queue.tick()
  assert.equal(app.executed.length, 0)
  app.flags.available = true
  await app.queue.tick()
  assert.equal(app.executed.length, 1)
  assert.equal(app.queue.get('a').jobs[0]?.state, 'failed')
  assert.ok(!app.queue.get('a').jobs[0]?.error.includes('secret'))
  app.ports.execute = () =>
    Promise.reject(new UserError('Missing retained reference.'))
  app.queue.remove('a', app.queue.get('a').jobs[0]!.id)
  app.queue.enqueue('a', '1', 'summary', input)
  await app.queue.tick()
  assert.equal(app.queue.get('a').jobs[0]?.error, 'Missing retained reference.')
  assert.throws(
    () => setup({ maxJobBytes: 1 }).queue.enqueue('a', '1', 'research', input),
    /payload/
  )
})
void test('running paid work is never retried after restart; reminders recover conservatively', () => {
  const app = setup()
  const paid = app.queue.enqueue('a', '1', 'research', input)
  const reminder = app.queue.enqueue('a', '1', 'reminder', input)
  const state = app.queue.get('a')
  for (const job of state.jobs) job.state = 'running'
  app.store.putRecord('queue', 'a', state)
  const restarted = new Jobs(app.settings, app.ports, app.store, app.now)
  restarted.recover()
  assert.equal(
    restarted.get('a').jobs.find(job => job.id === paid.id)?.state,
    'uncertain'
  )
  assert.equal(
    restarted.get('a').jobs.find(job => job.id === reminder.id)?.state,
    'queued'
  )
  assert.equal(restarted.get('b').jobs.length, 0)
})
void test('overlapping ticks and cancellation do not commit late results or resurrect erased queues', async () => {
  const app = setup()
  let finish!: (result: ModelReply) => void
  let signal!: AbortSignal
  app.ports.execute = (_owner, _job, abort) => {
    signal = abort
    return new Promise(resolve => {
      finish = resolve
    })
  }
  let job = app.queue.enqueue('a', '1', 'research', input)
  let ticking = app.queue.tick()
  assert.equal(app.queue.get('a').jobs[0]?.state, 'running')
  await app.queue.tick()
  assert.throws(() => app.queue.remove('a', job.id), /Cancel/)
  app.queue.cancel('a', job.id)
  assert.equal(signal.aborted, true)
  finish({ text: 'Late', images: [] })
  await ticking
  assert.equal(app.queue.get('a').jobs[0]?.result, null)
  app.queue.remove('a', job.id)
  job = app.queue.enqueue('a', '1', 'research', input)
  ticking = app.queue.tick()
  app.queue.erase('a')
  assert.equal(signal.aborted, true)
  finish({ text: 'Late', images: [] })
  await ticking
  assert.equal(app.queue.get('a').jobs.length, 0)
  app.queue.enqueue('a', '1', 'research', input)
  ticking = app.queue.tick()
  app.queue.stop()
  assert.equal(signal.aborted, true)
  finish({ text: 'Late', images: [] })
  await ticking
  assert.equal(app.queue.get('a').jobs[0]?.result, null)
})
void test('due schedules coalesce missed intervals and obey bounded capacity', async () => {
  const app = setup()
  const once = app.queue.schedule(
    'a',
    '1',
    'reminder',
    '2026-01-01 00:01',
    'Remember this',
    'UTC'
  )
  const recurring = app.queue.schedule(
    'a',
    '2',
    'summary',
    'every 2h',
    'Weekly work',
    'UTC'
  )
  assert.throws(() =>
    app.queue.schedule('a', '1', 'reminder', 'every 1h', '', 'UTC')
  )
  assert.throws(() =>
    app.queue.schedule(
      'a',
      '1',
      'reminder',
      'every 1h',
      'x'.repeat(8001),
      'UTC'
    )
  )
  await app.queue.tick()
  assert.equal(app.queue.get('a').jobs.length, 0)
  app.advance(60000)
  await app.queue.tick()
  assert.equal(
    app.queue.get('a').schedules.some(item => item.id === once.id),
    false
  )
  assert.equal(app.executed.length, 0)
  assert.equal(app.queue.get('a').jobs[0]?.result?.text, 'Remember this')
  app.advance(10 * 86400000)
  await app.queue.tick()
  assert.equal(app.queue.get('a').jobs.length, 2)
  assert.equal(app.queue.get('a').schedules[0]?.dueAt, app.now() + 7200000)
  assert.equal(app.executed.length, 1)
  assert.throws(() => app.queue.unschedule('b', recurring.id), /not found/)
  app.queue.unschedule('a', recurring.id)
  const limited = setup({ maxSchedules: 1, maxJobs: 1 })
  limited.queue.schedule('a', '1', 'reminder', 'every 1m', 'one', 'UTC')
  assert.throws(
    () =>
      limited.queue.schedule('a', '1', 'reminder', 'every 1m', 'two', 'UTC'),
    /limit/
  )
  const first = limited.queue.enqueue('a', '1', 'research', input)
  limited.advance(60000)
  await limited.queue.tick()
  assert.equal(limited.queue.get('a').jobs.length, 1)
  limited.queue.remove('a', first.id)
  await limited.queue.tick()
  assert.equal(limited.queue.get('a').jobs[0]?.kind, 'reminder')
  const tiny = setup({ maxJobBytes: 1 })
  tiny.queue.schedule('a', '1', 'reminder', 'every 1m', 'one', 'UTC')
  tiny.advance(60000)
  await tiny.queue.tick()
  assert.equal(tiny.queue.get('a').jobs.length, 0)
  const threads = setup()
  const cancel = threads.queue.enqueue('a', '1', 'research', input)
  threads.queue.enqueue('a', '2', 'research', input)
  threads.queue.schedule('a', '1', 'reminder', 'every 1m', 'one', 'UTC')
  threads.queue.cancelThread('a', '1')
  assert.equal(
    threads.queue.get('a').jobs.find(job => job.id === cancel.id)?.state,
    'cancelled'
  )
  assert.equal(threads.queue.get('a').schedules.length, 0)
  new Jobs(config(), app.ports).enqueue('local', '1', 'research', input)
})

void test('idle worker ticks avoid repeated store scans or unchanged queue writes', async () => {
  const app = setup({ maxJobs: 1 })
  let reads = 0,
    writes = 0
  const records = app.store.records.bind(app.store),
    put = app.store.putRecord.bind(app.store)
  app.store.records = scope => {
    reads++
    return records(scope)
  }
  app.store.putRecord = (scope, key, value) => {
    writes++
    put(scope, key, value)
  }
  app.queue.schedule('a', '1', 'reminder', 'every 1m', 'one', 'UTC')
  app.queue.schedule('a', '1', 'reminder', 'every 1m', 'two', 'UTC')
  const before = writes
  await app.queue.tick()
  await app.queue.tick()
  assert.equal(reads, 1)
  assert.equal(writes, before)
  app.advance(60000)
  await app.queue.tick()
  assert.equal(app.queue.get('a').jobs.length, 1)
  assert.equal(app.queue.get('a').schedules[1]?.dueAt, app.now())
})

void test('batch enqueue is all-or-nothing, keeps per-file metadata and obeys capacity and payload bounds', () => {
  const settings = config(),
    store = new MemoryStateStore(),
    jobs = new Jobs(
      settings,
      {
        allowed: () => true,
        available: () => true,
        input: () => {
          throw new Error('unused')
        },
        execute: () => Promise.resolve({ text: 'Result', images: [] }),
        deliver: () => Promise.resolve()
      },
      store
    )
  const input = {
    prompt: 'Requested fields',
    documents: [
      { name: 'a.txt', mime: 'text/plain', data: 'YQ==' },
      { name: 'b.txt', mime: 'text/plain', data: 'Yg==' }
    ],
    images: [],
    instructions: '',
    memories: ['Do not snapshot notes']
  }
  for (const [action, value] of [
    ['bad', input],
    ['summarize', { ...input, documents: [] }],
    [
      'extract',
      {
        ...input,
        documents: Array.from({ length: 11 }, () => input.documents[0]!)
      }
    ],
    ['table', { ...input, prompt: 'x'.repeat(1001) }]
  ] as [string, JobInput][])
    assert.throws(() => jobs.enqueueBatch('a', '1', action, value))
  for (const action of ['summarize', 'extract', 'table']) {
    const group = jobs.enqueueBatch('a', '1', action, input)
    assert.equal(
      jobs.get('a').jobs.filter(job => job.batch?.group === group).length,
      2
    )
  }
  assert.deepEqual(jobs.get('a').jobs[0]!.input.memories, [])
  settings.maxJobs = 6
  assert.throws(() => jobs.enqueueBatch('a', '1', 'summarize', input))
  settings.maxJobs = 20
  settings.maxJobBytes = 1
  assert.throws(() => jobs.enqueueBatch('a', '1', 'summarize', input))
  assert.equal(jobs.get('a').jobs.length, 6)
})
