import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Experience } from '../experience.js'
import { MemoryStateStore } from '../../__tests__/helpers.js'
void test('delivery preferences validate local quiet windows, timezone boundaries and separate UI language', () => {
  let now = Date.parse('2026-11-05T23:00:00Z')
  const store = new MemoryStateStore(),
    data = new Experience(store, () => now)
  assert.equal(data.shouldQueue('a', 'UTC'), false)
  for (const lang of ['en', 'ru', 'es']) data.language('a', lang)
  assert.throws(() => data.language('a', 'unknown'))
  for (const expr of [
    'bad',
    '24:00-08:00',
    '22:60-08:00',
    '22:00-24:00',
    '22:00-08:60',
    '08:00-08:00'
  ])
    assert.throws(() => data.quiet('a', expr))
  data.quiet('a', '22:00-08:00')
  assert.equal(data.isQuiet('a', 'UTC'), true)
  assert.equal(data.shouldQueue('a', 'UTC'), true)
  now = Date.parse('2026-11-06T07:59:00Z')
  assert.equal(data.isQuiet('a', 'UTC'), true)
  now = Date.parse('2026-11-06T08:00:00Z')
  assert.equal(data.isQuiet('a', 'UTC'), false)
  data.quiet('a', '09:00-17:00')
  assert.equal(data.isQuiet('a', 'UTC'), false)
  now = Date.parse('2026-11-06T10:00:00Z')
  assert.equal(data.isQuiet('a', 'UTC'), true)
  now = Date.parse('2026-11-06T18:00:00Z')
  assert.equal(data.isQuiet('a', 'UTC'), false)
  data.quiet('a', 'off')
  for (const minutes of [-1, 1, 4, 1441, 1.5])
    assert.throws(() => data.digest('a', minutes))
  data.digest('a', 5)
  assert.equal(data.shouldQueue('a', 'UTC'), true)
  data.digest('a', 0)
  assert.equal(new Experience(store).get('a').language, 'es')
  assert.equal(data.get('b').language, 'en')
  data.refresh('a')
  assert.equal(data.get('a').language, 'es')
})
void test('bookmarks deduplicate privately, validate tags and bounds and survive conversation reset', () => {
  const data = new Experience()
  for (const [title, body] of [
    ['', 'Text'],
    ['x'.repeat(81), 'Text'],
    ['Title', ''],
    ['Title', 'x'.repeat(4001)]
  ])
    assert.throws(() => data.bookmark('a', title!, body!))
  for (const tags of [
    [''],
    ['x'.repeat(25)],
    ['bad tag'],
    Array.from({ length: 11 }, (_, index) => `t${index}`)
  ])
    assert.throws(() => data.bookmark('a', 'Title', 'Text', tags))
  const saved = data.bookmark('a', 'Title', 'Useful answer', [
    'Work',
    'work',
    ' Docs '
  ])
  assert.deepEqual(saved.tags, ['work', 'docs'])
  assert.equal(data.bookmark('a', 'Other', 'Useful answer').id, saved.id)
  assert.equal(data.find('a', '#work').length, 1)
  assert.equal(data.find('a', 'USEFUL').length, 1)
  assert.equal(data.find('b', '').length, 0)
  assert.throws(() => data.find('a', 'x'.repeat(121)))
  data.editBookmark('a', saved.id, ['Personal'])
  assert.equal(data.find('a', '#work').length, 0)
  assert.throws(() => data.editBookmark('b', saved.id, []))
  data.deleteThread('a', '1')
  assert.equal(data.get('a').bookmarks.length, 1)
  for (let i = 1; i < 100; i++) data.bookmark('a', `Title ${i}`, `Text ${i}`)
  assert.throws(() => data.bookmark('a', 'Overflow', 'Overflow'))
  data.editBookmark('a', saved.id, null)
  assert.equal(data.get('a').bookmarks.length, 99)
  const state = data.get('a')
  state.bookmarks[0]!.text = 'x'.repeat(1000000)
  assert.throws(() => data.save('a', state), /1 MB/)
  data.erase('a')
  assert.equal(data.get('a').bookmarks.length, 0)
})
void test('notification inbox limits, deduplication, suppression and explicit delivery retries remain owner scoped', () => {
  const store = new MemoryStateStore(),
    data = new Experience(store)
  const notice = {
    kind: 'job' as const,
    target: 'job',
    thread: '1',
    title: 'Result'
  }
  data.enqueue('a', notice)
  data.enqueue('a', notice)
  assert.equal(data.get('a').notices.length, 1)
  assert.throws(() => data.removeNotice('b', 'job-job'))
  assert.throws(() => data.retryNotice('b', 'job-job'))
  data.retryNotice('a', 'job-job')
  for (let i = 1; i < 100; i++)
    data.enqueue('a', { ...notice, target: String(i), thread: '2' })
  assert.throws(
    () => data.enqueue('a', { ...notice, target: 'overflow' }),
    /100/
  )
  data.removeNotice('a', 'job-job')
  data.deleteThread('a', '2')
  assert.equal(data.get('a').notices.length, 0)
  data.erase('a')
  assert.equal(store.getRecord('experience', 'a'), undefined)
})
void test('digest delivery persists attempts before effects, groups bounded items, and preserves newly queued work', async () => {
  let now = 0,
    sent = 0
  const store = new MemoryStateStore(),
    data = new Experience(store, () => now)
  data.digest('a', 5)
  data.enqueue('a', { kind: 'task', target: '1', thread: '1', title: 'Due' })
  assert.equal(
    await data.flush('a', 'UTC', () => {
      sent++
      return Promise.resolve()
    }),
    0
  )
  data.quiet('a', '00:00-01:00')
  now = 300000
  assert.equal(
    await data.flush('a', 'UTC', () => {
      sent++
      return Promise.resolve()
    }),
    0
  )
  await data.flush(
    'a',
    'UTC',
    items => {
      sent++
      assert.equal(items.length, 1)
      assert.equal(
        store.getRecord<{ notices: { attempts: number }[] }>('experience', 'a')!
          .notices[0]!.attempts,
        1
      )
      data.enqueue('a', { kind: 'job', target: '2', thread: '1', title: 'New' })
      return Promise.resolve()
    },
    true
  )
  assert.equal(data.get('a').notices.length, 1)
  data.quiet('a', 'off')
  now = 600000
  for (let i = 0; i < 3; i++) {
    await assert.rejects(
      data.flush('a', 'UTC', () => Promise.reject(new Error('transport')))
    )
    assert.equal(await data.flush('a', 'UTC', () => Promise.resolve()), 0)
    now += 60000
  }
  assert.equal(await data.flush('a', 'UTC', () => Promise.resolve()), 0)
  data.retryNotice('a', 'job-2')
  await data.flush('a', 'UTC', () => Promise.resolve(), true)
  assert.equal(data.get('a').notices.length, 0)
  data.enqueue('a', {
    kind: 'job',
    target: '3',
    thread: '1',
    title: 'Disk failure'
  })
  const put = store.putRecord.bind(store)
  store.putRecord = () => {
    throw new Error('Disk unavailable')
  }
  await assert.rejects(
    data.flush(
      'a',
      'UTC',
      () => {
        sent++
        return Promise.resolve()
      },
      true
    )
  )
  assert.equal(sent, 1)
  store.putRecord = put
})
void test('notification worker recovers owners, obeys allowlists, serializes ticks and clears deleted items without resurrection', async () => {
  let now = 1000
  const store = new MemoryStateStore(),
    data = new Experience(store, () => now)
  data.enqueue('a', { kind: 'job', target: '1', thread: '1', title: 'Ready' })
  const restored = new Experience(store, () => now)
  await restored.tick(
    () => false,
    () => 'UTC',
    () => {
      throw new Error('Not allowed')
    }
  )
  await restored.tick(
    () => true,
    () => 'UTC',
    async (_owner, items) => {
      assert.equal(items.length, 1)
      await restored.tick(
        () => true,
        () => 'UTC',
        () => Promise.resolve()
      )
      restored.deleteThread('a', '1')
    }
  )
  assert.equal(restored.get('a').notices.length, 0)
  for (let i = 0; i < 11; i++)
    restored.enqueue('a', {
      kind: 'job',
      target: String(i),
      thread: '1',
      title: 'Many'
    })
  now++
  assert.equal(
    await restored.flush('a', 'UTC', items => {
      assert.equal(items.length, 10)
      return Promise.resolve()
    }),
    10
  )
  await restored.tick(
    () => true,
    () => 'UTC',
    () => Promise.resolve()
  )
  assert.equal(restored.get('a').notices.length, 0)
  const local = new Experience()
  await local.tick(
    () => true,
    () => 'UTC',
    () => Promise.resolve()
  )
  local.erase('none')
})

void test('manual and worker digest flushes cannot claim the same owner concurrently', async () => {
  const data = new Experience()
  data.enqueue('a', { kind: 'job', target: '1', thread: '1', title: 'Ready' })
  await data.flush('a', 'UTC', async () => {
    assert.equal(
      await data.flush(
        'a',
        'UTC',
        () => Promise.reject(new Error('Duplicate transport')),
        true
      ),
      0
    )
  })
  data.enqueue('a', { kind: 'job', target: '2', thread: '1', title: 'Failure' })
  await assert.rejects(
    data.flush('a', 'UTC', () => Promise.reject(new Error('Transport')))
  )
  assert.equal(await data.flush('a', 'UTC', () => Promise.resolve()), 0)
})
