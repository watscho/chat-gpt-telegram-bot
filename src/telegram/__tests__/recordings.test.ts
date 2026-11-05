import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recordingMeta } from '../recordings.js'
const base = {
  message_id: 1,
  date: 1,
  chat: { id: 42, type: 'private' as const, first_name: 'User' }
}
void test('recording metadata identifies supported Telegram audio and documents without downloading or inferring missing durations', () => {
  assert.equal(recordingMeta(undefined), undefined)
  assert.equal(recordingMeta({ ...base, text: 'text' }), undefined)
  const voice = {
    ...base,
    voice: { file_id: 'voice', file_unique_id: 'v', duration: 60 }
  }
  assert.equal(recordingMeta(voice)!.mime, 'audio/ogg')
  assert.equal(recordingMeta(voice)!.bytes, null)
  assert.equal(
    recordingMeta({
      ...voice,
      voice: { ...voice.voice, mime_type: 'audio/ogg', file_size: 1000 }
    })!.bytes,
    1000
  )
  const audio = {
    ...base,
    audio: { file_id: 'audio', file_unique_id: 'a', duration: 120 }
  }
  assert.equal(recordingMeta(audio)!.name, 'recording.mp3')
  assert.equal(
    recordingMeta({
      ...audio,
      audio: {
        ...audio.audio,
        file_name: 'call.m4a',
        mime_type: 'audio/mp4',
        file_size: 2000
      }
    })!.name,
    'call.m4a'
  )
  const document = {
    ...base,
    document: {
      file_id: 'document',
      file_unique_id: 'd',
      file_name: 'meeting.wav'
    }
  }
  assert.equal(recordingMeta(document)!.seconds, null)
  assert.equal(recordingMeta(document)!.mime, 'application/octet-stream')
  assert.equal(
    recordingMeta({
      ...document,
      document: {
        ...document.document,
        mime_type: 'audio/wav',
        file_size: 1000
      }
    })!.bytes,
    1000
  )
  assert.equal(
    recordingMeta({
      ...document,
      document: { file_id: 'x', file_unique_id: 'x' }
    }),
    undefined
  )
  assert.equal(
    recordingMeta({
      ...document,
      document: { ...document.document, file_name: 'other.pdf' }
    }),
    undefined
  )
})
