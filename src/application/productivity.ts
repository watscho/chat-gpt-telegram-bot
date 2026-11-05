import { randomUUID } from 'node:crypto'
import type { StateStore } from '../domain/state.js'
import { UserError } from '../domain/conversation.js'
import type {
  ContextDraft,
  ContextPart,
  PreparedRequest,
  ProductivityState
} from '../domain/productivity.js'

export class Productivity {
  private readonly cache = new Map<string, ProductivityState>()
  constructor(
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  get(owner: string): ProductivityState {
    const state = structuredClone(
      this.cache.get(owner) ??
        this.store?.getRecord<ProductivityState>('productivity', owner) ?? {
          collecting: {},
          templates: [],
          forwards: {},
          feedback: [],
          draft: null
        }
    )
    if (state.draft && state.draft.expiresAt <= this.now()) {
      state.draft = null
      this.save(owner, state)
    }
    return state
  }
  private save(owner: string, state: ProductivityState): void {
    if (Buffer.byteLength(JSON.stringify(state)) > 20000000)
      throw new UserError(
        'Productivity data exceeds the 20 MB limit. Clear collected messages or context first.'
      )
    this.store?.putRecord('productivity', owner, state)
    this.cache.set(owner, structuredClone(state))
  }
  template(owner: string, name: string, body: string): void {
    if (
      !/^[a-z][a-z0-9_-]{0,31}$/.test(name) ||
      !body.trim() ||
      body.length > 8000
    )
      throw new UserError(
        'Use a lowercase template name (1..32 characters) and 1..8000 body characters.'
      )
    const state = this.get(owner)
    const templates = state.templates.filter(item => item.name !== name)
    if (templates.length >= 50)
      throw new UserError('Template limit reached. Delete a template first.')
    const invalid = body.replace(/\{\{([a-z][a-z0-9_]{0,31})\}\}/g, '')
    if (invalid.includes('{{') || invalid.includes('}}'))
      throw new UserError('Variables must use {{lowercase_name}} syntax.')
    state.templates = [...templates, { name, body }]
    this.save(owner, state)
  }
  removeTemplate(owner: string, name: string): void {
    const state = this.get(owner)
    if (!state.templates.some(item => item.name === name))
      throw new UserError('Template not found.')
    state.templates = state.templates.filter(item => item.name !== name)
    this.save(owner, state)
  }
  render(owner: string, name: string, values: Record<string, string>): string {
    const template = this.get(owner).templates.find(item => item.name === name)
    if (!template) throw new UserError('Template not found. Use /templates.')
    const names = new Set(
      [...template.body.matchAll(/\{\{([a-z][a-z0-9_]{0,31})\}\}/g)].map(
        match => match[1]!
      )
    )
    if (
      [...names].some(key => !values[key]?.trim()) ||
      Object.keys(values).some(key => !names.has(key))
    )
      throw new UserError(
        `Supply exactly these variables as JSON: ${[...names].join(', ') || '(none)'}.`
      )
    const rendered = template.body.replace(
      /\{\{([a-z][a-z0-9_]{0,31})\}\}/g,
      (_, key: string) => values[key]!
    )
    if (rendered.length > 8000)
      throw new UserError('Rendered template exceeds 8000 characters.')
    return rendered
  }
  collect(owner: string, thread: string, id: number, text: string): void {
    if (!text.trim() || text.length > 8000)
      throw new UserError(
        'Forward text must contain 1..8000 characters. Voice and attachment contents are not collected.'
      )
    const state = this.get(owner)
    const messages = state.forwards[thread] ?? []
    if (messages.some(item => item.id === id)) return
    if (
      messages.length >= 50 ||
      messages.reduce((sum, item) => sum + item.text.length, 0) + text.length >
        60000
    )
      throw new UserError(
        'Forward collection is full. Summarize or clear it first.'
      )
    state.forwards[thread] = [...messages, { id, text }]
    this.save(owner, state)
  }
  collecting(owner: string, thread: string, enabled: boolean): void {
    const state = this.get(owner)
    state.collecting[thread] = enabled
    this.save(owner, state)
  }
  clearForwards(owner: string, thread: string): void {
    const state = this.get(owner)
    delete state.forwards[thread]
    this.save(owner, state)
  }
  feedback(
    owner: string,
    thread: string,
    revision: string,
    rating: 'up' | 'down',
    reason: string
  ): void {
    if (
      !revision ||
      !['up', 'down'].includes(rating) ||
      !['helpful', 'incorrect', 'too_long', 'lost_context', 'other'].includes(
        reason
      )
    )
      throw new UserError('Choose a supported feedback rating and reason.')
    const state = this.get(owner)
    state.feedback = [
      ...state.feedback.filter(
        item => item.thread !== thread || item.revision !== revision
      ),
      { thread, revision, rating, reason, at: this.now() }
    ].slice(-200)
    this.save(owner, state)
  }
  stage(
    owner: string,
    thread: string,
    revision: string | undefined,
    request: PreparedRequest
  ): ContextDraft {
    const parts: ContextPart[] = []
    const add = (
      kind: ContextPart['kind'],
      label: string,
      value: ContextPart['value']
    ) =>
      parts.push({
        id: String(parts.length),
        kind,
        label,
        value,
        enabled: true
      })
    if (request.history.length)
      add(
        'history',
        `History text (${request.history.length} messages)`,
        request.history.map(message => {
          const { images: _images, documents: _documents, ...text } = message
          void _images
          void _documents
          return text
        })
      )
    const images = [
      ...request.history.flatMap(message => message.images ?? []),
      ...request.images
    ]
    const documents = [
      ...request.history.flatMap(message => message.documents ?? []),
      ...request.documents
    ]
    images
      .filter(
        (image, index) =>
          images.findIndex(
            item => item.data === image.data && item.mime === image.mime
          ) === index
      )
      .forEach((image, index) => add('image', `Image ${index + 1}`, image))
    documents
      .filter(
        (file, index) =>
          documents.findIndex(
            item => item.name === file.name && item.data === file.data
          ) === index
      )
      .forEach(file => add('document', `File: ${file.name}`, file))
    if (request.summary)
      add('summary', 'Earlier-history recap (extractive)', request.summary)
    request.memories.forEach((note, index) =>
      add('memory', `Note ${index + 1}: ${note.slice(0, 60)}`, note)
    )
    if (request.instructions)
      add(
        'instructions',
        'Mode, custom and project instructions',
        request.instructions
      )
    if (request.references)
      add(
        'references',
        'Retrieved library passages / forwarded collection',
        request.references
      )
    const draft: ContextDraft = {
      ...(request.evidence ? { evidence: request.evidence } : {}),
      ...(request.structured ? { structured: request.structured } : {}),
      token: randomUUID().slice(0, 12),
      thread,
      revision,
      prompt: request.prompt,
      ...(request.summary !== undefined ? { summary: request.summary } : {}),
      analysisOnly: request.analysisOnly,
      expiresAt: this.now() + 600000,
      parts
    }
    const state = this.get(owner)
    state.draft = draft
    this.save(owner, state)
    return structuredClone(draft)
  }
  setEstimate(owner: string, estimate: number): void {
    const state = this.get(owner)
    if (state.draft) {
      state.draft.estimate = estimate
      this.save(owner, state)
    }
  }
  draft(
    owner: string,
    thread: string,
    token: string,
    revision: string | undefined
  ): ContextDraft {
    const draft = this.get(owner).draft
    if (
      !draft ||
      draft.thread !== thread ||
      draft.token !== token ||
      draft.revision !== revision
    )
      throw new UserError(
        'Context preview expired or changed. Create a new preview.'
      )
    return draft
  }
  toggle(
    owner: string,
    thread: string,
    token: string,
    revision: string | undefined,
    id: string
  ): void {
    const draft = this.draft(owner, thread, token, revision)
    const part = draft.parts.find(item => item.id === id)
    if (!part) throw new UserError('Context item not found.')
    part.enabled = !part.enabled
    const state = this.get(owner)
    state.draft = draft
    this.save(owner, state)
  }
  consume(
    owner: string,
    thread: string,
    token: string,
    revision: string | undefined
  ): PreparedRequest {
    const draft = this.draft(owner, thread, token, revision)
    const request: PreparedRequest = {
      ...(draft.structured ? { structured: draft.structured } : {}),
      prompt: draft.prompt,
      images: [],
      documents: [],
      memories: [],
      instructions: '',
      history: [],
      ...(draft.summary !== undefined ? { summary: '' } : {}),
      references: '',
      analysisOnly: draft.analysisOnly
    }
    for (const part of draft.parts.filter(item => item.enabled)) {
      if (part.kind === 'history')
        request.history = part.value as PreparedRequest['history']
      else if (part.kind === 'image')
        request.images.push(part.value as PreparedRequest['images'][number])
      else if (part.kind === 'document')
        request.documents.push(
          part.value as PreparedRequest['documents'][number]
        )
      else if (part.kind === 'memory')
        request.memories.push(part.value as string)
      else if (part.kind === 'instructions')
        request.instructions = part.value as string
      else if (part.kind === 'summary') request.summary = part.value as string
      else {
        request.references = part.value as string
        if (draft.evidence) request.evidence = draft.evidence
      }
    }
    this.discard(owner)
    return request
  }
  discard(owner: string): void {
    const state = this.get(owner)
    state.draft = null
    this.save(owner, state)
  }
  deleteThread(owner: string, thread: string): void {
    const state = this.get(owner)
    delete state.forwards[thread]
    delete state.collecting[thread]
    state.feedback = state.feedback.filter(item => item.thread !== thread)
    if (state.draft?.thread === thread) state.draft = null
    this.save(owner, state)
  }
  refresh(owner: string): void {
    this.cache.delete(owner)
  }
  erase(owner: string): void {
    this.store?.deleteRecord('productivity', owner)
    this.cache.delete(owner)
  }
}
