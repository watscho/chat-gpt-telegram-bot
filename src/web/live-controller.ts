export interface VoiceState {
  phase: 'idle' | 'connecting' | 'connected' | 'speaking' | 'ended' | 'error'
  muted: boolean
  remaining: number
  error: string
}
export interface VoicePorts {
  media(): Promise<MediaStream>
  peer(): RTCPeerConnection
  offer(
    sdp: string,
    mode: string
  ): Promise<{ id: string; sdp: string; expiresAt: number }>
  close(id: string): Promise<void>
  play(stream: MediaStream): Promise<void>
  clearAudio(): void
  state(value: VoiceState): void
  transcript(speaker: string, text: string): void
  now(): number
  every(callback: () => void): unknown
  cancel(timer: unknown): void
}
export class VoiceController {
  private generation = 0
  private media: MediaStream | null = null
  private peer: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private id: string | null = null
  private timer: unknown = null
  private current: VoiceState = {
    phase: 'idle',
    muted: false,
    remaining: 0,
    error: ''
  }
  constructor(private readonly ports: VoicePorts) {}
  private update(patch: Partial<VoiceState>): void {
    this.current = { ...this.current, ...patch }
    this.ports.state({ ...this.current })
  }
  async start(mode: string): Promise<void> {
    if (
      this.current.phase === 'connecting' ||
      this.current.phase === 'connected' ||
      this.current.phase === 'speaking'
    )
      return
    const generation = ++this.generation
    this.update({ phase: 'connecting', error: '', muted: false })
    try {
      const media = await this.ports.media()
      if (generation !== this.generation) {
        for (const track of media.getTracks()) track.stop()
        return
      }
      this.media = media
      const peer = this.ports.peer()
      this.peer = peer
      for (const track of media.getTracks()) peer.addTrack(track, media)
      peer.ontrack = event => {
        const stream = event.streams[0]
        if (stream)
          void this.ports.play(stream).catch(() => {
            this.update({
              error:
                'Audio playback was blocked. End the session and try again.'
            })
          })
      }
      peer.onconnectionstatechange = () => {
        if (
          generation === this.generation &&
          (peer.connectionState === 'failed' ||
            peer.connectionState === 'disconnected' ||
            peer.connectionState === 'closed')
        )
          void this.stop()
      }
      const channel = peer.createDataChannel('oai-events')
      this.channel = channel
      channel.onopen = () => {
        if (generation === this.generation) {
          this.update({ phase: 'connected' })
          channel.send(JSON.stringify({ type: 'response.create' }))
        }
      }
      channel.onmessage = event => {
        if (generation === this.generation) this.event(String(event.data))
      }
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      if (generation !== this.generation) return
      const call = await this.ports.offer(
        peer.localDescription?.sdp ?? offer.sdp ?? '',
        mode
      )
      if (generation !== this.generation) {
        await this.ports.close(call.id)
        return
      }
      this.id = call.id
      await peer.setRemoteDescription({ type: 'answer', sdp: call.sdp })
      if (generation !== this.generation) return
      const update = () => {
        const remaining = Math.max(
          0,
          Math.ceil((call.expiresAt - this.ports.now()) / 1000)
        )
        this.update({ remaining })
        if (!remaining) void this.stop()
      }
      this.timer = this.ports.every(update)
      update()
    } catch (error) {
      if (generation !== this.generation) return
      await this.stop()
      this.update({
        phase: 'error',
        error:
          error instanceof Error
            ? error.message
            : 'Unable to connect. Check microphone permission and reopen from Telegram.'
      })
    }
  }
  private event(raw: string): void {
    let event: Record<string, unknown>
    try {
      const value: unknown = JSON.parse(raw)
      if (!value || typeof value !== 'object' || Array.isArray(value)) return
      event = value as Record<string, unknown>
    } catch {
      return
    }
    if (
      event.type === 'response.created' ||
      event.type === 'output_audio_buffer.started'
    )
      this.update({ phase: 'speaking' })
    else if (
      event.type === 'response.done' ||
      event.type === 'output_audio_buffer.stopped' ||
      event.type === 'input_audio_buffer.speech_started'
    )
      this.update({ phase: 'connected' })
    else if (
      event.type === 'response.output_audio_transcript.done' &&
      typeof event.transcript === 'string'
    )
      this.ports.transcript('Assistant', event.transcript.slice(0, 8000))
    else if (
      event.type === 'conversation.item.input_audio_transcription.completed' &&
      typeof event.transcript === 'string'
    )
      this.ports.transcript('You', event.transcript.slice(0, 8000))
    else if (event.type === 'error')
      this.update({
        error:
          'The voice service reported an error. End this session before trying again.'
      })
  }
  mute(): void {
    if (!this.media) return
    const muted = !this.current.muted
    for (const track of this.media.getTracks()) track.enabled = !muted
    this.update({ muted })
  }
  interrupt(): void {
    if (this.channel?.readyState === 'open')
      this.channel.send(JSON.stringify({ type: 'response.cancel' }))
  }
  async stop(): Promise<void> {
    this.generation++
    if (this.timer !== null) this.ports.cancel(this.timer)
    this.timer = null
    for (const track of this.media?.getTracks() ?? []) track.stop()
    this.media = null
    this.channel?.close()
    this.channel = null
    const peer = this.peer
    this.peer = null
    if (peer) {
      peer.onconnectionstatechange = null
      peer.close()
    }
    this.ports.clearAudio()
    const id = this.id
    this.id = null
    this.update({ phase: 'ended', remaining: 0, muted: false })
    if (id) {
      try {
        await this.ports.close(id)
      } catch {
        this.update({
          error:
            'Microphone stopped. Server cleanup is pending; the session deadline still applies.'
        })
      }
    }
  }
}
