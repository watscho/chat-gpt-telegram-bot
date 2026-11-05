import { test } from 'node:test'
import assert from 'node:assert/strict'
import { meetingAudio } from '../meeting-audio.js'
void test('meeting files require matching supported audio signatures and safe output names without native decoding', () => {
  for (const [name, data, mime] of [
    ['note.ogg', Buffer.from('OggSdata'), 'audio/ogg'],
    ['note.mp3', Buffer.from('ID3data'), 'audio/mpeg'],
    ['frames.mp3', Buffer.from([255, 224, 0]), 'audio/mpeg'],
    ['note.wav', Buffer.from('RIFF0000WAVEdata'), 'audio/wav'],
    ['note.mp4', Buffer.from('0000ftypdata'), 'audio/mp4'],
    ['note.m4a', Buffer.from('0000ftypdata'), 'audio/mp4'],
    ['note.webm', Buffer.from('1a45dfa300', 'hex'), 'audio/webm']
  ] as const)
    assert.equal(meetingAudio(data, name).mime, mime)
  assert.equal(
    meetingAudio(Buffer.from('OggSdata'), '../../note.ogg').name,
    'note.ogg'
  )
  for (const [name, data] of [
    ['wrong.wav', Buffer.from('OggSdata')],
    ['bad.mp3', Buffer.from([0, 224])],
    ['bad.mp3', Buffer.from([255, 1])],
    ['bad.wav', Buffer.from('RIFF0000NOPE')],
    ['empty.mp3', Buffer.from('')],
    ['other.txt', Buffer.from('plain')]
  ] as const)
    assert.throws(() => meetingAudio(data, name))
})
