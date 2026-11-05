import type { Document, Image, ModelReply } from './conversation.js'

export interface JobInput {
  project?: string | null
  prompt: string
  documents: Document[]
  images: Image[]
  instructions: string
  memories: string[]
}
export interface Job {
  priority?: number
  notBefore?: number
  batch?: { group: string; action: string; file: string }
  id: string
  thread: string
  kind: 'research' | 'compare' | 'summary' | 'reminder' | 'batch'
  state:
    'queued' | 'running' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled'
  createdAt: number
  updatedAt: number
  input: JobInput
  result: ModelReply | null
  error: string
  delivery: 'pending' | 'queued' | 'suppressed' | 'sent' | 'failed'
  attempts: number
  nextDelivery: number
}
export interface Schedule {
  id: string
  thread: string
  kind: 'reminder' | 'summary'
  text: string
  timezone: string
  dueAt: number
  intervalMs: number | null
}
export interface QueueState {
  jobs: Job[]
  schedules: Schedule[]
}
