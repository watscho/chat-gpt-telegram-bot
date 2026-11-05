import type { Document } from './conversation.js'
export type TeamRole = 'owner' | 'editor' | 'reader'
export interface Team {
  id: string
  owner: string
  title: string
  revision: number
  members: { owner: string; role: TeamRole }[]
  invites: {
    target: string
    role: 'editor' | 'reader'
    token: string
    expiresAt: number
  }[]
  files: { id: string; author: string; file: Document }[]
  notes: { id: string; author: string; text: string }[]
  tasks: {
    id: string
    author: string
    title: string
    assignee: string | null
    done: boolean
  }[]
  audit: { at: number; actor: string; action: string; target: string }[]
}
