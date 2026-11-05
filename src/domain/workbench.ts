import type {
  Document,
  Evidence,
  Message,
  ModelReply,
  ReplyOptions
} from './conversation.js'

export interface Connection {
  id: string
  owner: number
  title: string
  server: string
  tools: string[]
  authorization: string
}
export interface WorkbenchConfig {
  analysisModel: string
  meetingModel: string
  diarizationModel: string | null
  liveModel: string
  miniAppURL: string | null
  miniAppPort: number
  liveSeconds: number
  connections: Connection[]
  estimateAnalysis: number
  estimateIndex: number
  estimateConnection: number
  estimateLiveMinute: number
  estimateMeetingMinute: number
  meetingBytes: number
  meetingSeconds: number
}
export type WorkbenchRequest = (
  | { kind: 'analysis' }
  | { kind: 'index' }
  | { kind: 'knowledge' }
  | { kind: 'connection'; connection: string; continuation?: string }
) & { project: string | null }

export interface ToolApproval {
  connection: string
  continuation: string
  calls: { id: string; name: string; arguments: string }[]
}
export interface Resource {
  kind: 'file' | 'store' | 'container' | 'call'
  id: string
}
export interface RemoteFile {
  id: string
  name: string
  hash: string
  status: 'indexing' | 'completed' | 'failed'
  createdAt: number
  bytes: number
}
export interface Recording {
  file: string
  name: string
  mime: string
  bytes: number | null
  seconds: number | null
}
export interface WorkbenchState {
  recording: {
    token: string
    thread: string
    project: string | null
    revision: string | undefined
    expiresAt: number
    file: Recording
    diarize: boolean
  } | null
  projects: Record<string, { store: string; files: RemoteFile[] }>
  approval: {
    token: string
    thread: string
    revision: string | undefined
    expiresAt: number
    value: ToolApproval
  } | null
}
export interface SearchHit {
  file: string
  name: string
  text: string
  score: number
}
export interface MeetingTranscript {
  text: string
  speakers: boolean
  segments: { speaker: string; start: number; end: number; text: string }[]
}
export interface ProviderWorkbench {
  upload(
    file: Document,
    signal?: AbortSignal,
    ttlSeconds?: number
  ): Promise<string>
  container(files: string[], signal?: AbortSignal): Promise<string>
  analysis(
    container: string,
    prompt: string,
    options: ReplyOptions
  ): Promise<ModelReply>
  createStore(signal?: AbortSignal): Promise<string>
  attach(
    store: string,
    file: string,
    signal?: AbortSignal
  ): Promise<'indexing' | 'completed' | 'failed'>
  fileStatus(
    store: string,
    file: string,
    signal?: AbortSignal
  ): Promise<'indexing' | 'completed' | 'failed'>
  search(
    store: string,
    query: string,
    signal?: AbortSignal
  ): Promise<SearchHit[]>
  grounded(
    messages: readonly Message[],
    evidence: Evidence[],
    options: ReplyOptions
  ): Promise<ModelReply>
  connection(
    connection: Connection,
    messages: readonly Message[],
    options: ReplyOptions,
    continuation?: string
  ): Promise<ModelReply>
  meeting(
    bytes: Uint8Array,
    name: string,
    mime: string,
    diarize: boolean,
    signal?: AbortSignal
  ): Promise<MeetingTranscript>
  live(
    offer: string,
    instructions: string,
    signal?: AbortSignal
  ): Promise<{ id: string; sdp: string }>
  remove(resource: Resource): Promise<void>
}
