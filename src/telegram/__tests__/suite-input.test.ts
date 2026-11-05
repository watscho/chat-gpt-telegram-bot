import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suiteMessage, suiteVideo } from '../suite-input.js'
import type { Message } from 'telegraf/types'
const message = (content: Record<string, unknown>) =>
  ({
    message_id: 1,
    date: 1,
    chat: { id: 42, type: 'private' },
    ...content
  }) as Message
void test('Suite media metadata accepts only selected Telegram video containers and preserves missing metadata explicitly', () => {
  assert.equal(suiteMessage(undefined), undefined)
  assert.equal(suiteMessage(undefined, true), undefined)
  const text = message({ text: 'Text' }),
    reply = message({ text: 'Reply' })
  assert.equal(suiteMessage(text), text)
  assert.equal(suiteMessage(text, true), undefined)
  assert.equal(suiteMessage(message({ reply_to_message: reply })), reply)
  assert.equal(suiteVideo(undefined), undefined)
  assert.equal(suiteVideo(text), undefined)
  assert.equal(
    suiteVideo(message({ document: { file_id: 'id', file_unique_id: 'u' } })),
    undefined
  )
  const video = suiteVideo(
    message({
      video: {
        file_id: 'id',
        file_unique_id: 'u',
        duration: 12,
        width: 100,
        height: 100
      }
    })
  )!
  assert.equal(video.name, 'recording.mp4')
  assert.equal(video.bytes, null)
  assert.equal(video.seconds, 12)
  const document = suiteVideo(
    message({
      document: {
        file_id: 'id',
        file_unique_id: 'u',
        file_name: 'clip.webm',
        file_size: 100
      }
    })
  )!
  assert.equal(document.name, 'clip.webm')
  assert.equal(document.bytes, 100)
  assert.equal(document.seconds, null)
  assert.equal(
    suiteVideo(
      message({
        document: { file_id: 'id', file_unique_id: 'u', mime_type: 'video/mp4' }
      })
    )!.name,
    'recording.mp4'
  )
})
