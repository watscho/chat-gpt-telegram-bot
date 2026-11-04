import { test } from 'node:test'
import assert from 'node:assert/strict'
import { downloadTelegramAudio } from '../src/infrastructure/telegram-audio.js'
const url = new URL('https://api.telegram.org/file/bot123/voice.oga')
const fetcher =
  (response: Response): typeof fetch =>
  () =>
    Promise.resolve(response)

void test('downloads OGG bytes with redirect and timeout restrictions', async () => {
  const audio = await downloadTelegramAudio(url, 10, 1000, (_url, options) => {
    assert.equal(options?.redirect, 'error')
    assert.ok(options?.signal)
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])))
  })
  assert.deepEqual([...audio], [1, 2, 3])
})
for (const link of [
  'http://api.telegram.org/file/bot1/a',
  'https://evil.test/file/bot1/a',
  'https://api.telegram.org/other',
  'https://user:pass@api.telegram.org/file/bot1/a',
  'https://api.telegram.org:444/file/bot1/a'
]) {
  void test(`rejects untrusted download URL: ${link}`, async () => {
    await assert.rejects(
      downloadTelegramAudio(new URL(link), 10, 1000, () => {
        throw new Error('must not fetch')
      }),
      /Invalid Telegram/
    )
  })
}
void test('rejects error status, missing body and empty audio', async () => {
  for (const response of [
    new Response('error', { status: 500 }),
    new Response(null),
    new Response('')
  ]) {
    await assert.rejects(
      downloadTelegramAudio(url, 10, 1000, fetcher(response))
    )
  }
})
void test('caps declared and actual download sizes', async () => {
  await assert.rejects(
    downloadTelegramAudio(
      url,
      2,
      1000,
      fetcher(new Response('abc', { headers: { 'content-length': '3' } }))
    ),
    /too large/
  )
  await assert.rejects(
    downloadTelegramAudio(url, 2, 1000, fetcher(new Response('abc'))),
    /too large/
  )
})
void test('network and stream failures reject instead of hanging', async () => {
  await assert.rejects(
    downloadTelegramAudio(url, 10, 1000, () =>
      Promise.reject(new Error('network'))
    )
  )
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new Error('broken'))
    }
  })
  await assert.rejects(
    downloadTelegramAudio(url, 10, 1000, fetcher(new Response(stream))),
    /broken/
  )
})

void test('HTTP errors cancel the body without buffering the error response', async () => {
  let cancelled = false
  const body = new ReadableStream({
    cancel() {
      cancelled = true
    }
  })
  await assert.rejects(
    downloadTelegramAudio(
      url,
      10,
      1000,
      fetcher(new Response(body, { status: 500 }))
    )
  )
  assert.equal(cancelled, true)
})
