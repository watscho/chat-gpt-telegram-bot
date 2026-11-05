import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evidenceCards } from '../evidence.js'
void test('evidence cards bound excerpts, preserve provenance labels and refuse unsafe link targets', () => {
  const cards = evidenceCards([
    {
      label: 'L1',
      title: 'File page 2',
      text: 'Excerpt\u0000with controls\t\n\r'
    },
    {
      label: 'wrong',
      title: 'x'.repeat(300),
      text: 'x'.repeat(1500),
      url: 'javascript:alert(1)'
    },
    {
      label: 'W1',
      title: 'Web',
      text: 'Answer excerpt',
      url: 'https://example.com/page'
    }
  ])
  assert.equal(cards[0]!.text, 'Excerptwith controls\t\n\r')
  assert.equal(cards[1]!.label, 'S2')
  assert.equal(cards[1]!.url, undefined)
  assert.equal(cards[1]!.text.length, 1200)
  assert.equal(cards[1]!.title.length, 256)
  assert.equal(cards[2]!.url, 'https://example.com/page')
  assert.equal(
    evidenceCards(Array.from({ length: 17 }, () => cards[0]!)).length,
    16
  )
})
