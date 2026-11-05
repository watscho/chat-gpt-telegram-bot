import type { ToolApproval, WorkbenchRequest } from './workbench.js'
export interface Evidence {
  label: string
  title: string
  text: string
  url?: string
}
export interface StructuredSpec {
  format: 'csv' | 'json'
  fields: string[]
}
export interface Artifact {
  rows: number
  name: string
  mime: 'application/json' | 'text/csv'
  data: string
}
export interface Image {
  data: string // Base64, never a provider or Telegram URL.
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
}

export interface Document {
  name: string
  mime: string
  data: string
}
export interface Source {
  title: string
  url: string
}

export interface Message {
  evidence?: Evidence[]
  id?: string
  role: 'user' | 'assistant'
  content: string
  images?: Image[]
  documents?: Document[]
}

export interface ModelReply {
  files?: Document[]
  approval?: ToolApproval
  artifact?: Artifact
  evidence?: Evidence[]
  text: string
  images: Image[]
  sources?: Source[]
  toolsUsed?: { images: number; searches: number }
}

export interface ReplyOptions {
  imageMask?: Image
  workbench?: WorkbenchRequest
  scope?: { owner: string; thread: string; project: string | null }
  structured?: StructuredSpec
  evidence?: Evidence[]
  action?: 'auto' | 'generate' | 'edit'
  signal?: AbortSignal
  onStart?: () => void
  onText?: (text: string) => Promise<void>
  instructions?: string
  imageQuality?: 'low' | 'medium' | 'high' | 'auto'
  imageSize?: 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
  enableImages?: boolean
  enableSearch?: boolean
  maxToolCalls?: number
  retentionSeconds?: number
  summary?: string
  chatModel?: string
  contextHistory?: Message[]
  references?: string
  search?: boolean
  memories?: string[]
  documents?: Document[]
}

export interface LanguageModel {
  reply(
    messages: readonly Message[],
    options?: ReplyOptions
  ): Promise<string | ModelReply>
  transcribe(
    audio: Uint8Array,
    signal?: AbortSignal,
    prompt?: string
  ): Promise<string>
}

export class UserError extends Error {}
