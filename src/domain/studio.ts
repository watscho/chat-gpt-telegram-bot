import type { DeskSpec } from './desk.js'
import type { RoutineSpec } from './routine.js'
import type { WorkflowSpec } from './suite.js'
import type { Document, Image, ModelReply } from './conversation.js'
import type { JobInput } from './jobs.js'
import type { Recording, ToolApproval } from './workbench.js'
export interface InboxItem {
  id: string
  source: string
  thread: string
  project: string | null
  kind: 'text' | 'link' | 'files' | 'recording'
  text: string
  documents: Document[]
  images: Image[]
  recording: Recording | null
  createdAt: number
}
export interface MissionStep {
  desk?: DeskSpec
  routine?: RoutineSpec
  workflow?: WorkflowSpec
  kind: 'compose' | 'search' | 'analysis' | 'connection' | 'media' | 'local'
  title: string
  prompt: string
  connection: string | null
  state: 'queued' | 'running' | 'review' | 'done' | 'uncertain'
  estimate: number
  attempt: number
  events: { at: number; state: string; text: string }[]
  receipt: { at: number; text: string } | null
  output: ModelReply | null
  approval: { token: string; expiresAt: number; value: ToolApproval } | null
  continuation: string | null
}
export interface ResultVersion {
  id: string
  parent: string | null
  label: string
  createdAt: number
  reply: ModelReply
}
export interface Mission {
  id: string
  thread: string
  project: string | null
  title: string
  mode: 'autopilot' | 'research' | 'chain' | 'workflow'
  revision: number
  state:
    | 'draft'
    | 'queued'
    | 'running'
    | 'review'
    | 'paused'
    | 'uncertain'
    | 'done'
    | 'cancelled'
  createdAt: number
  expiresAt: number
  input: JobInput
  steps: MissionStep[]
  versions: ResultVersion[]
  noticeRevision: number
  selected: string | null
}
export interface StudioState {
  collecting: Record<string, boolean>
  inbox: InboxItem[]
  missions: Mission[]
}
export interface StudioPorts {
  allowed(owner: string): boolean
  available(owner: string, thread: string): boolean
  notify(owner: string, mission: Mission): Promise<void>
  execute(
    owner: string,
    mission: Mission,
    step: MissionStep,
    signal: AbortSignal
  ): Promise<ModelReply>
}
