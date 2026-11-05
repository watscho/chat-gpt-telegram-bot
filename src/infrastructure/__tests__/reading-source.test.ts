import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReadingFeed, readReadingSource } from '../reading-source.js'
import type { ArticlePorts } from '../article-reader.js'
const bytes = (text: string) => new TextEncoder().encode(text),
  base = 'https://example.com/feed'
void test('bounded RSS and Atom parsing resolves bases, strips markup, deduplicates links and preserves attribution', () => {
  const rss = parseReadingFeed(
    bytes(
      '<rss version="2.0"><channel><item><title><![CDATA[<b>Hello</b>]]></title><link>/a?utm_source=x</link><description><![CDATA[<script>bad()</script><p>Useful &amp; safe</p>]]></description><pubDate>Fri, 15 Jan 2027 08:00:00 GMT</pubDate></item><item><title>Duplicate</title><link>/a</link></item><item><title>Invalid</title><link>http://localhost</link></item><item><title>No URL</title></item><item><link>/empty-title</link></item></channel></rss>'
    ),
    base
  )
  assert.equal(rss.length, 1)
  assert.equal(rss[0]!.title, 'Hello')
  assert.equal(rss[0]!.url, 'https://example.com/a')
  assert.match(rss[0]!.excerpt, /Useful & safe/)
  assert.ok(rss[0]!.published)
  const atom = parseReadingFeed(
    bytes(
      '<feed xmlns="http://www.w3.org/2005/Atom" xml:base="/posts/"><entry xml:base="nested/"><title type="text">Entry</title><link rel="self" href="/feed"/><link rel="alternate" href="a"/><content>Body</content><updated>invalid</updated></entry><entry><title>Second</title><link href="b"/><summary>Summary</summary><published>2027-01-15T00:00Z</published></entry></feed>'
    ),
    base
  )
  assert.equal(atom[0]!.url, 'https://example.com/posts/nested/a')
  assert.equal(atom[0]!.published, null)
  assert.equal(atom[1]!.excerpt, 'Summary')
  assert.deepEqual(parseReadingFeed(bytes('<rss><channel/></rss>'), base), [])
  assert.deepEqual(
    parseReadingFeed(
      bytes('<feed><entry><title>Title</title></entry></feed>'),
      base
    ),
    []
  )
  for (const raw of [
    '',
    'plaintext',
    ' ',
    '<!DOCTYPE rss><rss/>',
    '<!ENTITY x "x"><rss/>',
    '<rss>' + '<a>'.repeat(34) + '</a>'.repeat(34) + '</rss>',
    '<rss><x></rss>',
    '<other/>',
    '<rss>' + '<a/>'.repeat(5001) + '</rss>',
    '<rss><channel>' + '<item/>'.repeat(101) + '</channel></rss>',
    'x'.repeat(1000001)
  ])
    assert.throws(() => parseReadingFeed(bytes(raw), base))
  assert.throws(() => parseReadingFeed(Uint8Array.of(255), base))
})
void test('source reader uses pinned public ports for feeds and pages and rejects unsupported MIME before parsing', async () => {
  let type = 'application/rss+xml',
    body = bytes(
      '<rss><channel><item><title>Entry</title><link>/a</link></item></channel></rss>'
    )
  const ports: ArticlePorts = {
    resolve: () => Promise.resolve([{ address: '8.8.8.8', family: 4 }]),
    get: () =>
      Promise.resolve({
        status: 200,

        type,
        encoding: '',
        body
      })
  }
  const signal = new AbortController().signal
  assert.equal(
    (await readReadingSource('rss', base, signal, ports))[0]!.title,
    'Entry'
  )
  type = 'application/json'
  await assert.rejects(readReadingSource('rss', base, signal, ports), /XML/)
  type = 'text/html'
  body = bytes(
    '<title>Page</title><p>' +
      'Useful text for daily reading. '.repeat(6) +
      '</p>'
  )
  assert.equal(
    (await readReadingSource('page', base, signal, ports))[0]!.title,
    'Page'
  )
})
