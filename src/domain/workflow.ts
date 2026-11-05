import type { JobInput } from './jobs.js'
export interface Task {
  delivery?: 'queued' | 'sent' | 'suppressed'
  id: string
  thread: string
  title: string
  status: 'open' | 'done'
  dueAt: number | null
  reminded: boolean
  attempts: number
  nextAttempt: number
}
export interface Approval {
  token: string
  thread: string
  revision: string | undefined
  expiresAt: number
  kind: 'job' | 'batch' | 'import'
  input: JobInput | string
  action: string
  estimate: number
}
export interface WorkflowState {
  tasks: Task[]
  glossary: Record<string, { term: string; meaning: string }[]>
  quotes: { message: number; thread: string; revision: string; text: string }[]
  approval: Approval | null
}
export interface Recap {
  decisions: string[]
  constraints: string[]
  questions: string[]
  context: string[]
}
