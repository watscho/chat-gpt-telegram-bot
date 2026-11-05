import { randomUUID } from 'node:crypto'
import type { StateStore } from '../domain/state.js'
import type { Approval, Task, WorkflowState } from '../domain/workflow.js'
import { UserError } from '../domain/conversation.js'

export class Workflow {
  private readonly cache = new Map<string, WorkflowState>()
  private ticking = false
  private restored = false
  private readonly owners = new Set<string>()
  constructor(
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  get(owner: string): WorkflowState {
    this.owners.add(owner)
    const state = structuredClone(
      this.cache.get(owner) ??
        this.store?.getRecord<WorkflowState>('workflow', owner) ?? {
          tasks: [],
          glossary: {},
          quotes: [],
          approval: null
        }
    )
    if (!this.cache.has(owner)) this.cache.set(owner, structuredClone(state))
    if (state.approval && state.approval.expiresAt <= this.now()) {
      state.approval = null
      this.save(owner, state)
    }
    return state
  }
  save(owner: string, state: WorkflowState): void {
    if (Buffer.byteLength(JSON.stringify(state)) > 20000000)
      throw new UserError(
        'Workflow data exceeds 20 MB. Remove unused tasks or pending work.'
      )
    this.store?.putRecord('workflow', owner, state)
    this.cache.set(owner, structuredClone(state))
  }
  refresh(owner: string): void {
    this.cache.delete(owner)
    this.owners.add(owner)
  }
  addTask(
    owner: string,
    thread: string,
    title: string,
    dueAt: number | null
  ): Task {
    if (
      !title.trim() ||
      title.length > 1000 ||
      (dueAt !== null && (!Number.isFinite(dueAt) || dueAt <= this.now()))
    )
      throw new UserError(
        'Use a task title of 1..1000 characters and an optional future deadline.'
      )
    const state = this.get(owner)
    if (state.tasks.length >= 100)
      throw new UserError(
        'Task limit reached (100). Delete completed tasks first.'
      )
    const task: Task = {
      id: randomUUID().slice(0, 12),
      thread,
      title: title.trim(),
      status: 'open',
      dueAt,
      reminded: false,
      attempts: 0,
      nextAttempt: 0
    }
    state.tasks.push(task)
    this.save(owner, state)
    return structuredClone(task)
  }
  task(
    owner: string,
    id: string,
    action: 'done' | 'open' | 'delete' | 'due',
    dueAt: number | null = null
  ): void {
    const state = this.get(owner),
      task = state.tasks.find(item => item.id === id)
    if (!task) throw new UserError('Task not found. Use /tasks.')
    if (action === 'delete')
      state.tasks = state.tasks.filter(item => item.id !== id)
    else if (action === 'due') {
      if (dueAt !== null && (!Number.isFinite(dueAt) || dueAt <= this.now()))
        throw new UserError('Choose a future deadline or none.')
      task.dueAt = dueAt
      delete task.delivery
      task.reminded = false
      task.attempts = 0
      task.nextAttempt = 0
    } else task.status = action
    this.save(owner, state)
  }
  glossary(
    owner: string,
    project: string,
    term: string,
    meaning?: string
  ): void {
    if (!project || !term.trim() || term.length > 80 || /[\r\n]/.test(term))
      throw new UserError(
        'Select a project and a single-line term of 1..80 characters.'
      )
    const state = this.get(owner),
      entries = state.glossary[project] ?? []
    const found = entries.find(
      item => item.term.toLocaleLowerCase() === term.trim().toLocaleLowerCase()
    )
    if (meaning === undefined) {
      if (!found) throw new UserError('Glossary term not found.')
      state.glossary[project] = entries.filter(item => item !== found)
    } else {
      if (!meaning.trim() || meaning.length > 200 || /[\r\n]/.test(meaning))
        throw new UserError('Use a single-line meaning of 1..200 characters.')
      const next = [
        ...entries.filter(item => item !== found),
        { term: term.trim(), meaning: meaning.trim() }
      ]
      if (
        next.length > 100 ||
        next.reduce(
          (sum, item) => sum + item.term.length + item.meaning.length,
          0
        ) > 4000
      )
        throw new UserError(
          'Glossary limit reached (100 terms / 4000 characters).'
        )
      state.glossary[project] = next
    }
    this.save(owner, state)
  }
  terms(owner: string, project: string | null): string {
    const entries = project ? (this.get(owner).glossary[project] ?? []) : []
    return entries.length
      ? `Project glossary (user preferences; preserve spelling and requested meanings):\n${entries.map(item => `${item.term}: ${item.meaning}`).join('\n')}`
      : ''
  }
  quote(
    owner: string,
    message: number,
    thread: string,
    revision: string,
    text: string
  ): void {
    const state = this.get(owner)
    state.quotes = [
      ...state.quotes.filter(item => item.message !== message),
      { message, thread, revision, text: text.slice(0, 4000) }
    ].slice(-100)
    this.save(owner, state)
  }
  quoted(
    owner: string,
    thread: string,
    message: number,
    retained: string[],
    fragment?: string
  ): string {
    const item = this.get(owner).quotes.find(item => item.message === message)
    if (!item || item.thread !== thread || !retained.includes(item.revision))
      throw new UserError(
        'That bot answer is not retained in this conversation. Select its original conversation or paste the relevant text.'
      )
    if (
      fragment !== undefined &&
      (!fragment.trim() || !item.text.includes(fragment))
    )
      throw new UserError(
        'The quoted fragment does not match the retained answer.'
      )
    return `Quoted bot answer (${item.revision}); respond to this specific passage, not an unrelated recent answer:\n${fragment ?? item.text}`
  }
  stage(owner: string, input: Omit<Approval, 'token' | 'expiresAt'>): Approval {
    const state = this.get(owner)
    state.approval = {
      ...input,
      token: randomUUID().slice(0, 12),
      expiresAt: this.now() + 600000
    }
    this.save(owner, state)
    return structuredClone(state.approval)
  }
  approval(
    owner: string,
    thread: string,
    token: string,
    revision: string | undefined,
    consume = false
  ): Approval {
    const state = this.get(owner),
      approval = state.approval
    if (
      !approval ||
      approval.thread !== thread ||
      approval.token !== token ||
      approval.revision !== revision
    )
      throw new UserError(
        'Work preview expired or changed. Create a new preview.'
      )
    if (consume) {
      state.approval = null
      this.save(owner, state)
    }
    return approval
  }
  deleteThread(owner: string, thread: string): void {
    const state = this.get(owner)
    state.tasks = state.tasks.filter(item => item.thread !== thread)
    state.quotes = state.quotes.filter(item => item.thread !== thread)
    if (state.approval?.thread === thread) state.approval = null
    this.save(owner, state)
  }
  deleteProject(owner: string, project: string): void {
    const state = this.get(owner)
    delete state.glossary[project]
    this.save(owner, state)
  }
  erase(owner: string): void {
    this.store?.deleteRecord('workflow', owner)
    this.cache.delete(owner)
    this.owners.delete(owner)
  }
  delivered(
    owner: string,
    id: string,
    delivery: 'sent' | 'suppressed' = 'sent'
  ): void {
    const state = this.get(owner),
      task = state.tasks.find(item => item.id === id)
    if (task) {
      task.delivery = delivery
      this.save(owner, state)
    }
  }
  async tick(
    allowed: (owner: string) => boolean,
    deliver: (owner: string, task: Task) => Promise<void | 'queued'>
  ): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      if (!this.restored) {
        for (const [owner, state] of this.store?.records<WorkflowState>(
          'workflow'
        ) ?? []) {
          this.owners.add(owner)
          if (!this.cache.has(owner)) this.cache.set(owner, state)
        }
        this.restored = true
      }
      for (const owner of this.owners) {
        if (!allowed(owner)) continue
        for (const task of this.get(owner).tasks) {
          if (
            task.status !== 'open' ||
            task.dueAt === null ||
            task.dueAt > this.now() ||
            task.reminded ||
            task.attempts >= 3 ||
            task.nextAttempt > this.now()
          )
            continue
          const attempt = this.get(owner)
          const claim = attempt.tasks.find(item => item.id === task.id)
          if (!claim || claim.status !== 'open' || claim.dueAt !== task.dueAt)
            continue
          // Persist the attempt before the external effect so storage failures cannot
          // cause an unbounded stream of duplicate notifications.
          claim.attempts++
          claim.nextAttempt = this.now() + 60000
          this.save(owner, attempt)
          let sent = false
          let queuedDelivery = false
          try {
            const delivery = await deliver(owner, task)
            queuedDelivery = delivery === 'queued'
            sent = true
          } catch {
            /* Retry delivery only; no provider work. */
          }
          const current = this.get(owner),
            saved = current.tasks.find(item => item.id === task.id)
          if (saved && saved.dueAt === task.dueAt) {
            saved.reminded = sent
            if (sent) saved.delivery = queuedDelivery ? 'queued' : 'sent'
            this.save(owner, current)
          }
        }
      }
    } finally {
      this.ticking = false
    }
  }
}
