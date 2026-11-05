import { DeskElement, trigger } from './desk-helpers.js'
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
  s.channel.onmessage!({
    data: JSON.stringify({
      type: 'response.function_call_arguments.done',
      name: 'propose_action',
      call_id: 'call',
      arguments: '{}'
    })
  })
  await settle()
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
void test('visual voice UI captures only explicit frames and confirms proposed local actions through signed backend requests', async t => {
  const s = voiceSetup(),
    d = domSetup(),
    visual = new DeskElement(),
    preview = new DeskElement(),
    actions = new DeskElement(),
    nodes: Record<string, DeskElement> = {
      visual,
      'visual-review': preview,
      'action-review': actions
    },
    created: DeskElement[] = []
  const original = d.document.getElementById.bind(d.document)
  d.document.getElementById = id =>
    (nodes[id] as unknown as HTMLElement) ?? original(id)
  d.document.createElement = ((tag: string) => {
    const node = new DeskElement()
    node.tag = tag
    created.push(node)
    return node
  }) as typeof d.document.createElement
  let bad = false,
    fail = false,
    pending = false,
    holdFrame = false
  let release!: () => void
  const bodies: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', (url: unknown, options?: RequestInit) => {
    const path = String(url)
    const body = options?.body
      ? (JSON.parse(options.body as string) as Record<string, unknown>)
      : {}
    bodies.push(body)
    const result: unknown = path.endsWith('status')
      ? { enabled: true, seconds: 60, estimate: 1, project: null }
      : path.endsWith('offer')
        ? { id: 'rtc1', sdp: 'v=0', expiresAt: Date.now() + 60000 }
        : path.endsWith('/action')
          ? bad
            ? {}
            : {
                token: 'token',
                revision: 1,
                value: '{"kind":"task","text":"Review"}'
              }
          : path.endsWith('/confirm')
            ? bad
              ? {}
              : { output: 'Explicit action result', mission: null }
            : {}
    const response = () =>
      Promise.resolve(Response.json(result, { status: fail ? 400 : 200 }))
    if (
      (pending && path.endsWith('/action')) ||
      (holdFrame && path.endsWith('/frame'))
    )
      return new Promise<Response>(done => {
        release = () => {
          void response().then(done)
        }
      })
    return response()
  })
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')!
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      mediaDevices: {
        getUserMedia: () => Promise.resolve(s.media),
        getDisplayMedia: () => Promise.resolve(s.media)
      }
    },
    configurable: true
  })
  t.after(() => Object.defineProperty(globalThis, 'navigator', nav))
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
  const click = (parent: DeskElement, label: string) => {
    const button = parent.children.find(node => node.textContent === label)
    assert.ok(button, label)
    trigger(button, 'click')
  }
  click(visual, 'Capture camera frame')
  await settle()
  click(preview, 'Send this frame (uses API quota)')
  assert.equal(d.nodes.error!.hidden, false)
  click(preview, 'Discard frame')
  trigger(d.nodes.start!, 'click')
  await settle()
  s.channel.onopen!()
  click(visual, 'Capture camera frame')
  await settle()
  click(preview, 'Send this frame (uses API quota)')
  await settle()
  assert.match(s.channel.sent.at(-2)!, /input_image/)
  click(visual, 'Capture screen frame')
  await settle()
  click(preview, 'Discard frame')
  const call = () =>
    s.channel.onmessage!({
      data: JSON.stringify({
        type: 'response.function_call_arguments.done',
        name: 'propose_action',
        call_id: 'call',
        arguments: '{"kind":"task","text":"Review"}'
      })
    })
  call()
  await settle()
  click(actions, 'Confirm exact action')
  await settle()
  assert.match(s.channel.sent.at(-2)!, /function_call_output/)
  call()
  await settle()
  click(actions, 'Cancel action')
  await settle()
  assert.equal(bodies.at(-1)!.confirm, false)
  bad = true
  call()
  await settle()
  assert.equal(d.nodes.error!.hidden, false)
  bad = false
  call()
  await settle()
  bad = true
  click(actions, 'Confirm exact action')
  await settle()
  bad = false
  fail = true
  click(visual, 'Capture camera frame')
  await settle()
  click(preview, 'Send this frame (uses API quota)')
  await settle()
  fail = false
  holdFrame = true
  click(visual, 'Capture camera frame')
  await settle()
  const frameSend = preview.children.find(
    node => node.textContent === 'Send this frame (uses API quota)'
  )!
  click(preview, 'Send this frame (uses API quota)')
  click(preview, 'Send this frame (uses API quota)')
  await settle()
  trigger(d.nodes.stop!, 'click')
  await settle()
  release()
  await settle()
  holdFrame = false
  trigger(d.nodes.start!, 'click')
  await settle()
  s.channel.readyState = 'open'
  s.channel.onopen!()
  trigger(frameSend, 'click')
  pending = true
  call()
  await settle()
  await controller.stop()
  release()
  await settle()
  trigger(d.nodes.stop!, 'click')
  d.events.pagehide!()
  await settle()
})
