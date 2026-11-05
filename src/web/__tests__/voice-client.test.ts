import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mountVoice } from '../voice-client.js'
import { voicePage, voiceStyles } from '../voice-page.js'
import { voiceSetup, domSetup, settle } from './helpers.js'
void test('voice page escapes paths and supplies accessible responsive controls', () => {
  const page = voicePage('/<&"/')
  assert.match(page, /&lt;&amp;&quot;/)
  assert.match(page, /aria-live="polite"/)
  assert.match(voiceStyles, /prefers-reduced-motion/)
  assert.match(page, /AI-generated voice/)
})
void test('voice UI renders scoped estimates, bounds plain-text transcripts and wires explicit controls through browser ports', async t => {
  const s = voiceSetup(),
    d = domSetup()
  let value: unknown = {
      enabled: true,
      seconds: 60,
      estimate: 1000000,
      project: 'Work'
    },
    ok = true
  const calls: { url: string; init: RequestInit | undefined }[] = []
  t.mock.method(
    globalThis,
    'fetch',
    (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: url instanceof Request ? url.url : String(url), init })
      return Promise.resolve(
        new Response(
          JSON.stringify(
            (url instanceof Request ? url.url : String(url)).endsWith('status')
              ? value
              : (url instanceof Request ? url.url : String(url)).endsWith(
                    'offer'
                  )
                ? { id: 'rtc1', sdp: 'v=0', expiresAt: Date.now() + 60000 }
                : {}
          ),
          { status: ok ? 200 : 403 }
        )
      )
    }
  )
  const navigation = Object.getOwnPropertyDescriptor(globalThis, 'navigator')!
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaDevices: { getUserMedia: () => Promise.resolve(s.media) } },
    configurable: true
  })
  t.after(() => Object.defineProperty(globalThis, 'navigator', navigation))
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    value: function () {
      return s.peer
    },
    configurable: true
  })
  t.after(() => Reflect.deleteProperty(globalThis, 'RTCPeerConnection'))
  t.mock.timers.enable({ apis: ['setInterval'] })
  const controller = mountVoice(d.document, d.window)
  await settle()
  assert.equal(d.nodes.start!.disabled, false)
  assert.match(d.nodes.project!.textContent, /Work/)
  d.nodes.start!.events.click!()
  await settle()
  s.channel.onopen!()
  d.nodes.mute!.events.click!()
  assert.equal(s.track.enabled, false)
  s.channel.onmessage!({ data: JSON.stringify({ type: 'response.created' }) })
  d.nodes.interrupt!.events.click!()
  for (let i = 0; i < 25; i++)
    s.channel.onmessage!({
      data: JSON.stringify({
        type: 'response.output_audio_transcript.done',
        transcript: '<script>literal</script>'
      })
    })
  assert.equal(d.nodes.transcript!.childElementCount, 40)
  assert.equal(
    d.nodes.transcript!.children.at(-1)!.textContent,
    '<script>literal</script>'
  )
  s.peer.ontrack!({ streams: [s.media] })
  await settle()
  t.mock.timers.tick(1000)
  d.nodes.stop!.events.click!()
  await settle()
  d.events.pagehide!()
  await controller.stop()
  assert.equal(
    calls.find(call => call.url.endsWith('close'))!.init!.keepalive,
    true
  )
  value = { enabled: true, seconds: 60, estimate: 1, project: null }
  const e = domSetup()
  mountVoice(e.document, e.window)
  await settle()
  assert.match(e.nodes.project!.textContent, /no project/)
  for (const invalid of [{ enabled: false }, null, [], true]) {
    value = invalid
    const x = domSetup()
    mountVoice(x.document, x.window)
    await settle()
    assert.equal(x.nodes.start!.disabled, true)
  }
  ok = false
  const failed = domSetup()
  mountVoice(failed.document, failed.window)
  await settle()
  assert.equal(failed.nodes.status!.textContent, 'Access unavailable')
  ok = true
  value = { enabled: true, seconds: 60, estimate: 1 }
  const badOffer = domSetup()
  const oldFetch = globalThis.fetch
  t.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, init?: RequestInit) =>
      (url instanceof Request ? url.url : String(url)).endsWith('offer')
        ? new Response('{}')
        : oldFetch(url, init)
  )
  const bad = mountVoice(badOffer.document, badOffer.window)
  await settle()
  await bad.start('conversation')
  assert.match(badOffer.nodes.error!.textContent, /Invalid voice/)
  for (const window of [
    { addEventListener() {} },
    { Telegram: {}, addEventListener() {} },
    {
      Telegram: { WebApp: { initData: '', ready() {}, expand() {} } },
      addEventListener() {}
    }
  ]) {
    const x = domSetup()
    mountVoice(x.document, window)
    assert.equal(x.nodes.start!.disabled, true)
  }
  assert.throws(
    () => mountVoice({ ...d.document, getElementById: () => null }, d.window),
    /incomplete/
  )
})
