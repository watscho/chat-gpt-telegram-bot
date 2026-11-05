import { test } from 'node:test'
import assert from 'node:assert/strict'
import { downloadTelegramAudio } from '../telegram-audio.js'

void test('audio adapter delegates bounded downloads and retains voice-specific errors', async () => {
  const url = new URL('https://api.telegram.org/file/bot123/voice.oga')
  assert.deepEqual(
    [
      ...(await downloadTelegramAudio(url, 10, 1000, () =>
        Promise.resolve(new Response(new Uint8Array([1, 2])))
      ))
    ],
    [1, 2]
  )
  await assert.rejects(
    downloadTelegramAudio(url, 10, 1000, () =>
      Promise.resolve(new Response(''))
    ),
    /Voice message is empty/
  )
})
