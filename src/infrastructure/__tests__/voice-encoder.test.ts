import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeVoice } from '../voice-encoder.js'

void test('native FFmpeg converts PCM to Telegram-compatible OGG/Opus without disk files', async () => {
  const output = Buffer.from(
    await encodeVoice(Buffer.alloc(4800), 'ffmpeg', 100000, 5000)
  )
  assert.equal(output.toString('ascii', 0, 4), 'OggS')
  assert.ok(output.includes(Buffer.from('OpusHead')))
  await assert.rejects(
    encodeVoice(Buffer.alloc(4800), 'ffmpeg', 1, 5000),
    /size|encoding/
  )
  await assert.rejects(
    encodeVoice(Buffer.alloc(4800), '/nonexistent/ffmpeg', 100000, 5000),
    /unavailable/
  )
})

void test('encoder handles an early stdin pipe closure without an unhandled error', async () => {
  // A real encoder that fails before consuming a large input can produce EPIPE.
  await assert.rejects(
    encodeVoice(Buffer.alloc(20000000), '/usr/bin/false', 100000, 5000),
    /encoding/
  )
})
