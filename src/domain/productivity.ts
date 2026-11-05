import type { Document, Image, Message } from './conversation.js'

export interface PreparedRequest {
  prompt: string
  images: Image[]
  documents: Document[]
  memories: string[]
  instructions: string
  history: Message[]
  references: string
  analysisOnly: boolean
}
export interface ContextPart {
  id: string
  label: string
  kind:
    'history' | 'image' | 'document' | 'memory' | 'instructions' | 'references'
  value: string | Image | Document | Message[]
  enabled: boolean
}
export interface ContextDraft {
  token: string
  thread: string
  revision: string | undefined
  expiresAt: number
  prompt: string
  analysisOnly: boolean
  parts: ContextPart[]
}
export interface ProductivityState {
  collecting: Record<string, boolean>
  templates: { name: string; body: string }[]
  forwards: Record<string, { id: number; text: string }[]>
  feedback: {
    thread: string
    revision: string
    rating: 'up' | 'down'
    reason: string
    at: number
  }[]
  draft: ContextDraft | null
}
