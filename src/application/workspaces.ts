import type { Config } from '../config.js'
import type { Document } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import type { StateStore } from '../domain/state.js'
import type {
  Mode,
  Project,
  ThreadSettings,
  Workspace
} from '../domain/workspace.js'

const modes: Record<Mode, string> = {
  default: '',
  developer:
    'Act as a software development assistant. Explain assumptions, correctness and relevant tradeoffs. Provide runnable examples when useful.',
  editor:
    'Edit for clarity, accuracy and the requested tone. Preserve meaning. Explain substantive changes when useful.',
  translator:
    'Translate faithfully into the requested language, preserving meaning and formatting. Ask for the target language if missing.',
  custom: ''
}
export class Workspaces {
  private readonly local = new Map<string, Workspace>()
  constructor(
    private readonly config: Config,
    private readonly store?: StateStore
  ) {}
  get(owner: string): Workspace {
    return structuredClone(
      this.local.get(owner) ??
        this.store?.getRecord<Workspace>('workspace', owner) ?? {
          timezone: 'UTC',
          nextProject: 1,
          projects: [],
          threads: {},
          budget: null,
          imageLimit: null,
          searchLimit: null,
          voiceLimit: null
        }
    )
  }
  save(owner: string, state: Workspace): void {
    this.store?.putRecord('workspace', owner, state)
    this.local.set(owner, structuredClone(state))
  }
  thread(owner: string, id: string): ThreadSettings {
    return (
      this.get(owner).threads[id] ?? {
        mode: 'default',
        instructions: '',
        project: null,
        retentionSeconds: null,
        quality: this.config.imageQuality,
        size: this.config.imageSize,
        imageVersion: null
      }
    )
  }
  configure(owner: string, id: string, patch: Partial<ThreadSettings>): void {
    const state = this.get(owner)
    const thread = { ...this.thread(owner, id), ...patch }
    if (!Object.hasOwn(modes, thread.mode) || thread.instructions.length > 4000)
      throw new UserError(
        'Use a supported mode and at most 4000 instruction characters.'
      )
    if (
      !['low', 'medium', 'high', 'auto'].includes(thread.quality) ||
      !['auto', '1024x1024', '1536x1024', '1024x1536'].includes(thread.size)
    )
      throw new UserError('Unsupported image quality or size.')
    if (
      thread.retentionSeconds !== null &&
      (!Number.isInteger(thread.retentionSeconds) ||
        thread.retentionSeconds < 60 ||
        thread.retentionSeconds > 86400)
    )
      throw new UserError('Retention must be between 60 and 86400 seconds.')
    if (
      thread.project !== null &&
      !state.projects.some(project => project.id === thread.project)
    )
      throw new UserError('Project not found. Use /projects.')
    if (
      thread.model != null &&
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(thread.model)
    )
      throw new UserError(
        'Use a model ID of 1..100 letters, numbers or model separators.'
      )
    state.threads[id] = thread
    this.save(owner, state)
  }
  timezone(owner: string, value: string): void {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format()
    } catch {
      throw new UserError(
        'Use a valid IANA timezone, for example Europe/London.'
      )
    }
    const state = this.get(owner)
    state.timezone = value
    this.save(owner, state)
  }
  limits(
    owner: string,
    kind: 'budget' | 'imageLimit' | 'searchLimit' | 'voiceLimit',
    value: number
  ): void {
    const max = {
      budget: this.config.dailyBudgetMicroUsd,
      imageLimit: this.config.dailyImages,
      searchLimit: this.config.dailySearches,
      voiceLimit: this.config.dailyVoice
    }[kind]
    if (!Number.isSafeInteger(value) || value < 0 || value > max)
      throw new UserError(
        'Limit must be non-negative and cannot exceed the operator maximum.'
      )
    const state = this.get(owner)
    state[kind] = value
    this.save(owner, state)
  }
  create(owner: string, title: string): Project {
    const state = this.get(owner)
    if (state.projects.length >= this.config.maxProjects)
      throw new UserError('Project limit reached.')
    if (!title.trim() || title.length > 80 || title.includes('\n'))
      throw new UserError(
        'Use a project name between 1 and 80 characters on one line.'
      )
    const project = {
      id: String(state.nextProject++),
      title: title.trim(),
      instructions: '',
      notes: [],
      documents: []
    }
    state.projects.push(project)
    this.save(owner, state)
    return project
  }
  project(owner: string, thread: string): Project | undefined {
    return this.get(owner).projects.find(
      project => project.id === this.thread(owner, thread).project
    )
  }
  updateProject(
    owner: string,
    id: string,
    action: 'instructions' | 'remember' | 'forget' | 'attach' | 'remove',
    value: string | Document
  ): void {
    const state = this.get(owner)
    const project = state.projects.find(item => item.id === id)
    if (!project) throw new UserError('Project not found. Use /projects.')
    if (action === 'attach' && typeof value === 'string')
      throw new UserError('A document is required.')
    if (action !== 'attach' && typeof value !== 'string')
      throw new UserError('Text is required for this project action.')
    if (action === 'attach') {
      const document = value as Document
      project.documents = [
        ...project.documents.filter(item => item.name !== document.name),
        document
      ]
      if (
        project.documents.length > 10 ||
        state.projects.reduce(
          (sum, item) =>
            sum +
            item.documents.reduce((size, file) => size + file.data.length, 0),
          0
        ) > this.config.maxProjectBytes
      )
        throw new UserError('Project file limit reached. Remove files first.')
    } else if (action === 'instructions') {
      if ((value as string).length > 4000)
        throw new UserError('Project instructions exceed 4000 characters.')
      project.instructions = value as string
    } else if (action === 'remember') {
      const note = (value as string).trim()
      if (
        !note ||
        project.notes.length >= this.config.maxMemories ||
        project.notes.join('').length + note.length >
          this.config.maxMemoryCharacters
      )
        throw new UserError('Project note limit reached or note is empty.')
      project.notes.push(note)
    } else if (action === 'forget') {
      const index = Number(value) - 1
      if (value === 'all') project.notes = []
      else if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= project.notes.length
      )
        throw new UserError('Project note not found.')
      else project.notes.splice(index, 1)
    } else {
      const before = project.documents.length
      project.documents = project.documents.filter(file => file.name !== value)
      if (before === project.documents.length)
        throw new UserError('Project file not found.')
    }
    this.save(owner, state)
  }
  deleteProject(owner: string, id: string): void {
    const state = this.get(owner)
    if (!state.projects.some(project => project.id === id))
      throw new UserError('Project not found.')
    state.projects = state.projects.filter(project => project.id !== id)
    for (const thread of Object.values(state.threads))
      if (thread.project === id) thread.project = null
    this.save(owner, state)
  }
  instructions(owner: string, id: string): string {
    const thread = this.thread(owner, id)
    return [
      modes[thread.mode],
      thread.instructions,
      this.project(owner, id)?.instructions
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  operatorBudget(): number {
    return this.config.dailyBudgetMicroUsd
  }
  deleteThread(owner: string, id: string): void {
    const state = this.get(owner)
    delete state.threads[id]
    this.save(owner, state)
  }
  forget(owner: string): void {
    this.local.delete(owner)
    this.store?.deleteRecord('workspace', owner)
  }
}
