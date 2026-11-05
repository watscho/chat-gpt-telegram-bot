import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Library, type LibraryFile } from '../library.js'
import { MemoryStateStore } from '../../__tests__/helpers.js'

const file = { name: 'Terms.txt', mime: 'text/plain', data: 'dGV4dA==' }
void test('library indexes once, replaces same-name versions, ranks citations and isolates owners/projects', async () => {
  const store = new MemoryStateStore()
  let calls = 0
  const library = new Library(() => {
    calls++
    return Promise.resolve([
      { location: 'page 1', text: 'Renewal payment termination' },
      { location: 'page 2', text: 'Payment '.repeat(160) },
      { location: 'page 3', text: ' ' }
    ])
  }, store)
  await assert.rejects(library.add('a', '', file))
  const first = await library.add('a', 'p', file)
  assert.equal((await library.add('a', 'p', file)).id, first.id)
  assert.equal(calls, 1)
  assert.equal(new Library(() => Promise.resolve([]), store).get('a').length, 1)
  const updated = await library.add('a', 'p', { ...file, data: 'bmV3' })
  assert.equal(updated.id, first.id)
  assert.equal(library.get('a').length, 1)
  await library.add('a', 'other', file)
  await library.add('a', 'p', { ...file, name: 'Extra.txt' })
  for (const query of ['', 'x'.repeat(1001)])
    assert.throws(() => library.search('a', 'p', query))
  assert.equal(library.search('b', 'p', 'payment').length, 0)
  assert.equal(library.search('a', 'p', '!!!').length, 0)
  assert.equal(library.search('a', 'p', 'unmatched').length, 0)
  const hits = library.search('a', 'p', 'renewal payment')
  assert.ok(hits[0]!.text.includes('Renewal'))
  assert.match(library.references(hits), /\[L1\].*page 1/)
  assert.equal(library.references([]), '')
  assert.throws(() => library.remove('a', 'other', first.id))
  library.remove('a', 'p', first.id)
  library.deleteProject('a', 'p')
  assert.equal(library.get('a').length, 1)
  library.erase('a')
  assert.equal(new Library(() => Promise.resolve([]), store).get('a').length, 0)
  new Library(() => Promise.resolve([])).erase('a')
})
void test('library rejects missing text, excessive extraction and full document/text budgets without partial writes', async () => {
  await assert.rejects(
    new Library(() => Promise.resolve([])).add('a', 'p', file),
    /No searchable/
  )
  await assert.rejects(
    new Library(() =>
      Promise.resolve([{ location: 'line 1', text: 'x'.repeat(1000001) }])
    ).add('a', 'p', file),
    /million/
  )
  const store = new MemoryStateStore()
  const full: LibraryFile[] = Array.from({ length: 500 }, (_, index) => ({
    id: String(index),
    project: 'p',
    name: `File${index}.txt`,
    digest: 'old',
    passages: []
  }))
  store.putRecord('library', 'a', full)
  await assert.rejects(
    new Library(() => Promise.resolve([]), store).add('a', 'p', file),
    /500/
  )
  let release!: (value: { location: string; text: string }[]) => void
  const racing = new Library(
    () =>
      new Promise(resolve => {
        release = resolve
      }),
    store
  )
  const pending = racing.add('a', 'p', { ...file, name: 'File0.txt' })
  store.putRecord('library', 'a', [
    ...full.filter(item => item.name !== 'File0.txt'),
    { ...full[0]!, name: 'Other.txt' }
  ])
  release([{ location: 'page 1', text: 'Valid' }])
  await assert.rejects(pending, /500/)
  const large = new MemoryStateStore()
  large.putRecord('library', 'a', [
    {
      ...full[0]!,
      passages: [{ location: 'page 1', text: 'x'.repeat(20000000) }]
    }
  ])
  await assert.rejects(
    new Library(
      () => Promise.resolve([{ location: 'line 1', text: 'Valid' }]),
      large
    ).add('a', 'p', file),
    /20 MB/
  )
  assert.equal(large.getRecord<LibraryFile[]>('library', 'a')!.length, 1)
})
