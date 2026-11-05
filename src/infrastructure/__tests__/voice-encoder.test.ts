import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

let last: {
  child: EventEmitter
  stdin: EventEmitter
  stdout: EventEmitter
  kills: string[]
  input?: Uint8Array
}
let argumentsUsed: unknown[]
mock.module('node:child_process', {
  exports: {
    spawn: (...args: unknown[]) => {
      argumentsUsed = args
      const child = new EventEmitter()
      const stdin = new EventEmitter()
      const stdout = new EventEmitter()
      last = { child, stdin, stdout, kills: [] }
      return Object.assign(child, {
        stdin: Object.assign(stdin, {
          end: (input: Uint8Array) => {
            last.input = input
          }
        }),
        stdout,
        kill: (signal: string) => {
          last.kills.push(signal)
        }
      })
    }
  }
})
const { encodeVoice } = await import('../voice-encoder.js')

void test('encoder uses fixed arguments, streams bytes and accepts only an OGG success result', async () => {
  const pcm = new Uint8Array([0, 0])
  const pending = encodeVoice(pcm, 'trusted-ffmpeg', 100, 1000)
  assert.equal(argumentsUsed[0], 'trusted-ffmpeg')
  assert.ok((argumentsUsed[1] as string[]).includes('libopus'))
  assert.equal((argumentsUsed[2] as { stdio: string[] }).stdio[2], 'ignore')
  assert.deepEqual(last.input, pcm)
  last.stdout.emit('data', Buffer.from('OggSvoice'))
  last.child.emit('close', 0)
  assert.equal(Buffer.from(await pending).toString(), 'OggSvoice')
})
void test('encoder rejects overflow, process errors and invalid output; stdin errors are contained', async () => {
  let pending = encodeVoice(new Uint8Array(), 'ffmpeg', 1, 1000)
  last.stdout.emit('data', Buffer.from('large'))
  assert.deepEqual(last.kills, ['SIGKILL'])
  await assert.rejects(pending, /size/)
  pending = encodeVoice(new Uint8Array(), 'missing', 100, 1000)
  last.stdin.emit('error', new Error('pipe closed'))
  last.child.emit('error', new Error('private path'))
  await assert.rejects(pending, /unavailable/)
  for (const code of [1, 0]) {
    pending = encodeVoice(new Uint8Array(), 'ffmpeg', 100, 1000)
    last.child.emit('close', code)
    await assert.rejects(pending, /encoding/)
  }
})

void test('voice encoding receives a combined caller cancellation signal', async () => {
  const controller = new AbortController()
  controller.abort()
  const pending = encodeVoice(
    new Uint8Array(),
    'ffmpeg',
    100,
    1000,
    controller.signal
  )
  assert.equal(
    (argumentsUsed[2] as { signal: AbortSignal }).signal.aborted,
    true
  )
  last.child.emit('error', new Error('aborted'))
  await assert.rejects(pending, /timed out/)
})
