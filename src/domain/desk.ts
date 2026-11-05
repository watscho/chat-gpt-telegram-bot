import type { Image, Document } from './conversation.js'
import type { SourceQuote } from './suite.js'
export interface DeskScope {
  thread: string
  project: string | null
}
export interface CanvasVersion {
  id: string
  text: string
  at: number
  label: string
}
export interface CanvasDocument extends DeskScope {
  id: string
  title: string
  language: string
  revision: number
  text: string
  versions: CanvasVersion[]
}
export interface DeskAssistant {
  id: string
  title: string
  instructions: string
  model: string | null
  tools: string[]
  sources: SourceQuote[]
  revision: number
}
export interface DataTable extends DeskScope {
  id: string
  title: string
  columns: string[]
  rows: (string | null)[][]
  revision: number
  source: string
  versions: { id: string; rows: (string | null)[][]; at: number }[]
}
export interface PhotoProject extends DeskScope {
  id: string
  title: string
  images: { id: string; image: Image; label: string; at: number }[]
  revision: number
}
export interface DeskPreview extends DeskScope {
  token: string
  revision: number
  expiresAt: number
  origin: string
  kind: 'edit' | 'table' | 'photo' | 'voice'
  base: string
  value: string
}
export interface BrowserRecipe {
  id: string
  connection: string
  origins: string[]
  tools: string[]
  title: string
  revision: number
}
export interface DeskState {
  documents: CanvasDocument[]
  assistants: DeskAssistant[]
  active: Record<string, string>
  tables: DataTable[]
  photos: PhotoProject[]
  browsers: BrowserRecipe[]
  pending: DeskPreview | null
  accepted: string[]
}
export interface DeskSpec {
  kind: 'edit' | 'table' | 'photo' | 'assistant' | 'browser'
  phase: 'model' | 'apply'
  fields: string[]
  params: Record<string, string>
  model: string | null
}
export interface DeskMaterials {
  images: Image[]
  documents: Document[]
}
export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}
