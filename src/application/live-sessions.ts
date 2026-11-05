import type { Config } from '../config.js'
import type { ProviderWorkbench } from '../domain/workbench.js'
import { UserError } from '../domain/conversation.js'
import { ResourceJournal } from './resource-journal.js'
import { UsageLedger } from './usage.js'
import { Workspaces } from './workspaces.js'

export class LiveSessions {
  private readonly opening = new Set<string>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly calls = new Map<
    string,
    { owner: string; id: string; expiresAt: number }
  >()
  private stopped = false
  constructor(
    private readonly config: Config,
    private readonly provider: ProviderWorkbench | undefined,
    private readonly journal: ResourceJournal,
    private readonly usage: UsageLedger,
    private readonly workspaces: Workspaces,
    private readonly now = Date.now
  ) {
    this.journal.recoverCalls()
  }
  get count(): number {
    return this.opening.size + this.journal.callCount()
  }
  status(
    owner: string,
    thread: string
  ): {
    enabled: boolean
    seconds: number
    estimate: number
    project: string | null
  } {
    const project = this.workspaces.project(owner, thread)
    return {
      enabled:
        !!this.provider &&
        !!this.config.workbench.miniAppURL &&
        this.journal.durable &&
        this.config.statePath !== ':memory:' &&
        !this.stopped,
      seconds: this.config.workbench.liveSeconds,
      estimate:
        this.config.estimateVoice +
        Math.ceil(this.config.workbench.liveSeconds / 60) *
          this.config.workbench.estimateLiveMinute,
      project: project?.title ?? null
    }
  }
  async open(
    owner: string,
    thread: string,
    offer: string,
    mode: string
  ): Promise<{ id: string; sdp: string; expiresAt: number }> {
    const parts = owner.split(':')
    if (
      parts.length !== 2 ||
      parts[0] !== parts[1] ||
      !this.config.allowedUsers.has(Number(parts[0]))
    )
      throw new UserError('Live audio is unavailable for this user.')
    if (!this.provider || !this.config.workbench.miniAppURL || this.stopped)
      throw new UserError('Live audio is not configured or is stopping.')
    if (this.config.statePath === ':memory:' || !this.journal.durable)
      throw new UserError('Live audio requires persistent state for cleanup.')
    if (
      !offer.startsWith('v=0') ||
      offer.length > 100000 ||
      !['conversation', 'language', 'interview'].includes(mode)
    )
      throw new UserError('Invalid live audio request.')
    if (
      this.opening.has(owner) ||
      this.journal.entries(owner).some(item => item.kind === 'call')
    )
      throw new UserError(
        'A live session is already active or awaiting cleanup. Close it first.'
      )
    if (this.count >= this.config.maxConcurrentRequests)
      throw new UserError('Live audio capacity is full. Try later.')
    this.opening.add(owner)
    const settings = this.workspaces.thread(owner, thread)
    let reservation: ReturnType<UsageLedger['reserve']> | undefined
    try {
      reservation = this.usage.reserve(
        owner,
        'voice',
        false,
        settings.project,
        Math.ceil(this.config.workbench.liveSeconds / 60) *
          this.config.workbench.estimateLiveMinute
      )
      const instructions = `You are an AI voice assistant. Be clear that your voice is AI-generated. ${mode === 'language' ? 'Help the user practice a language; gently correct mistakes and keep turns short.' : mode === 'interview' ? 'Run a practice interview, one question at a time, then give constructive feedback.' : 'Have a helpful concise conversation.'} Answer language: ${settings.answerLanguage ?? 'auto'}. No Telegram history, files, notes or external tools are supplied. Greet briefly and ask how to begin.`
      const call = await this.provider.live(offer, instructions)
      const expiresAt = this.now() + this.config.workbench.liveSeconds * 1000
      try {
        this.journal.remember(
          owner,
          { kind: 'call', id: call.id },
          false,
          expiresAt
        )
      } catch (error) {
        await this.provider
          .remove({ kind: 'call', id: call.id })
          .catch(() => undefined)
        throw error
      }
      if (this.stopped) {
        this.journal.retire(owner, [{ kind: 'call', id: call.id }])
        await this.journal.removeNow(owner, { kind: 'call', id: call.id })
        throw new UserError('Live audio is stopping.')
      }
      this.calls.set(call.id, { owner, id: call.id, expiresAt })
      const timer = setTimeout(() => {
        void this.close(owner, call.id).catch(() => undefined)
      }, this.config.workbench.liveSeconds * 1000)
      timer.unref()
      this.timers.set(call.id, timer)
      reservation.finish()
      return { ...call, expiresAt }
    } catch (error) {
      reservation?.fail()
      throw error
    } finally {
      this.opening.delete(owner)
    }
  }
  async close(owner: string, id: string): Promise<void> {
    const entry = this.journal
      .entries(owner)
      .find(item => item.kind === 'call' && item.id === id)
    if (!entry) throw new UserError('Live session was not found for this user.')
    this.journal.retire(owner, [{ kind: 'call', id }])
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
    const removed = await this.journal.removeNow(owner, { kind: 'call', id })
    if (removed) this.calls.delete(id)
    if (!removed)
      throw new UserError(
        'Live shutdown is awaiting provider cleanup. Close the browser microphone; cleanup will retry.'
      )
  }
  recover(): void {
    for (const [id, call] of this.calls)
      if (
        !this.journal
          .entries(call.owner)
          .some(item => item.kind === 'call' && item.id === id)
      ) {
        const timer = this.timers.get(id)
        if (timer) clearTimeout(timer)
        this.timers.delete(id)
        this.calls.delete(id)
      }
  }
  async stop(): Promise<void> {
    this.stopped = true
    for (const call of [...this.calls.values()])
      await this.close(call.owner, call.id).catch(() => undefined)
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}
