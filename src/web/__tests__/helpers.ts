import type { VoicePorts, VoiceState } from '../live-controller.js'
export function voiceSetup() {
  const track = {
    enabled: true,
    stops: 0,
    stop() {
      this.stops++
    }
  }
  const media = { getTracks: () => [track] } as unknown as MediaStream
  const channel = {
    readyState: 'open',
    sent: [] as string[],
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    send(value: string) {
      this.sent.push(value)
    },
    close() {
      this.readyState = 'closed'
    }
  }
  const peer = {
    connectionState: 'new',
    localDescription: null as { sdp?: string } | null,
    ontrack: null as ((event: { streams: MediaStream[] }) => void) | null,
    onconnectionstatechange: null as (() => void) | null,
    addTrack() {},
    createDataChannel: () => channel,
    createOffer: () => Promise.resolve({ type: 'offer', sdp: 'v=0' }),
    setLocalDescription: function (value: { sdp?: string }) {
      this.localDescription = value
      return Promise.resolve()
    },
    setRemoteDescription: async () => {},
    close() {}
  }
  const states: VoiceState[] = [],
    transcript: string[] = [],
    closed: string[] = []
  let tick = () => {},
    now = 0
  const ports: VoicePorts = {
    media: () => Promise.resolve(media),
    peer: () => peer as unknown as RTCPeerConnection,
    offer: () => Promise.resolve({ id: 'rtc1', sdp: 'v=0', expiresAt: 60000 }),
    close: id => {
      closed.push(id)
      return Promise.resolve()
    },
    play: async () => {},
    clearAudio: () => {},
    state: value => states.push(value),
    transcript: (speaker, text) => transcript.push(`${speaker}: ${text}`),
    now: () => now,
    every: callback => {
      tick = callback
      return 1
    },
    cancel: () => {}
  }
  return {
    track,
    media,
    channel,
    peer,
    ports,
    states,
    transcript,
    closed,
    tick: () => tick(),
    advance: () => {
      now = 60000
    }
  }
}
export async function settle() {
  await new Promise(resolve => setImmediate(resolve))
}
export class Element {
  textContent = ''
  disabled = false
  hidden = false
  value = 'conversation'
  autoplay = false
  srcObject: MediaStream | null = null
  dataset: Record<string, string> = {}
  scrollTop = 0
  scrollHeight = 100
  children: Element[] = []
  empty = true
  events: Record<string, () => void> = {}
  attributes: Record<string, string> = {}
  get childElementCount() {
    return this.children.length
  }
  get firstElementChild(): Element | undefined {
    const child = this.children[0]
    if (child)
      child.remove = () => {
        this.children.shift()
      }
    return child
  }
  remove() {}
  setAttribute(key: string, value: string) {
    this.attributes[key] = value
  }
  addEventListener(key: string, callback: () => void) {
    this.events[key] = callback
  }
  querySelector() {
    return this.empty ? {} : null
  }
  replaceChildren() {
    this.empty = false
    this.children = []
  }
  append(...values: Element[]) {
    this.children.push(...values)
  }
  play() {
    return Promise.resolve()
  }
  pause() {}
}
export function domSetup() {
  const nodes = Object.fromEntries(
    [
      'start',
      'stop',
      'mute',
      'interrupt',
      'mode',
      'status',
      'duration',
      'estimate',
      'signal',
      'error',
      'transcript',
      'project'
    ].map(id => [id, new Element()])
  )
  const created: Element[] = []
  const document = {
    baseURI: 'https://voice.example.com/voice/',
    getElementById: (id: string) => nodes[id] ?? null,
    createElement: () => {
      const value = new Element()
      created.push(value)
      return value
    }
  }
  const events: Record<string, () => void> = {}
  const window = {
    Telegram: { WebApp: { initData: 'signed', ready() {}, expand() {} } },
    addEventListener: (key: string, callback: () => void) => {
      events[key] = callback
    }
  }
  return {
    nodes,
    created,
    document: document as unknown as Document,
    window,
    events
  }
}
