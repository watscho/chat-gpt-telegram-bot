import type { Document } from './conversation.js'

export type Mode = 'default' | 'developer' | 'editor' | 'translator' | 'custom'
export interface ThreadSettings {
  model?: string | null
  reviewContext?: boolean
  mode: Mode
  instructions: string
  project: string | null
  retentionSeconds: number | null
  quality: 'low' | 'medium' | 'high' | 'auto'
  size: 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
  imageVersion: string | null
}
export interface Project {
  id: string
  title: string
  instructions: string
  notes: string[]
  documents: Document[]
}
export interface Workspace {
  timezone: string
  nextProject: number
  projects: Project[]
  threads: Record<string, ThreadSettings>
  budget: number | null
  imageLimit: number | null
  searchLimit: number | null
  voiceLimit: number | null
}
export interface Usage {
  day: string
  requests: number
  estimatedMicroUsd: number
  images: number
  searches: number
  voice: number
  transcriptions: number
  failed: number
}
export type UsageKind =
  'auto' | 'chat' | 'image' | 'search' | 'voice' | 'transcription'
