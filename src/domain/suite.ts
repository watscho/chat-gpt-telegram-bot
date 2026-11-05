import type { Document, Image } from './conversation.js'
import type { MissionStep } from './studio.js'
export type WorkflowId =
  | 'brand'
  | 'travel'
  | 'learn'
  | 'rehearse'
  | 'purchase'
  | 'sendcheck'
  | 'video'
  | 'brief'
  | 'repurpose'
  | 'quality'
  | 'screen'
  | 'decision'
  | 'form'
  | 'commitment'
  | 'referee'
export interface WorkflowSpec {
  id: WorkflowId
  phase: string
  record: string | null
  params: Record<string, string>
  fields: string[]
  model: string | null
  format: 'docx' | 'pptx' | 'pdf' | null
}
export interface SuiteConfig {
  reviewModels: string[]
  reviewExtra: number
  videoBytes: number
  videoSeconds: number
  videoFrames: number
  ffprobePath: string
}
export interface SourceQuote {
  id: string
  title: string
  text: string
  thread: string
  project: string | null
}
export type SuiteRow = Record<string, string | null>
export type RecordKind =
  'decision' | 'commitment' | 'trip' | 'course' | 'rehearsal' | 'form'
export interface SuiteRecord {
  id: string
  kind: RecordKind
  title: string
  thread: string
  project: string | null
  revision: number
  fields: Record<string, string>
  rows: SuiteRow[]
  sources: SourceQuote[]
  createdAt: number
  history: { at: number; label: string; rows: SuiteRow[] }[]
}
export interface BrandTemplate {
  name: string
  revision: number
  brand: string
  accent: string
  font: string
  footer: string
  headings: string[]
}
export interface QualityRule {
  id: string
  project: string | null
  label: string
  check: string
}
export interface RecipeStep {
  kind: MissionStep['kind']
  title: string
  prompt: string
  connection: string | null
  workflow?: WorkflowSpec
}
export interface Recipe {
  name: string
  revision: number
  goal: string
  steps: RecipeStep[]
  history: { revision: number; goal: string; steps: RecipeStep[] }[]
}
export interface SuitePending {
  token: string
  revision: number
  thread: string
  project: string | null
  sourceRevision: string | undefined
  expiresAt: number
  kind: 'record' | 'zip' | 'share'
  payload: string
}
export interface SuiteState {
  records: SuiteRecord[]
  templates: BrandTemplate[]
  criteria: QualityRule[]
  recipes: Recipe[]
  pending: SuitePending | null
  selected: SourceQuote[]
  listening: {
    thread: string
    kind: 'learn' | 'rehearse' | 'form'
    record: string
    expiresAt: number
  } | null
}
export interface VideoReference {
  file: string
  name: string
  bytes: number | null
  seconds: number | null
  start: number
  audio: boolean
}
export interface VideoEvidence {
  duration: number
  start: number
  seconds: number
  frames: { time: number; image: Image }[]
  audio: Uint8Array | null
}
export interface ArchiveItem {
  id: string
  name: string
  group: string
  bytes: Uint8Array
  hash: string
  duplicateOf: string | null
}
export interface DocumentSection {
  heading: string
  text: string
  image?: Image
}
export interface SuiteAssetPorts {
  archive(
    bytes: Uint8Array
  ): Promise<{ items: ArchiveItem[]; manifest: string }>
  package(items: { name: string; data: Uint8Array }[]): Promise<Uint8Array>
  document(
    template: BrandTemplate,
    format: 'docx' | 'pptx' | 'pdf',
    title: string,
    sections: DocumentSection[]
  ): Promise<Document>
  annotate(image: Image, rows: SuiteRow[]): Promise<Document>
  template(file: Document, name: string): Promise<BrandTemplate>
  video(
    bytes: Uint8Array,
    reference: VideoReference,
    signal: AbortSignal
  ): Promise<VideoEvidence>
}
