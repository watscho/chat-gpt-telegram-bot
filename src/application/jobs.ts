import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import type { Job, JobInput, QueueState, Schedule } from '../domain/jobs.js'
import type { ModelReply } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import type { StateStore } from '../domain/state.js'
import { interval, localTime } from './scheduling.js'

export interface WorkerPorts {
  allowed(owner: string): boolean
  available(owner: string, thread: string): boolean
  input(owner: string, thread: string, prompt: string): JobInput
  execute(owner: string, job: Job, signal: AbortSignal): Promise<ModelReply>
  deliver(owner: string, job: Job): Promise<void>
}
export class Jobs {
  private readonly local = new Map<string, QueueState>()
  private readonly running = new Map<string, AbortController>()
  private ticking = false
  private restored = false
  constructor(
    private readonly config: Config,
    private readonly ports: WorkerPorts,
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  private read(owner: string): QueueState {
    let queue = this.local.get(owner)
    if (!queue) {
      queue = this.store?.getRecord<QueueState>('queue', owner) ?? {
        jobs: [],
        schedules: []
      }
      this.local.set(owner, queue)
    }
    return queue
  }
  get(owner: string): QueueState {
    return structuredClone(this.read(owner))
  }
  private save(owner: string, queue: QueueState): void {
    this.store?.putRecord('queue', owner, queue)
    this.local.set(owner, structuredClone(queue))
  }
  private owners(): string[] {
    if (!this.restored) {
      for (const [owner, queue] of this.store?.records<QueueState>('queue') ??
        [])
        if (!this.local.has(owner)) this.local.set(owner, queue)
      this.restored = true
    }
    return [...this.local.keys()]
  }
  private bytes(queue: QueueState): number {
    return Buffer.byteLength(JSON.stringify(queue))
  }
  recover(): void {
    for (const owner of this.owners()) {
      const queue = this.get(owner)
      for (const job of queue.jobs) {
        job.input.memories = []
        if (job.state === 'running') {
          job.state = job.kind === 'reminder' ? 'queued' : 'uncertain'
          job.error =
            'The process stopped during this attempt. Paid work is not retried automatically.'
          job.updatedAt = this.now()
        }
      }
      this.save(owner, queue)
    }
  }
  enqueue(
    owner: string,
    thread: string,
    kind: Job['kind'],
    input: JobInput
  ): Job {
    if (
      !input.prompt.trim() ||
      input.prompt.length > this.config.maxInputCharacters
    )
      throw new UserError('Job instructions are empty or too long.')
    if (kind === 'compare' && input.documents.length < 2)
      throw new UserError('Comparison needs two reference documents.')
    const queue = this.get(owner)
    // Completed records may be explicitly deleted; never discard queued work silently.
    if (queue.jobs.length >= this.config.maxJobs)
      throw new UserError(
        'Job limit reached. Use /cancel or /job delete id to remove old work.'
      )
    const job: Job = {
      id: randomUUID().slice(0, 12),
      thread,
      kind,
      state: 'queued',
      createdAt: this.now(),
      updatedAt: this.now(),
      input: { ...input, memories: [] },
      result: null,
      error: '',
      delivery: 'pending',
      attempts: 0,
      nextDelivery: 0
    }
    queue.jobs.push(job)
    if (this.bytes(queue) > this.config.maxJobBytes)
      throw new UserError(
        'Queue payload budget exceeded. Remove old jobs or use smaller reference files.'
      )
    this.save(owner, queue)
    return structuredClone(job)
  }
  enqueueBatch(
    owner: string,
    thread: string,
    action: string,
    input: JobInput
  ): string {
    if (
      !['summarize', 'extract', 'table'].includes(action) ||
      !input.documents.length ||
      input.documents.length > 10 ||
      input.prompt.length > 1000
    )
      throw new UserError(
        'Choose summarize, extract or table and 1..10 files with at most 1000 instruction characters.'
      )
    const queue = this.get(owner)
    if (queue.jobs.length + input.documents.length > this.config.maxJobs)
      throw new UserError(
        'Not enough free job slots for this batch. Remove old jobs first.'
      )
    const group = randomUUID().slice(0, 12)
    for (const document of input.documents)
      queue.jobs.push({
        id: randomUUID().slice(0, 12),
        thread,
        kind: 'batch',
        batch: { group, action, file: document.name },
        state: 'queued',
        createdAt: this.now(),
        updatedAt: this.now(),
        input: {
          ...input,
          images: [],
          documents: [document],
          memories: [],
          prompt: `Process only the attached document ${document.name}. ${action === 'summarize' ? 'Provide a standalone summary, decisions and uncertainties.' : action === 'extract' ? 'Extract the requested fields with page/section evidence and mark missing values.' : 'Create a structured Markdown table with evidence and uncertainty.'} User instructions: ${input.prompt}`
        },
        result: null,
        error: '',
        delivery: 'pending',
        attempts: 0,
        nextDelivery: 0
      })
    if (this.bytes(queue) > this.config.maxJobBytes)
      throw new UserError(
        'Batch exceeds the queue payload budget. Use fewer or smaller files.'
      )
    this.save(owner, queue)
    return group
  }
  cancel(owner: string, id: string): void {
    const queue = this.get(owner)
    const job = queue.jobs.find(item => item.id === id)
    if (!job || !['queued', 'running'].includes(job.state))
      throw new UserError('No queued or running job with that ID.')
    job.state = 'cancelled'
    job.updatedAt = this.now()
    job.input = {
      prompt: '',
      documents: [],
      images: [],
      instructions: '',
      memories: []
    }
    this.running.get(`${owner}:${id}`)?.abort()
    this.save(owner, queue)
  }
  remove(owner: string, id: string): void {
    const queue = this.get(owner)
    const job = queue.jobs.find(item => item.id === id)
    if (!job) throw new UserError('Job not found.')
    if (job.state === 'running')
      throw new UserError('Cancel the running job first.')
    queue.jobs = queue.jobs.filter(item => item.id !== id)
    this.save(owner, queue)
  }
  schedule(
    owner: string,
    thread: string,
    kind: Schedule['kind'],
    expression: string,
    text: string,
    timezone: string
  ): Schedule {
    if (!text.trim() || text.length > this.config.maxInputCharacters)
      throw new UserError('Schedule text is empty or too long.')
    const queue = this.get(owner)
    if (queue.schedules.length >= this.config.maxSchedules)
      throw new UserError('Schedule limit reached.')
    const recurring = expression.startsWith('every ')
    const intervalMs = recurring ? interval(expression.slice(6)) : null
    const dueAt =
      intervalMs === null
        ? localTime(expression, timezone, this.now())
        : this.now() + intervalMs
    const schedule: Schedule = {
      id: randomUUID().slice(0, 12),
      thread,
      kind,
      text,
      timezone,
      dueAt,
      intervalMs
    }
    queue.schedules.push(schedule)
    this.save(owner, queue)
    return schedule
  }
  unschedule(owner: string, id: string): void {
    const queue = this.get(owner)
    if (!queue.schedules.some(item => item.id === id))
      throw new UserError('Schedule not found.')
    queue.schedules = queue.schedules.filter(item => item.id !== id)
    this.save(owner, queue)
  }
  cancelThread(owner: string, thread: string): void {
    const queue = this.get(owner)
    for (const job of queue.jobs)
      if (job.thread === thread && ['queued', 'running'].includes(job.state))
        this.cancel(owner, job.id)
    const current = this.get(owner)
    current.schedules = current.schedules.filter(
      schedule => schedule.thread !== thread
    )
    this.save(owner, current)
  }
  erase(owner: string): void {
    for (const [key, controller] of this.running)
      if (key.startsWith(`${owner}:`)) controller.abort()
    this.local.delete(owner)
    this.store?.deleteRecord('queue', owner)
  }
  async result(owner: string, id: string): Promise<void> {
    const job = this.get(owner).jobs.find(item => item.id === id)
    if (!job?.result) throw new UserError('No retained result for that job.')
    await this.ports.deliver(owner, job)
  }
  private due(owner: string): void {
    const current = this.read(owner)
    if (
      current.jobs.length >= this.config.maxJobs ||
      !current.schedules.some(schedule => schedule.dueAt <= this.now())
    )
      return
    const queue = structuredClone(current)
    let changed = false
    for (const schedule of [...queue.schedules]) {
      if (
        schedule.dueAt > this.now() ||
        queue.jobs.length >= this.config.maxJobs
      )
        continue
      const input =
        schedule.kind === 'reminder'
          ? {
              prompt: schedule.text,
              documents: [],
              images: [],
              instructions: '',
              memories: []
            }
          : this.ports.input(owner, schedule.thread, schedule.text)
      const job: Job = {
        id: randomUUID().slice(0, 12),
        thread: schedule.thread,
        kind: schedule.kind,
        state: 'queued',
        createdAt: this.now(),
        updatedAt: this.now(),
        input: { ...input, memories: [] },
        result: null,
        error: '',
        delivery: 'pending',
        attempts: 0,
        nextDelivery: 0
      }
      queue.jobs.push(job)
      if (this.bytes(queue) > this.config.maxJobBytes) {
        queue.jobs.pop()
        continue
      }
      changed = true
      if (schedule.intervalMs === null)
        queue.schedules = queue.schedules.filter(
          item => item.id !== schedule.id
        )
      else schedule.dueAt = this.now() + schedule.intervalMs
    }
    if (changed) this.save(owner, queue)
  }
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const owner of this.owners()) {
        if (!this.ports.allowed(owner)) continue
        this.due(owner)
        const next = this.read(owner).jobs.find(
          job =>
            job.state === 'queued' && this.ports.available(owner, job.thread)
        )
        if (next) {
          const controller = new AbortController()
          const key = `${owner}:${next.id}`
          this.running.set(key, controller)
          const queue = this.get(owner)
          const job = queue.jobs.find(item => item.id === next.id)!
          job.state = 'running'
          job.updatedAt = this.now()
          this.save(owner, queue)
          try {
            const result =
              job.kind === 'reminder'
                ? { text: job.input.prompt, images: [] }
                : await this.ports.execute(owner, job, controller.signal)
            const current = this.get(owner)
            const saved = current.jobs.find(item => item.id === job.id)
            if (saved?.state === 'running' && !controller.signal.aborted) {
              saved.result = result
              saved.state = 'succeeded'
              saved.updatedAt = this.now()
              saved.input = {
                prompt: '',
                documents: [],
                images: [],
                instructions: '',
                memories: []
              }
              this.save(owner, current)
            }
          } catch (error) {
            const current = this.get(owner)
            const saved = current.jobs.find(item => item.id === job.id)
            if (saved?.state === 'running') {
              saved.state = 'failed'
              saved.error =
                error instanceof UserError
                  ? error.message
                  : 'Unable to complete this attempt. Paid work is not retried automatically.'
              saved.updatedAt = this.now()
              this.save(owner, current)
            }
          } finally {
            this.running.delete(key)
          }
        }
        for (const job of this.read(owner).jobs) {
          if (
            job.state !== 'succeeded' ||
            job.delivery === 'sent' ||
            job.attempts >= 3 ||
            job.nextDelivery > this.now()
          )
            continue
          try {
            await this.ports.deliver(owner, job)
            const current = this.get(owner)
            const saved = current.jobs.find(item => item.id === job.id)
            if (saved) {
              saved.delivery = 'sent'
              this.save(owner, current)
            }
          } catch {
            const current = this.get(owner)
            const saved = current.jobs.find(item => item.id === job.id)
            if (saved) {
              saved.delivery = 'failed'
              saved.attempts++
              saved.nextDelivery = this.now() + 60000
              this.save(owner, current)
            }
          }
        }
      }
    } finally {
      this.ticking = false
    }
  }
  stop(): void {
    for (const controller of this.running.values()) controller.abort()
  }
}
