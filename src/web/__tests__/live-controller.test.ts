import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VoiceController } from '../live-controller.js'
import { voiceSetup, settle } from './helpers.js'
void test('voice controller owns microphone lifetime, state, transcripts and expiry with injected RTC ports', async () => {
  const s = voiceSetup(),
    c = new VoiceController(s.ports)
  c.mute()
  c.interrupt()
  await c.start('language')
  await c.start('language')
  s.channel.onopen!()
  c.mute()
  assert.equal(s.track.enabled, false)
  c.mute()
  c.interrupt()
  for (const data of [
    '{',
    'null',
    '[]',
    '1',
    ...[
      'response.created',
      'output_audio_buffer.started',
      'response.done',
      'output_audio_buffer.stopped',
      'input_audio_buffer.speech_started',
      'response.output_audio_transcript.done',
      'conversation.item.input_audio_transcription.completed',
      'error',
      'unknown'
    ].map(type => JSON.stringify({ type, transcript: 'hello' })),
    JSON.stringify({
      type: 'response.output_audio_transcript.done',
      transcript: 1
    }),
    JSON.stringify({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 1
    })
  ])
    s.channel.onmessage!({ data })
  assert.deepEqual(s.transcript, ['Assistant: hello', 'You: hello'])
  s.peer.ontrack!({ streams: [] })
  s.peer.ontrack!({ streams: [s.media] })
  s.ports.play = () => Promise.reject(new Error('blocked'))
  s.peer.ontrack!({ streams: [s.media] })
  await settle()
  assert.match(s.states.at(-1)!.error, /playback/)
  s.peer.onconnectionstatechange!()
  s.advance()
  s.tick()
  await settle()
  assert.deepEqual(s.closed, ['rtc1'])
  assert.equal(s.track.stops, 1)
  await c.stop()
  c.interrupt()
})
void test('voice failures and connection loss close local devices without paid retries', async () => {
  for (const state of ['failed', 'disconnected', 'closed']) {
    const s = voiceSetup(),
      c = new VoiceController(s.ports)
    await c.start('conversation')
    s.ports.close = () => Promise.reject(new Error('uncertain'))
    s.peer.connectionState = state
    s.peer.onconnectionstatechange!()
    await settle()
    assert.match(s.states.at(-1)!.error, /cleanup is pending/)
  }
  for (const failure of [new Error('Permission'), 'denied']) {
    const s = voiceSetup()
    s.ports.media = () =>
      new Promise<MediaStream>((_resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Browser ports can reject with non-Error values.
        reject(failure)
      })
    const c = new VoiceController(s.ports)
    await c.start('conversation')
    assert.equal(s.states.at(-1)!.phase, 'error')
  }
  const s = voiceSetup()
  s.peer.createOffer = () =>
    Promise.resolve({ type: 'offer', sdp: undefined as unknown as string })
  s.peer.setLocalDescription = async () => {}
  const c = new VoiceController(s.ports)
  await c.start('conversation')
  await c.stop()
  const x = voiceSetup()
  x.peer.localDescription = {}
  x.peer.setLocalDescription = async () => {}
  const d = new VoiceController(x.ports)
  await d.start('conversation')
  await d.stop()
})
void test('stopping each awaited opening phase rejects stale media, offers, channels and timers', async () => {
  for (const phase of ['media', 'local', 'offer', 'remote']) {
    const s = voiceSetup(),
      c = new VoiceController(s.ports)
    let release!: () => void
    const pause = new Promise<void>(resolve => {
      release = resolve
    })
    if (phase === 'media')
      s.ports.media = async () => {
        await pause
        return s.media
      }
    if (phase === 'local')
      s.peer.setLocalDescription = async () => {
        await pause
      }
    if (phase === 'offer')
      s.ports.offer = async () => {
        await pause
        return { id: 'late', sdp: 'v=0', expiresAt: 60000 }
      }
    if (phase === 'remote')
      s.peer.setRemoteDescription = async () => {
        await pause
      }
    const start = c.start('conversation')
    await settle()
    const open = s.channel.onopen,
      message = s.channel.onmessage,
      connection = s.peer.onconnectionstatechange
    await c.stop()
    release()
    await start
    open?.()
    message?.({ data: '{}' })
    if (connection) {
      s.peer.connectionState = 'failed'
      connection()
    }
    assert.equal(s.states.at(-1)!.phase, 'ended')
    assert.equal(
      s.states.some(state => state.remaining > 0),
      false
    )
  }
  const s = voiceSetup(),
    c = new VoiceController(s.ports)
  let reject!: (reason: unknown) => void
  s.ports.media = () =>
    new Promise((_resolve, fail) => {
      reject = fail
    })
  const start = c.start('conversation')
  await c.stop()
  reject(new Error('late'))
  await start
})
void test('live visual/tool events require an active owned session and produce explicit Realtime items without automatic local effects', async () => {
  const s = voiceSetup(),
    actions: { id: string; call: string; args: string }[] = []
  s.ports.action = (id, call, args) => {
    actions.push({ id, call, args })
    return Promise.resolve()
  }
  const controller = new VoiceController(s.ports)
  assert.equal(controller.session(), null)
  assert.throws(() => controller.frame('data:image/jpeg;base64,QQ=='))
  assert.throws(() => controller.toolResult('call', 'Result'))
  await controller.start('conversation')
  s.channel.onopen!()
  controller.frame('data:image/jpeg;base64,QQ==')
  assert.match(s.channel.sent.at(-2)!, /input_image/)
  controller.toolResult('call', 'Explicit result')
  assert.match(s.channel.sent.at(-2)!, /function_call_output/)
  for (const event of [
    {
      type: 'response.function_call_arguments.done',
      name: 'other',
      call_id: 'call',
      arguments: '{}'
    },
    {
      type: 'response.function_call_arguments.done',
      name: 'propose_action',
      call_id: 1,
      arguments: '{}'
    },
    {
      type: 'response.function_call_arguments.done',
      name: 'propose_action',
      call_id: 'call',
      arguments: 1
    },
    {
      type: 'response.function_call_arguments.done',
      name: 'propose_action',
      call_id: 'call',
      arguments: '{"kind":"task","text":"Review"}'
    }
  ])
    s.channel.onmessage!({ data: JSON.stringify(event) })
  assert.equal(actions.length, 1)
  assert.equal(actions[0]!.id, 'rtc1')
  assert.throws(() => controller.frame('invalid'))
  assert.throws(() =>
    controller.frame('data:image/jpeg;base64,' + 'x'.repeat(1500001))
  )
  assert.throws(() => controller.toolResult('bad id', 'x'))
  assert.throws(() => controller.toolResult('call', 'x'.repeat(16001)))
  s.ports.action = () => Promise.reject(new Error('failed'))
  s.channel.onmessage!({
    data: JSON.stringify({
      type: 'response.function_call_arguments.done',
      name: 'propose_action',
      call_id: 'call',
      arguments: '{}'
    })
  })
  await settle()
  assert.match(s.states.at(-1)!.error, /No action/)
  await controller.stop()
})
