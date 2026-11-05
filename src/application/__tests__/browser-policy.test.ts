import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserCall } from '../browser-policy.js'
import { deskSetup, owner } from '../../__tests__/desk.js'
void test('browser policy requires declared origin/tool and rejects nested navigation outside approved HTTPS scope', () => {
  const policy = {
    origins: ['https://example.com'],
    tools: ['click', 'navigate']
  }
  browserCall(
    policy,
    'click',
    '{"origin":"https://example.com","target":{"url":"https://example.com/a"},"data":[{"href":"https://example.com/b"},null,"text"]}'
  )
  for (const [tool, args] of [
    ['other', '{}'],
    ['click', 'x'.repeat(12001)],
    ['click', 'bad'],
    ['click', 'null'],
    ['click', '[]'],
    ['click', '{}'],
    ['click', '{"origin":1}'],
    ['click', '{"origin":"https://other.example.com"}'],
    ['click', '{"origin":"https://example.com","url":1}'],
    ['click', '{"origin":"https://example.com","url":"bad"}'],
    [
      'click',
      '{"origin":"https://example.com","url":"https://other.example.com"}'
    ],
    [
      'click',
      '{"origin":"https://example.com","url":"https://u:p@example.com"}'
    ]
  ])
    assert.throws(() => browserCall(policy, tool!, args!))
  let nested: unknown = { url: 'https://example.com' }
  for (let i = 0; i < 12; i++) nested = [nested]
  assert.throws(() =>
    browserCall(
      policy,
      'click',
      JSON.stringify({ origin: 'https://example.com', nested })
    )
  )
  const s = deskSetup()
  for (const [connection, origins, tools] of [
    ['missing', ['https://example.com'], ['send']],
    ['mail', [], ['send']],
    [
      'mail',
      Array.from({ length: 11 }, (_, i) => `https://example${i}.com`),
      ['send']
    ],
    ['mail', ['bad'], ['send']],
    ['mail', ['http://example.com'], ['send']],
    ['mail', ['https://example.com/path'], ['send']],
    ['mail', ['https://u:p@example.com'], ['send']],
    ['mail', ['https://example.com:8443'], ['send']],
    ['mail', ['https://example.com'], []],
    ['mail', ['https://example.com'], ['other']]
  ] as [string, string[], string[]][])
    assert.throws(() =>
      s.data.browser(owner, 'Browser', connection, origins, tools)
    )
})
