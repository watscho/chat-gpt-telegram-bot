export type Focus = 'work' | 'study' | 'personal'
export interface TaskProposal {
  title: string
  dueAt: number | null
}
export interface DailyState {
  onboarding: Focus | null
  onboarded: boolean
  notes: boolean
  favorites: string[]
  recent: string[]
  pending: {
    scenario: string
    thread: string
    revision: string | undefined
    expiresAt: number
  } | null
  plan: {
    token: string
    thread: string
    revision: string | undefined
    expiresAt: number
    summary: string
    warnings: string[]
    items: TaskProposal[]
  } | null
  morning: {
    time: string
    date: string
    attempts: number
    nextAttempt: number
    sent: boolean
  } | null
}
