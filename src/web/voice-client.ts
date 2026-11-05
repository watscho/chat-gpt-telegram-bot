import { VoiceController, type VoiceState } from './live-controller.js'
interface TelegramApp {
  initData: string
  ready(): void
  expand(): void
}
export interface VoiceWindow {
  Telegram?: { WebApp?: TelegramApp }
  addEventListener(type: string, callback: () => void): void
}
export function mountVoice(
  document: Document,
  window: VoiceWindow
): VoiceController {
  const get = <T extends HTMLElement>(id: string) => {
    const node = document.getElementById(id)
    if (!node) throw new Error('Voice interface is incomplete.')
    return node as T
  }
  const start = get<HTMLButtonElement>('start'),
    stop = get<HTMLButtonElement>('stop'),
    mute = get<HTMLButtonElement>('mute'),
    interrupt = get<HTMLButtonElement>('interrupt'),
    mode = get<HTMLSelectElement>('mode'),
    status = get('status'),
    duration = get('duration'),
    estimate = get('estimate'),
    signal = get('signal'),
    error = get('error'),
    transcript = get('transcript'),
    project = get('project')
  const telegram = window.Telegram?.WebApp,
    initData = telegram?.initData ?? ''
  telegram?.ready()
  telegram?.expand()
  const audio = document.createElement('audio')
  audio.autoplay = true
  const request = async (
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(new URL(`api/${path}`, document.baseURI), {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Telegram-Init-Data': initData,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body
        ? { body: JSON.stringify(body), keepalive: path === 'close' }
        : {})
    })
    const value: unknown = await response.json()
    if (
      !response.ok ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    )
      throw new Error(
        'Voice access or provider request failed. Reopen this screen from the bot and check your quota.'
      )
    return value as Record<string, unknown>
  }
  const update = (state: VoiceState) => {
    const active =
      state.phase === 'connecting' ||
      state.phase === 'connected' ||
      state.phase === 'speaking'
    start.disabled = active || !initData
    stop.disabled = !active
    mute.disabled = !active || state.phase === 'connecting'
    interrupt.disabled = state.phase !== 'speaking'
    mode.disabled = active
    status.textContent = {
      idle: 'Ready',
      connecting: 'Connecting…',
      connected: 'Listening',
      speaking: 'Assistant speaking',
      ended: 'Session ended',
      error: 'Unable to connect'
    }[state.phase]
    signal.dataset.state = state.phase
    duration.textContent = state.remaining
      ? `${Math.floor(state.remaining / 60)}:${String(state.remaining % 60).padStart(2, '0')} left`
      : 'Microphone off'
    mute.textContent = state.muted ? 'Unmute microphone' : 'Mute microphone'
    mute.setAttribute('aria-pressed', String(state.muted))
    error.textContent = state.error
    error.hidden = !state.error
  }
  const controller = new VoiceController({
    media: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    peer: () => new RTCPeerConnection(),
    offer: async (sdp, mode) => {
      const value = await request('offer', { sdp, mode })
      if (
        typeof value.id !== 'string' ||
        typeof value.sdp !== 'string' ||
        typeof value.expiresAt !== 'number'
      )
        throw new Error('Invalid voice connection response.')
      return { id: value.id, sdp: value.sdp, expiresAt: value.expiresAt }
    },
    close: async id => {
      await request('close', { id })
    },
    play: async stream => {
      audio.srcObject = stream
      await audio.play()
    },
    clearAudio: () => {
      audio.pause()
      audio.srcObject = null
    },
    state: update,
    transcript: (speaker, text) => {
      if (transcript.querySelector('.empty')) transcript.replaceChildren()
      const label = document.createElement('b'),
        line = document.createElement('p')
      label.textContent = speaker
      line.textContent = text
      transcript.append(label, line)
      while (transcript.childElementCount > 40)
        transcript.firstElementChild?.remove()
      transcript.scrollTop = transcript.scrollHeight
    },
    now: () => Date.now(),
    every: callback => setInterval(callback, 1000),
    cancel: timer => clearInterval(timer as ReturnType<typeof setInterval>)
  })
  start.addEventListener('click', () => {
    void controller.start(mode.value)
  })
  stop.addEventListener('click', () => {
    void controller.stop()
  })
  mute.addEventListener('click', () => controller.mute())
  interrupt.addEventListener('click', () => controller.interrupt())
  window.addEventListener('pagehide', () => {
    void controller.stop()
  })
  if (!initData) {
    status.textContent = 'Open this screen from the Telegram bot.'
    start.disabled = true
  } else
    void request('status')
      .then(value => {
        if (
          value.enabled !== true ||
          typeof value.seconds !== 'number' ||
          typeof value.estimate !== 'number'
        )
          throw new Error(
            'Live voice is unavailable. Ask the operator to check setup.'
          )
        project.textContent =
          typeof value.project === 'string'
            ? `Project estimate charged to: ${value.project}`
            : 'Uses your owner budget; no project is selected.'
        start.disabled = false
        status.textContent = 'Ready when you are'
        duration.textContent = `Up to ${String(value.seconds)} seconds`
        estimate.textContent = `Estimated $${(Number(value.estimate) / 1000000).toFixed(2)}`
      })
      .catch(() => {
        start.disabled = true
        status.textContent = 'Access unavailable'
        error.hidden = false
        error.textContent =
          'Reopen this screen from the bot, or ask the operator to check live voice setup.'
      })
  return controller
}
if (typeof document !== 'undefined' && typeof window !== 'undefined')
  mountVoice(document, window)
