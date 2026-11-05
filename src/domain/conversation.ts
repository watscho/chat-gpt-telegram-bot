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
  role: 'user' | 'assistant'
  content: string
  images?: Image[]
  documents?: Document[]
}

export interface ModelReply {
  text: string
  images: Image[]
  sources?: Source[]
}

export interface ReplyOptions {
  action?: 'auto' | 'generate' | 'edit'
  search?: boolean
  memories?: string[]
  documents?: Document[]
}

export interface LanguageModel {
  reply(
    messages: readonly Message[],
    options?: ReplyOptions
  ): Promise<string | ModelReply>
  transcribe(audio: Uint8Array): Promise<string>
}

export class UserError extends Error {}
