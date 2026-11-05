export type UiLanguage = 'en' | 'ru' | 'es'
export interface Bookmark {
  id: string
  title: string
  text: string
  tags: string[]
  createdAt: number
}
export interface Notice {
  id: string
  kind: 'job' | 'task'
  target: string
  thread: string
  title: string
  queuedAt: number
  attempts: number
  nextAttempt: number
}
export interface ExperienceState {
  language: UiLanguage
  quiet: { start: number; end: number } | null
  digestMinutes: number
  bookmarks: Bookmark[]
  notices: Notice[]
}
