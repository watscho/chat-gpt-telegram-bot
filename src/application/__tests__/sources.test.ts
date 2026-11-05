import { test } from 'node:test'
import assert from 'node:assert/strict'
import { citeText, formatSources, sourceList } from '../sources.js'

void test('citations are deduplicated, bounded and rendered as numbered clickable sources', () => {
  const sources = sourceList([
    { title: 'Official\nDocs', url: 'https://example.com/docs' },
    { title: 'Official Docs', url: 'https://example.com/docs' },
    { title: 'bad', url: 'javascript:alert(1)' },
    { title: 'bad', url: 'https://user:pass@example.com' },
    { title: '', url: 'invalid' },
    { title: '', url: 'https://other.test' }
  ])
  assert.equal(sources.length, 2)
  assert.equal(sources[1]?.title, 'other.test')
  assert.equal(
    citeText(
      'Fact.',
      [{ title: 'Docs', url: 'https://example.com/docs', end_index: 5 }],
      sources
    ),
    'Fact. [1]'
  )
  assert.equal(
    citeText(
      'Fact.',
      [{ title: 'Docs', url: 'https://example.com/docs', end_index: 99 }],
      sources
    ),
    'Fact.'
  )
  assert.match(
    formatSources(sources),
    /1\. Official Docs\nhttps:\/\/example.com\/docs/
  )
  assert.equal(formatSources(), '')
  assert.equal(
    sourceList(
      Array.from({ length: 20 }, (_, n) => ({
        title: 'Source',
        url: `https://example.com/${n}`
      }))
    ).length,
    10
  )
})

void test('multiple citation positions, repeated references and unsafe annotations render consistently', () => {
  const sources = sourceList([
    { title: 'A', url: 'https://a.test' },
    { title: 'B', url: 'https://b.test' }
  ])
  const result = citeText(
    'First. Second.',
    [
      { title: 'B', url: 'https://b.test', end_index: 14 },
      { title: 'A', url: 'https://a.test', end_index: 6 },
      { title: 'B', url: 'https://b.test', end_index: 6 },
      { title: 'A', url: 'https://a.test', end_index: 6 },
      { title: 'bad', url: 'javascript:alert(1)', end_index: 0 },
      { title: 'missing', url: 'https://missing.test', end_index: 1 }
    ],
    sources
  )
  assert.equal(result, 'First. [1, 2] Second. [2]')
})
