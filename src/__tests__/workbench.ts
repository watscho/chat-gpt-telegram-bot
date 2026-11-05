import type {
  Connection,
  MeetingTranscript,
  ProviderWorkbench,
  Resource,
  SearchHit
} from '../domain/workbench.js'
import type {
  Document,
  Evidence,
  Message,
  ModelReply,
  ReplyOptions
} from '../domain/conversation.js'
export class FakeWorkbench implements ProviderWorkbench {
  calls: { method: string; value: unknown }[] = []
  failure = ''
  next = 0
  status: 'indexing' | 'completed' | 'failed' = 'completed'
  hits: SearchHit[] = []
  answer: ModelReply = {
    text: 'Analysis ready.',
    images: [],
    files: [
      {
        name: 'result.csv',
        mime: 'text/csv',
        data: Buffer.from('name,total\nA,10').toString('base64')
      }
    ]
  }
  transcript: MeetingTranscript = {
    text: 'Decided to review the draft. No deadline stated.',
    speakers: false,
    segments: []
  }
  private record(method: string, value: unknown): void {
    this.calls.push({ method, value: structuredClone(value) })
    if (this.failure === method) throw new Error('provider-private-error')
  }
  upload(
    file: Document,
    _signal?: AbortSignal,
    ttlSeconds?: number
  ): Promise<string> {
    this.record('upload', { file, ttlSeconds })
    return Promise.resolve(`file-${++this.next}`)
  }
  container(files: string[]): Promise<string> {
    this.record('container', files)
    return Promise.resolve(`cnt-${++this.next}`)
  }
  analysis(
    container: string,
    prompt: string,
    options: ReplyOptions
  ): Promise<ModelReply> {
    this.record('analysis', {
      container,
      prompt,
      instructions: options.instructions
    })
    return Promise.resolve(structuredClone(this.answer))
  }
  createStore(): Promise<string> {
    this.record('createStore', null)
    return Promise.resolve(`vs-${++this.next}`)
  }
  attach(
    store: string,
    file: string
  ): Promise<'indexing' | 'completed' | 'failed'> {
    this.record('attach', { store, file })
    return Promise.resolve(this.status)
  }
  fileStatus(
    store: string,
    file: string
  ): Promise<'indexing' | 'completed' | 'failed'> {
    this.record('fileStatus', { store, file })
    return Promise.resolve(this.status)
  }
  search(store: string, query: string): Promise<SearchHit[]> {
    this.record('search', { store, query })
    return Promise.resolve(structuredClone(this.hits))
  }
  grounded(
    messages: readonly Message[],
    evidence: Evidence[],
    _options: ReplyOptions
  ): Promise<ModelReply> {
    this.record('grounded', {
      messages,
      evidence,
      instructions: _options.instructions
    })
    return Promise.resolve({
      text: 'Grounded answer [K1]',
      images: [],
      evidence
    })
  }
  connection(
    connection: Connection,
    messages: readonly Message[],
    _options: ReplyOptions,
    continuation?: string
  ): Promise<ModelReply> {
    this.record('connection', {
      connection: connection.id,
      messages,
      continuation
    })
    return Promise.resolve(
      continuation
        ? { text: 'External result received.', images: [] }
        : {
            text: 'Approval required.',
            images: [],
            approval: {
              connection: connection.id,
              continuation: 'captured-input',
              calls: [
                {
                  id: 'approval-1',
                  name: connection.tools[0]!,
                  arguments: '{"query":"draft"}'
                }
              ]
            }
          }
    )
  }
  meeting(
    bytes: Uint8Array,
    name: string,
    mime: string,
    diarize: boolean
  ): Promise<MeetingTranscript> {
    this.record('meeting', { bytes: [...bytes], name, mime, diarize })
    return Promise.resolve(structuredClone(this.transcript))
  }
  live(
    offer: string,
    instructions: string
  ): Promise<{ id: string; sdp: string }> {
    this.record('live', { offer, instructions })
    return Promise.resolve({ id: `rtc-${++this.next}`, sdp: 'v=0\r\nanswer' })
  }
  remove(resource: Resource): Promise<void> {
    this.record('remove', resource)
    return Promise.resolve()
  }
}
