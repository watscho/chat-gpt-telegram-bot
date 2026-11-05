import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WorkSearch } from '../work-search.js'
import type { WorkSource } from '../work-search.js'
const source = (
  key: string,
  text: string,
  title = 'Notes',
  at = 1
): WorkSource => ({
  key,
  kind: 'note',
  title,
  text,
  at,
  thread: '1',
  project: null
})
void test('work search ranks owner-only keyword excerpts, preserves attribution and invalidates removed or changed sources', () => {
  let corpus = [
    source('a', 'Alpha launch costs', 'Alpha', 2),
    source('b', 'Other launch costs', 'Notes', 1),
    source('empty', ' '),
    source('long', `${'x'.repeat(11000)}launch details`, 'Long source')
  ]
  const search = new WorkSearch(owner => (owner === '42:42' ? corpus : []))
  const hits = search.search('42:42', 'launch costs')
  assert.equal(hits[0]!.id, search.open('42:42', hits[0]!.id).id)
  assert.ok(hits.some(hit => hit.title.includes('excerpt 2')))
  assert.equal(search.search('43:43', 'launch').length, 0)
  assert.ok(search.search('42:42', 'launches').length)
  assert.equal(search.search('42:42', 'impossible').length, 0)
  assert.equal(search.search('42:42', 'an').length, 0)
  for (const query of ['', 'x'.repeat(121), 'what where when', '!!!'])
    assert.throws(() => search.search('42:42', query))
  const id = hits[0]!.id
  corpus = [source('a', 'Changed material')]
  assert.throws(() => search.open('42:42', id), /no longer retained/)
})
void test('work search has deterministic ties, Unicode normalization, overlapping chunks and a hard corpus bound', () => {
  const corpus = [
      source('a', 'Café launch', 'launch', 2),
      source('b', 'Café launch', 'launch', 2),
      source('c', 'launch', 'launch', 3)
    ],
    search = new WorkSearch(() => corpus)
  assert.equal(search.search('owner', 'café').length, 2)
  assert.equal(search.search('owner', 'launch')[0]!.at, 3)
  assert.deepEqual(
    search.search('owner', 'launch'),
    search.search('owner', 'launch')
  )
  corpus.push(
    ...Array.from({ length: 10001 }, (_, index) =>
      source(String(index), 'launch')
    )
  )
  assert.throws(() => search.search('owner', 'launch'), /10000/)
})
