import { Experience } from './experience.js'
import type { Bookmark, ExperienceState } from '../domain/experience.js'
import { evidenceCards } from './evidence.js'
import { safeSource } from './sources.js'
import { Workspaces } from './workspaces.js'
import type { Config } from '../config.js'
import type { Message, Document } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import type { Session, StateStore } from '../domain/state.js'
import type { Project, Workspace, ThreadSettings } from '../domain/workspace.js'
import type { ProductivityState } from '../domain/productivity.js'
import type { Recap, WorkflowState } from '../domain/workflow.js'
import type { LibraryFile } from './library.js'
import { documentFromBytes } from '../infrastructure/documents.js'
import { imageFromBytes } from '../infrastructure/images.js'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new UserError('Invalid archive object.')
  return value as Record<string, unknown>
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new UserError('Invalid archive list or item limit exceeded.')
  return value as unknown[]
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max)
    throw new UserError('Invalid archive text or character limit exceeded.')
  return value
}
function id(value: unknown): string {
  const valueId = text(value, 16)
  if (!/^[1-9]\d*$/.test(valueId))
    throw new UserError('Invalid archive identifier.')
  return valueId
}
function base64(value: unknown, max: number): Buffer {
  const encoded = text(value, Math.ceil((max * 4) / 3) + 4)
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded
    )
  )
    throw new UserError('Invalid archive base64.')
  return Buffer.from(encoded, 'base64')
}
interface Portable {
  threads: {
    id: string
    title: string
    messages: Message[]
    settings: ThreadSettings
    recap?: Recap
  }[]
  projects: Project[]
  bookmarks: Bookmark[]
  notes: string[]
  templates: { name: string; body: string }[]
  library: LibraryFile[]
  tasks: { thread: string; title: string }[]
  forwards: ProductivityState['forwards']
  feedback: ProductivityState['feedback']
  glossary: WorkflowState['glossary']
}
export class ArchiveImport {
  constructor(
    private readonly config: Config,
    private readonly store: StateStore,
    private readonly now = Date.now
  ) {}
  parse(source: string): Portable {
    if (Buffer.byteLength(source) > this.config.maxExportBytes)
      throw new UserError('Archive exceeds the configured export/import limit.')
    let data: unknown
    try {
      data = JSON.parse(source)
    } catch {
      throw new UserError('Archive must be valid JSON.')
    }
    const root = object(data)
    if (
      root.archiveVersion !== undefined &&
      root.archiveVersion !== 1 &&
      root.archiveVersion !== 2
    )
      throw new UserError('Unsupported archive version.')
    const profile = object(root.profile),
      workspace = object(root.workspace)
    const rawThreads = list(profile.threads, this.config.maxThreads)
    const histories = list(root.histories, this.config.maxSessions)
    const documents = (value: unknown): Document[] =>
      list(value ?? [], 10).map(item => {
        const file = object(item)
        return documentFromBytes(
          base64(file.data, this.config.maxDocumentBytes),
          text(file.name, 160),
          this.config.maxDocumentBytes
        )
      })
    const messages = (value: unknown): Message[] => {
      const items = list(value, this.config.maxHistoryTurns * 2).map(item => {
        const message = object(item)
        if (message.role !== 'user' && message.role !== 'assistant')
          throw new UserError('Invalid archive message role.')
        const images = list(message.images ?? [], 10).map(image =>
          imageFromBytes(
            base64(object(image).data, this.config.maxImageBytes),
            this.config.maxImageBytes
          )
        )
        const files = documents(message.documents)
        const evidence = list(message.evidence ?? [], 16).map(item => {
          const card = object(item),
            title = text(card.title, 256),
            body = text(card.text, 1200),
            label = text(card.label, 12)
          const url = card.url === undefined ? undefined : text(card.url, 2048)
          if (url !== undefined && !safeSource({ title, url }))
            throw new UserError('Invalid archive source URL.')
          return { label, title, text: body, ...(url ? { url } : {}) }
        })
        return {
          role: message.role,
          content: text(message.content, this.config.maxHistoryCharacters),
          ...(typeof message.id === 'string'
            ? { id: text(message.id, 100) }
            : {}),
          ...(images.length ? { images } : {}),
          ...(files.length ? { documents: files } : {}),
          ...(evidence.length ? { evidence: evidenceCards(evidence) } : {})
        } satisfies Message
      })
      if (
        items.length % 2 ||
        items.some(
          (item, index) => item.role !== (index % 2 ? 'assistant' : 'user')
        )
      )
        throw new UserError(
          'Archive histories must contain complete alternating turns.'
        )
      if (
        items.reduce(
          (sum, item) =>
            sum +
            item.content.length +
            (item.evidence ?? []).reduce(
              (total, card) =>
                total +
                card.label.length +
                card.title.length +
                card.text.length +
                (card.url?.length ?? 0),
              0
            ),
          0
        ) > this.config.maxHistoryCharacters ||
        items
          .flatMap(item => [...(item.images ?? []), ...(item.documents ?? [])])
          .reduce((sum, item) => sum + item.data.length, 0) >
          this.config.maxHistoryImageBytes
      )
        throw new UserError('Archive history exceeds current operator limits.')
      return items
    }
    const threads = rawThreads.map((item): Portable['threads'][number] => {
      const thread = object(item),
        threadId = id(thread.id)
      const found = histories.filter(entry => {
        const pair = list(entry, 2)
        return text(pair[0], 100).split(':').at(-1) === threadId
      })
      if (found.length > 1)
        throw new UserError('Duplicate archive conversation history.')
      const title = text(thread.title, 80)
      if (!title.trim() || /[\r\n]/.test(title))
        throw new UserError('Invalid archive conversation title.')
      let recap: Recap | undefined
      if (found.length) {
        const raw = object(list(found[0], 2)[1]).recap
        if (raw !== undefined) {
          const record = object(raw)
          recap = {
            decisions: list(record.decisions, 3).map(item => text(item, 310)),
            constraints: list(record.constraints, 3).map(item =>
              text(item, 310)
            ),
            questions: list(record.questions, 3).map(item => text(item, 310)),
            context: list(record.context, 3).map(item => text(item, 310))
          }
        }
      }
      return {
        id: threadId,
        title,
        ...(recap ? { recap } : {}),
        messages: found.length
          ? messages(object(list(found[0], 2)[1]).messages)
          : [],
        settings: {
          mode: 'default',
          instructions: '',
          project: null,
          retentionSeconds: null,
          quality: this.config.imageQuality,
          size: this.config.imageSize,
          imageVersion: null
        }
      }
    })
    if (new Set(threads.map(item => item.id)).size !== threads.length)
      throw new UserError('Duplicate archive conversation IDs.')
    const projects = list(workspace.projects, this.config.maxProjects).map(
      item => {
        const p = object(item)
        const budget = p.dailyBudget
        if (
          budget !== undefined &&
          budget !== null &&
          (typeof budget !== 'number' ||
            !Number.isSafeInteger(budget) ||
            budget < 0 ||
            budget > this.config.dailyBudgetMicroUsd)
        )
          throw new UserError('Invalid archive project budget.')
        const notes = list(p.notes, this.config.maxMemories).map(note =>
          text(note, this.config.maxMemoryCharacters)
        )
        return {
          ...(typeof budget === 'number' ? { dailyBudget: budget } : {}),
          id: id(p.id),
          title: text(p.title, 80),
          instructions: text(p.instructions, 4000),
          notes,
          documents: documents(p.documents)
        }
      }
    )
    if (
      new Set(projects.map(item => item.id)).size !== projects.length ||
      projects.reduce(
        (sum, p) =>
          sum + p.documents.reduce((n, file) => n + file.data.length, 0),
        0
      ) > this.config.maxProjectBytes ||
      projects.some(
        p => p.notes.join('').length > this.config.maxMemoryCharacters
      )
    )
      throw new UserError(
        'Duplicate project IDs or project data limit exceeded.'
      )
    const settingsValidator = new Workspaces(this.config)
    settingsValidator.save('archive', {
      timezone: 'UTC',
      nextProject: 1,
      projects,
      threads: {},
      budget: null,
      imageLimit: null,
      searchLimit: null,
      voiceLimit: null
    })
    const settings =
      workspace.threads === undefined ? {} : object(workspace.threads)
    for (const thread of threads) {
      const raw =
        settings[thread.id] === undefined ? {} : object(settings[thread.id])
      const patch: Partial<ThreadSettings> = {}
      if (raw.answerLanguage !== undefined)
        patch.answerLanguage = text(raw.answerLanguage, 10)
      if (raw.instructions !== undefined)
        patch.instructions = text(raw.instructions, 4000)
      if (raw.mode !== undefined)
        patch.mode = text(raw.mode, 30) as ThreadSettings['mode']
      if (raw.quality !== undefined)
        patch.quality = text(raw.quality, 20) as ThreadSettings['quality']
      if (raw.size !== undefined)
        patch.size = text(raw.size, 20) as ThreadSettings['size']
      if (raw.project !== undefined)
        patch.project = raw.project === null ? null : id(raw.project)
      if (raw.retentionSeconds !== undefined) {
        if (
          raw.retentionSeconds !== null &&
          typeof raw.retentionSeconds !== 'number'
        )
          throw new UserError('Invalid archive retention.')
        patch.retentionSeconds = raw.retentionSeconds
      }
      if (raw.model !== undefined)
        patch.model = raw.model === null ? null : text(raw.model, 100)
      if (raw.reviewContext !== undefined) {
        if (typeof raw.reviewContext !== 'boolean')
          throw new UserError('Invalid archive review preference.')
        patch.reviewContext = raw.reviewContext
      }
      settingsValidator.configure('archive', thread.id, patch)
      thread.settings = settingsValidator.thread('archive', thread.id)
    }
    const notes = list(profile.memories, this.config.maxMemories).map(note =>
      text(note, this.config.maxMemoryCharacters)
    )
    const ext = root.extensions === undefined ? {} : object(root.extensions),
      prod = ext.productivity === undefined ? {} : object(ext.productivity),
      flow = ext.workflow === undefined ? {} : object(ext.workflow)
    const experience =
        ext.experience === undefined ? {} : object(ext.experience),
      bookmarkValidator = new Experience(undefined, this.now)
    const bookmarks = list(experience.bookmarks ?? [], 100).map(item => {
      const entry = object(item)
      return bookmarkValidator.bookmark(
        'archive',
        text(entry.title, 80),
        text(entry.text, 4000),
        list(entry.tags ?? [], 10).map(tag => text(tag, 24))
      )
    })
    const templates = list(prod.templates ?? [], 50).map(item => {
      const template = object(item)
      const name = text(template.name, 32),
        body = text(template.body, 8000)
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name) || !body.trim())
        throw new UserError('Invalid archive template.')
      return { name, body }
    })
    if (new Set(templates.map(item => item.name)).size !== templates.length)
      throw new UserError('Duplicate archive template names.')
    const library = list(ext.library ?? [], 500).map(item => {
      const f = object(item),
        project = id(f.project)
      if (!projects.some(p => p.id === project))
        throw new UserError('Library project is missing from the archive.')
      const passages = list(f.passages, 100000).map(item => {
        const p = object(item)
        return { location: text(p.location, 100), text: text(p.text, 1200) }
      })
      if (passages.reduce((n, p) => n + p.text.length, 0) > 1200000)
        throw new UserError('Library document text limit exceeded.')
      return {
        id: text(f.id, 100),
        project,
        name: text(f.name, 160),
        digest: text(f.digest, 100),
        passages
      }
    })
    const tasks = list(flow.tasks ?? [], 100).map(item => {
      const t = object(item),
        thread = id(t.thread)
      if (!threads.some(item => item.id === thread))
        throw new UserError('Task conversation is missing from the archive.')
      return { thread, title: text(t.title, 1000) }
    })
    const forwards: ProductivityState['forwards'] = {}
    for (const [thread, value] of Object.entries(
      prod.forwards === undefined ? {} : object(prod.forwards)
    )) {
      if (!threads.some(item => item.id === thread))
        throw new UserError('Forward collection has no archive conversation.')
      const entries = list(value, 50).map((item, index) => ({
        id: -(index + 1),
        text: text(object(item).text, 8000)
      }))
      if (entries.reduce((sum, item) => sum + item.text.length, 0) > 60000)
        throw new UserError('Archive forward collection is too large.')
      forwards[thread] = entries
    }
    const feedback: ProductivityState['feedback'] = list(
      prod.feedback ?? [],
      200
    ).map(item => {
      const entry = object(item),
        thread = id(entry.thread),
        rating = text(entry.rating, 10),
        reason = text(entry.reason, 30)
      if (
        !threads.some(item => item.id === thread) ||
        !['up', 'down'].includes(rating) ||
        !['helpful', 'incorrect', 'too_long', 'lost_context', 'other'].includes(
          reason
        )
      )
        throw new UserError('Invalid archive feedback.')
      return {
        thread,
        revision: text(entry.revision, 100),
        rating: rating as 'up' | 'down',
        reason,
        at: this.now()
      }
    })
    const glossary: WorkflowState['glossary'] = {}
    for (const [project, value] of Object.entries(
      flow.glossary === undefined ? {} : object(flow.glossary)
    )) {
      if (!projects.some(item => item.id === project))
        throw new UserError('Glossary project is missing from the archive.')
      const entries = list(value, 100).map(item => {
        const entry = object(item)
        return { term: text(entry.term, 80), meaning: text(entry.meaning, 200) }
      })
      if (
        entries.reduce(
          (sum, item) => sum + item.term.length + item.meaning.length,
          0
        ) > 4000 ||
        entries.some(
          item =>
            !item.term.trim() ||
            !item.meaning.trim() ||
            /[\r\n]/.test(item.term + item.meaning)
        )
      )
        throw new UserError('Invalid archive glossary.')
      glossary[project] = entries
    }
    return {
      bookmarks,
      threads,
      projects,
      notes,
      templates,
      library,
      tasks,
      forwards,
      feedback,
      glossary
    }
  }
  preview(owner: string, source: string): string {
    const archive = this.parse(source)
    const names =
      this.store
        .getRecord<ProductivityState>('productivity', owner)
        ?.templates.map(item => item.name) ?? []
    const conflicts = archive.templates
      .filter(item => names.includes(item.name))
      .map(item => item.name)
    return `Import preview: ${archive.threads.length} conversations, ${archive.projects.length} projects, ${archive.templates.length} templates, ${archive.library.length} library documents, ${archive.tasks.length} tasks, ${archive.bookmarks.length} bookmarks.\nConversations/projects receive new IDs. Per-conversation preferences, forward collections (collection off) and local feedback are restored. Conflicting template names are skipped: ${conflicts.join(', ') || '(none)'}. Existing notes are merged within limits. Tasks import without deadlines. Jobs, schedules, quota counters, credentials, callbacks, drafts and delivery mappings are never imported. Current data is preserved.`
  }
  commit(owner: string, source: string): void {
    const archive = this.parse(source),
      profile = this.store.getProfile(owner) ?? {
        active: '1',
        nextId: 2,
        threads: [{ id: '1', title: 'Main' }],
        memories: [],
        voice: 'off'
      }
    const ws = this.store.getRecord<Workspace>('workspace', owner) ?? {
      timezone: 'UTC',
      nextProject: 1,
      projects: [],
      threads: {},
      budget: null,
      imageLimit: null,
      searchLimit: null,
      voiceLimit: null
    }
    const prod = this.store.getRecord<ProductivityState>(
      'productivity',
      owner
    ) ?? {
      collecting: {},
      templates: [],
      forwards: {},
      feedback: [],
      draft: null
    }
    const flow = this.store.getRecord<WorkflowState>('workflow', owner) ?? {
      tasks: [],
      glossary: {},
      quotes: [],
      approval: null
    }
    const experience = this.store.getRecord<ExperienceState>(
      'experience',
      owner
    ) ?? {
      language: 'en',
      quiet: null,
      digestMinutes: 0,
      bookmarks: [],
      notices: []
    }
    for (const bookmark of archive.bookmarks)
      if (!experience.bookmarks.some(item => item.text === bookmark.text))
        experience.bookmarks.push(bookmark)
    if (
      experience.bookmarks.length > 100 ||
      Buffer.byteLength(JSON.stringify(experience)) > 1000000
    )
      throw new UserError('Imported bookmarks exceed the destination limits.')
    const library = this.store.getRecord<LibraryFile[]>('library', owner) ?? []
    if (
      profile.threads.length + archive.threads.length >
        this.config.maxThreads ||
      ws.projects.length + archive.projects.length > this.config.maxProjects ||
      flow.tasks.length + archive.tasks.length > 100
    )
      throw new UserError(
        'Not enough free conversation/project/task slots for this archive.'
      )
    const projects = new Map<string, string>(),
      threads = new Map<string, string>(),
      sessions: [string, Session][] = []
    for (const project of archive.projects) {
      const target = String(ws.nextProject++)
      projects.set(project.id, target)
      ws.projects.push({
        ...project,
        id: target,
        title: `${project.title.slice(0, 65)} (import)`
      })
    }
    for (const thread of archive.threads) {
      const target = String(profile.nextId++)
      threads.set(thread.id, target)
      profile.threads.push({
        id: target,
        title: `${thread.title.slice(0, 65)} (import)`
      })
      ws.threads[target] = {
        ...thread.settings,
        project:
          thread.settings.project === null
            ? null
            : projects.get(thread.settings.project)!,
        imageVersion: null
      }
      sessions.push([
        `${owner}:${target}`,
        {
          messages: thread.messages,
          ...(thread.recap ? { recap: thread.recap } : {}),
          expiresAt:
            this.now() +
            (thread.settings.retentionSeconds === null
              ? this.config.sessionTtlMs
              : thread.settings.retentionSeconds * 1000)
        }
      ])
    }
    profile.memories = [...new Set([...profile.memories, ...archive.notes])]
    if (
      profile.memories.length > this.config.maxMemories ||
      profile.memories.join('').length > this.config.maxMemoryCharacters
    )
      throw new UserError('Imported notes exceed current memory limits.')
    for (const template of archive.templates)
      if (!prod.templates.some(item => item.name === template.name))
        prod.templates.push(template)
    for (const [thread, entries] of Object.entries(archive.forwards))
      prod.forwards[threads.get(thread)!] = entries
    prod.feedback = [
      ...prod.feedback,
      ...archive.feedback.map(item => ({
        ...item,
        thread: threads.get(item.thread)!
      }))
    ]
    prod.draft = null
    flow.approval = null
    for (const [project, entries] of Object.entries(archive.glossary))
      flow.glossary[projects.get(project)!] = entries
    for (const task of archive.tasks)
      flow.tasks.push({
        id: `import-${profile.nextId++}`,
        thread: threads.get(task.thread)!,
        title: task.title,
        status: 'open',
        dueAt: null,
        reminded: false,
        attempts: 0,
        nextAttempt: 0
      })
    for (const file of archive.library)
      library.push({
        ...file,
        id: `${projects.get(file.project)!}-${file.id}`,
        project: projects.get(file.project)!
      })
    const retained = this.store.sessions()
    const encoded = (session: Session) =>
      session.messages
        .flatMap(message => [
          ...(message.images ?? []),
          ...(message.documents ?? [])
        ])
        .reduce((sum, file) => sum + file.data.length, 0)
    if (
      retained.length + sessions.length > this.config.maxSessions ||
      [...retained, ...sessions].reduce(
        (sum, [, session]) => sum + encoded(session),
        0
      ) > this.config.maxTotalImageBytes
    )
      throw new UserError(
        'Imported histories exceed global capacity; no existing histories will be evicted.'
      )
    if (
      prod.templates.length > 50 ||
      prod.feedback.length > 200 ||
      library.length > 500 ||
      Buffer.byteLength(JSON.stringify(library)) > 20000000 ||
      Buffer.byteLength(JSON.stringify(prod)) > 20000000 ||
      Buffer.byteLength(JSON.stringify(flow)) > 20000000 ||
      ws.projects.reduce(
        (sum, p) =>
          sum + p.documents.reduce((n, file) => n + file.data.length, 0),
        0
      ) > this.config.maxProjectBytes
    )
      throw new UserError('Merged archive exceeds local storage limits.')
    this.store.commitImport(owner, profile, sessions, [
      ['workspace', ws],
      ['productivity', prod],
      ['workflow', flow],
      ['library', library],
      ['experience', experience]
    ])
  }
}
