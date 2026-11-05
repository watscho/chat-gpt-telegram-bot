import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
let mode = 'ok',
  lookedUp = false
mock.module('node:dns/promises', {
  namedExports: {
    lookup: () => Promise.resolve([{ address: '8.8.8.8', family: 4 }])
  }
})
mock.module('node:https', {
  namedExports: {
    request: (
      _url: URL,
      options: {
        agent: boolean
        rejectUnauthorized: boolean
        lookup: (
          host: string,
          opts: object,
          done: (
            error: null,
            address: string | { address: string; family: number }[],
            family?: number
          ) => void
        ) => void
      },
      callback: (
        response: EventEmitter & {
          statusCode: number | undefined
          headers: Record<string, string>
          destroy(): void
        }
      ) => void
    ) => {
      assert.equal(options.agent, false)
      assert.equal(options.rejectUnauthorized, true)
      options.lookup('example.com', {}, (error, address, family) => {
        assert.equal(error, null)
        assert.equal(address, '8.8.8.8')
        assert.equal(family, 4)
        lookedUp = true
      })
      options.lookup('example.com', { all: true }, (error, address) => {
        assert.equal(error, null)
        assert.deepEqual(address, [{ address: '8.8.8.8', family: 4 }])
      })
      const req = new EventEmitter() as EventEmitter & { end(): void }
      req.end = () => {
        if (mode === 'request-error') {
          req.emit('error', new Error('secret'))
          return
        }
        const response = Object.assign(new EventEmitter(), {
          statusCode: mode === 'missing-status' ? undefined : 200,
          headers:
            mode === 'headers'
              ? {
                  'content-type': 'text/html',
                  'content-encoding': 'identity',
                  location: '/new'
                }
              : {},
          destroy() {}
        })
        callback(response)
        if (mode === 'response-error') {
          response.emit('error', new Error('stream'))
          return
        }
        response.emit(
          'data',
          Buffer.from(
            mode === 'large'
              ? 'x'.repeat(1000001)
              : 'Readable content '.repeat(10)
          )
        )
        response.emit('end')
      }
      return req
    }
  }
})
const {
  readArticle,
  articleText,
  articleURL,
  publicArticleAddress,
  articlePorts
} = await import('../article-reader.js')
import type { ArticlePorts, ArticleResponse } from '../article-reader.js'
const result: ArticleResponse = {
  status: 200,
  type: 'text/html; charset=utf-8',
  body: Buffer.from(
    '<title>Example &amp; title</title><p>Readable article text '.repeat(8) +
      '</p>'
  )
}
const ports = (response: ArticleResponse = result): ArticlePorts => ({
  resolve: () => Promise.resolve([{ address: '8.8.8.8', family: 4 }]),
  get: () => Promise.resolve(response)
})
void test('article URLs and DNS destinations exclude credentials, IP literals and private/reserved networks', () => {
  for (const link of [
    'bad',
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com:444',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://a.local',
    'https://example.com.',
    'https://example.com/' + 'x'.repeat(2048)
  ])
    assert.throws(() => articleURL(link))
  assert.equal(
    articleURL('https://example.com/a#fragment').href,
    'https://example.com/a'
  )
  for (const address of [
    'bad',
    '127.0.0.1',
    '10.1.1.1',
    '100.64.1.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::ffff:8.8.8.8',
    'fc00::1',
    '2001:db8::1',
    '2002::1',
    '3fff::1',
    '3ffe::1'
  ])
    assert.equal(publicArticleAddress(address), false, address)
  assert.equal(publicArticleAddress('8.8.8.8'), true)
  assert.equal(publicArticleAddress('2606:4700:4700::1111'), true)
})
void test('article text extraction strips active content, decodes bounded entities and reports truncation', () => {
  const raw =
    '<title>T &amp; Q</title><!-- ignored --><script>secret</script><style>bad</style><noscript>hidden</noscript><svg>vector</svg><p>' +
    'Visible &lt; &GT; &quot; &apos; &nbsp; &#65; &#x42; &#0; &#x110000; &#55296; text '.repeat(
      10
    ) +
    '</p>'
  const text = articleText(Buffer.from(raw), true)
  assert.equal(text.title, 'T & Q')
  const unicode = articleText(
    Buffer.from(
      'İ'.repeat(10) +
        '<TITLE>Unicode</TITLE><SCRIPT>secret</SCRIPT>' +
        'Read me '.repeat(20)
    ),
    true
  )
  assert.equal(unicode.title, 'Unicode')
  assert.ok(!unicode.text.includes('secret'))
  assert.ok(text.text.includes('A B'))
  assert.ok(!text.text.includes('secret'))
  assert.ok(!text.text.includes('ignored'))
  assert.equal(
    articleText(Buffer.from('a'.repeat(20001)), false).truncated,
    true
  )
  assert.equal(
    articleText(Buffer.from('<p>' + 'word '.repeat(20) + '</p>'), true).title,
    'Article'
  )
  for (const malformed of [
    '<!-- unfinished',
    '<script>secret',
    '<script>secret</script',
    '<unfinished',
    '<title',
    '<title>missing close',
    '<title></title>',
    '<>'
  ]) {
    const parsed = articleText(
      Buffer.from('Readable plain text '.repeat(10) + malformed),
      true
    )
    assert.ok(!parsed.text.includes('secret'))
    assert.equal(parsed.title, 'Article')
  }
  assert.equal(
    articleText(
      Buffer.from('<title><b>Nested</b></title>' + 'text '.repeat(20)),
      true
    ).title,
    'Nested'
  )
  assert.throws(() => articleText(Buffer.from('short'), false))
  assert.throws(() => articleText(new Uint8Array([255]), false))
})
void test('reader validates redirects, public DNS, MIME, byte limits and cancellation before model work', async () => {
  assert.equal(
    (await readArticle('https://example.com', undefined, ports())).title,
    'Example & title'
  )
  const redirect = ports()
  let calls = 0
  redirect.get = () =>
    Promise.resolve(
      ++calls === 1 ? { ...result, status: 302, location: '/next' } : result
    )
  assert.equal(
    (await readArticle('https://example.com', undefined, redirect)).url,
    'https://example.com/next'
  )
  for (const resolve of [
    [],
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: '8.8.8.8', family: 6 }],
    [
      { address: '8.8.8.8', family: 4 },
      { address: '::1', family: 6 }
    ]
  ])
    await assert.rejects(
      readArticle('https://example.com', undefined, {
        ...ports(),
        resolve: () => Promise.resolve(resolve)
      })
    )
  for (const response of [
    { ...result, status: 403 },
    { ...result, status: 302 },
    { ...result, status: 301, location: 'http://example.com' },
    { ...result, status: 302, location: '/again' },
    { ...result, encoding: 'gzip' },
    { ...result, type: 'image/png' },
    { ...result, type: 'text/plain; charset=latin1' },
    { ...result, body: Buffer.alloc(1000001) }
  ])
    await assert.rejects(
      readArticle('https://example.com', undefined, ports(response))
    )
  assert.ok(
    (
      await readArticle(
        'https://example.com',
        undefined,
        ports({ ...result, type: 'text/plain', encoding: 'identity' })
      )
    ).text
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    readArticle('https://example.com', controller.signal, ports()),
    /safely/
  )
  await assert.rejects(
    readArticle('https://example.com', undefined, {
      ...ports(),
      resolve: () => Promise.reject(new Error('private'))
    }),
    /safely/
  )
  const abort = new AbortController()
  await assert.rejects(
    readArticle('https://example.com', abort.signal, {
      ...ports(),
      resolve: () => {
        abort.abort()
        return Promise.resolve([{ address: '8.8.8.8', family: 4 }])
      }
    }),
    /safely/
  )
})
void test('pinned HTTPS transport bounds streams and sanitizes request failures using only controlled doubles', async () => {
  assert.deepEqual(await articlePorts.resolve('example.com'), [
    { address: '8.8.8.8', family: 4 }
  ])
  for (mode of ['ok', 'headers', 'missing-status']) {
    const response = await articlePorts.get(
      new URL('https://example.com'),
      { address: '8.8.8.8', family: 4 },
      new AbortController().signal
    )
    assert.ok(response.body.length)
  }
  assert.equal(lookedUp, true)
  for (mode of ['request-error', 'response-error', 'large'])
    await assert.rejects(
      articlePorts.get(
        new URL('https://example.com'),
        { address: '8.8.8.8', family: 4 },
        new AbortController().signal
      )
    )
})
