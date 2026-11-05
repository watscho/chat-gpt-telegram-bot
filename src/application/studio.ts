import type { RecipeStep, WorkflowSpec } from '../domain/suite.js'
import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import { UserError, type ModelReply } from '../domain/conversation.js'
import type { JobInput } from '../domain/jobs.js'
import type { StateStore } from '../domain/state.js'
import type {
  InboxItem,
  Mission,
  MissionStep,
  ResultVersion,
  StudioPorts,
  StudioState
} from '../domain/studio.js'
import { sourceList } from './sources.js'
const id = () => randomUUID().slice(0, 12)
export function studioEstimate(
  config: Config,
  kind: MissionStep['kind'],
  workflow?: WorkflowSpec
): number {
  if (kind === 'local') return 0
  if (kind === 'media')
    return (
      config.estimateTranscription +
      Math.ceil(config.suite.videoSeconds / 60) *
        config.workbench.estimateMeetingMinute
    )
  return (
    config.estimateChat +
    (workflow?.id === 'referee' && workflow.phase === 'review'
      ? config.suite.reviewExtra
      : 0) +
    (kind === 'search'
      ? config.estimateSearch * config.maxWebSearchCalls
      : kind === 'analysis'
        ? config.workbench.estimateAnalysis
        : kind === 'connection'
          ? config.workbench.estimateConnection
          : 0)
  )
}
export class Studio {
  private readonly cache = new Map<string, StudioState>()
  private readonly active = new Map<string, AbortController>()
  private ticking = false
  constructor(
    private readonly config: Config,
    private readonly ports: StudioPorts,
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  get(owner: string): StudioState {
    return structuredClone(
      this.cache.get(owner) ??
        this.store?.getRecord<StudioState>('studio', owner) ?? {
          collecting: {},
          inbox: [],
          missions: []
        }
    )
  }
  private save(owner: string, state: StudioState): void {
    if (Buffer.byteLength(JSON.stringify(state)) > this.config.maxJobBytes)
      throw new UserError(
        'Studio storage is full. Remove old Inbox items or missions first.'
      )
    this.store?.putRecord('studio', owner, state)
    this.cache.set(owner, structuredClone(state))
  }
  private owners(): string[] {
    return [
      ...new Set([
        ...(this.store?.records('studio') ?? []).map(([owner]) => owner),
        ...this.cache.keys()
      ])
    ]
  }
  refresh(owner: string): void {
    this.cache.delete(owner)
  }
  collecting(owner: string, thread: string, enabled?: boolean): boolean {
    const state = this.get(owner)
    if (enabled !== undefined) {
      state.collecting[thread] = enabled
      this.save(owner, state)
    }
    return state.collecting[thread] === true
  }
  capture(
    owner: string,
    value: Omit<InboxItem, 'id' | 'kind' | 'createdAt'>
  ): InboxItem {
    const state = this.get(owner),
      duplicate = state.inbox.find(item => item.source === value.source)
    if (duplicate) return duplicate
    if (
      state.inbox.length >= 100 ||
      value.text.length > this.config.maxInputCharacters ||
      !(
        value.text.trim() ||
        value.documents.length ||
        value.images.length ||
        value.recording
      )
    )
      throw new UserError(
        'Inbox needs content within the input limit and at most 100 retained items.'
      )
    const item: InboxItem = {
      ...value,
      id: id(),
      createdAt: this.now(),
      kind: value.recording
        ? 'recording'
        : value.documents.length || value.images.length
          ? 'files'
          : /^https:\/\/\S+$/.test(value.text.trim())
            ? 'link'
            : 'text'
    }
    state.inbox.push(item)
    this.save(owner, state)
    return structuredClone(item)
  }
  item(owner: string, itemId: string): InboxItem {
    const item = this.get(owner).inbox.find(item => item.id === itemId)
    if (!item) throw new UserError('Inbox item not found.')
    return item
  }
  assign(owner: string, itemId: string, project: string | null): void {
    const state = this.get(owner),
      item = state.inbox.find(item => item.id === itemId)
    if (!item) throw new UserError('Inbox item not found.')
    item.project = project
    this.save(owner, state)
  }
  removeItem(owner: string, itemId: string): void {
    this.item(owner, itemId)
    const state = this.get(owner)
    state.inbox = state.inbox.filter(item => item.id !== itemId)
    this.save(owner, state)
  }
  mission(owner: string, missionId: string): Mission {
    const mission = this.get(owner).missions.find(item => item.id === missionId)
    if (!mission) throw new UserError('Mission not found.')
    return mission
  }
  private step(
    kind: MissionStep['kind'],
    title: string,
    prompt: string,
    connection: string | null = null
  ): MissionStep {
    return {
      kind,
      title,
      prompt,
      connection,
      state: 'queued',
      attempt: 0,
      receipt: null,
      events: [],
      output: null,
      approval: null,
      continuation: null,
      estimate: studioEstimate(this.config, kind)
    }
  }
  plan(
    owner: string,
    thread: string,
    mode: Mission['mode'],
    input: JobInput,
    chain: { connection: string; prompt: string }[] = [],
    custom: RecipeStep[] = []
  ): Mission {
    if (!this.store || this.config.statePath === ':memory:')
      throw new UserError(
        'Missions require persistent state for checkpoints and receipts.'
      )
    if (
      !input.prompt.trim() ||
      input.prompt.length > this.config.maxInputCharacters
    )
      throw new UserError('Mission instructions are empty or too long.')
    if (
      input.documents.length > 10 ||
      input.images.length > 10 ||
      input.documents.some(
        file =>
          !file.data ||
          Buffer.byteLength(file.data, 'base64') > this.config.maxDocumentBytes
      ) ||
      input.images.some(
        image =>
          !image.data ||
          Buffer.byteLength(image.data, 'base64') > this.config.maxImageBytes
      )
    )
      throw new UserError(
        'Mission materials exceed the configured file/count limits.'
      )
    const state = this.get(owner)
    if (state.missions.length >= 20)
      throw new UserError(
        'Mission limit reached (20). Delete old missions first.'
      )
    let steps: MissionStep[]
    if (mode === 'workflow') {
      if (
        !custom.length ||
        custom.length > 10 ||
        custom.some(
          step =>
            ![
              'compose',
              'search',
              'analysis',
              'connection',
              'media',
              'local'
            ].includes(step.kind) ||
            !step.title.trim() ||
            step.title.length > 100 ||
            !step.prompt.trim() ||
            step.prompt.length > 2000 ||
            ((step.kind === 'media' || step.kind === 'local') &&
              !step.workflow &&
              !step.routine) ||
            (step.kind === 'connection' &&
              !this.config.workbench.connections.some(
                connection =>
                  connection.owner === Number(owner.split(':')[0]) &&
                  connection.id === step.connection
              ))
        )
      )
        throw new UserError(
          'Workflow recipe steps or connections exceed the supported scope.'
        )
      steps = custom.map(spec => ({
        ...this.step(spec.kind, spec.title, spec.prompt, spec.connection),
        ...(spec.workflow ? { workflow: structuredClone(spec.workflow) } : {}),
        ...(spec.routine ? { routine: structuredClone(spec.routine) } : {}),
        estimate: studioEstimate(this.config, spec.kind, spec.workflow)
      }))
    } else if (mode === 'chain') {
      if (
        !chain.length ||
        chain.length > 4 ||
        chain.some(
          item =>
            !item.prompt.trim() ||
            item.prompt.length > 2000 ||
            !this.config.workbench.connections.some(
              connection =>
                connection.owner === Number(owner.split(':')[0]) &&
                connection.id === item.connection
            )
        )
      )
        throw new UserError(
          'Choose 1..4 configured connections with 1..2000 instruction characters per step.'
        )
      steps = [
        this.step(
          'compose',
          'Prepare action drafts',
          'Prepare complete drafts and facts for the requested service sequence from the supplied material. Do not execute actions or invent recipients, deadlines or identities.'
        ),
        ...chain.map((item, index) =>
          this.step(
            'connection',
            `Service ${index + 1}: ${item.connection}`,
            item.prompt,
            item.connection
          )
        )
      ]
    } else if (mode === 'research') {
      steps = [
        this.step(
          'search',
          'Collect public evidence',
          'Find several independent, preferably primary sources for the question. Record dates, attributable claims, URLs and missing evidence. Never invent citations.'
        ),
        this.step(
          'search',
          'Check contradictions',
          'Independently search for counter-evidence and outdated or conflicting claims. Distinguish corroborated, disputed and unsupported claims; state gaps and dates.'
        ),
        this.step(
          'compose',
          'Write research brief',
          'Write a source-backed brief with findings, contradictions, uncertainties and next steps. Cite only supplied source URLs beside claims. A model assessment is not independent factual certification.'
        )
      ]
    } else {
      const analysis =
        input.documents.length > 0 &&
        input.documents.every(file =>
          /\.(csv|xlsx|json|txt|md|pdf)$/i.test(file.name)
        )
      steps = [
        this.step(
          analysis ? 'analysis' : 'compose',
          'Inspect material',
          analysis
            ? 'Inspect the selected data, calculate supported summaries and produce useful downloadable artifacts. State missing data and uncertainty.'
            : 'Inspect the supplied material and task. Identify facts, missing inputs and a practical structure. Do not invent completed actions.'
        ),
        this.step(
          'compose',
          'Prepare deliverable',
          'Prepare a usable deliverable for the requested goal using the inspected material. Preserve source references and generated files. State assumptions.'
        ),
        this.step(
          'compose',
          'Review and finalize',
          'Review the draft against supplied evidence and calculations. Correct unsupported claims, identify remaining uncertainty and produce the complete final deliverable. Do not claim independent verification or external actions.'
        )
      ]
    }
    const mission: Mission = {
      id: id(),
      thread,
      project: input.project ?? null,
      title: input.prompt.trim().slice(0, 100),
      mode,
      revision: 1,
      state: 'draft',
      createdAt: this.now(),
      expiresAt: this.now() + 600000,
      input: { ...input, memories: [] },
      steps,
      versions: [],
      selected: null,
      noticeRevision: 0
    }
    if (mode === 'research') {
      mission.input.documents = []
      mission.input.images = []
      mission.input.instructions = ''
    }
    state.missions.push(mission)
    this.save(owner, state)
    return structuredClone(mission)
  }
  estimate(mission: Mission): number {
    return mission.steps
      .filter(step => step.state !== 'done')
      .reduce((sum, step) => sum + step.estimate, 0)
  }
  private change(
    owner: string,
    missionId: string,
    revision: number,
    action: (mission: Mission) => void
  ): Mission {
    const state = this.get(owner),
      mission = state.missions.find(item => item.id === missionId)
    if (!mission || mission.revision !== revision)
      throw new UserError(
        'Mission changed or was removed. Open a fresh review.'
      )
    action(mission)
    mission.revision++
    this.save(owner, state)
    return structuredClone(mission)
  }
  start(owner: string, missionId: string, revision: number): Mission {
    return this.change(owner, missionId, revision, mission => {
      if (mission.state !== 'draft' || mission.expiresAt <= this.now())
        throw new UserError(
          'Plan expired or already started. Create or revise a fresh plan.'
        )
      mission.state = 'queued'
    })
  }
  editPlan(
    owner: string,
    missionId: string,
    revision: number,
    index: number,
    prompt: string
  ): Mission {
    return this.change(owner, missionId, revision, mission => {
      const step = mission.steps[index]
      if (
        mission.state !== 'draft' ||
        !step ||
        step.state !== 'queued' ||
        !prompt.trim() ||
        prompt.length > 2000
      )
        throw new UserError('Edit a queued draft step with 1..2000 characters.')
      step.prompt = prompt
      mission.expiresAt = this.now() + 600000
    })
  }
  control(
    owner: string,
    missionId: string,
    revision: number,
    action: 'pause' | 'resume' | 'cancel' | 'retry'
  ): Mission {
    const mission = this.change(owner, missionId, revision, mission => {
      if (action === 'pause') {
        if (mission.state !== 'queued')
          throw new UserError(
            'Pause between steps; wait for the active step or cancel it.'
          )
        mission.state = 'paused'
      } else if (action === 'resume') {
        if (mission.state !== 'paused')
          throw new UserError('Only paused missions can resume.')
        mission.state = 'queued'
      } else if (action === 'retry') {
        if (
          mission.state !== 'uncertain' &&
          !(
            mission.state === 'review' &&
            mission.steps.some(
              step => step.approval && step.approval.expiresAt <= this.now()
            )
          )
        )
          throw new UserError(
            'Only uncertain steps can be retried after checking external receipts.'
          )
        const step = mission.steps.find(
          step => step.state === 'uncertain' || step.state === 'review'
        )!
        step.state = 'queued'
        step.continuation = null
        step.approval = null
        mission.state = 'draft'
        mission.expiresAt = this.now() + 600000
      } else {
        if (mission.state === 'done' || mission.state === 'cancelled')
          throw new UserError('Mission is already finished.')
        mission.state = 'cancelled'
        for (const step of mission.steps) {
          if (step.state === 'running') {
            step.state = 'uncertain'
            step.receipt = {
              at: this.now(),
              text: 'Cancelled while in flight. Provider outcome may be unknown; this mission remains cancelled.'
            }
          }
          step.approval = null
          step.continuation = null
        }
      }
    })
    if (action === 'cancel') this.active.get(`${owner}:${missionId}`)?.abort()
    return mission
  }
  approve(
    owner: string,
    missionId: string,
    revision: number,
    token: string,
    accepted: boolean
  ): Mission {
    return this.change(owner, missionId, revision, mission => {
      const step = mission.steps.find(step => step.state === 'review'),
        approval = step?.approval
      if (
        mission.state !== 'review' ||
        !step ||
        !approval ||
        approval.token !== token ||
        approval.expiresAt <= this.now()
      )
        throw new UserError(
          'External review expired or changed. Retry only after checking the service.'
        )
      if (step.events.length >= 20)
        throw new UserError(
          'External review event limit reached. Cancel and inspect service receipts.'
        )
      step.events.push({
        at: this.now(),
        state: accepted ? 'approved' : 'rejected',
        text: approval.value.calls
          .map(call => `${call.name}: ${call.arguments}`)
          .join('\n')
      })
      step.approval = null
      if (accepted) {
        step.continuation = approval.value.continuation
        step.state = 'queued'
        mission.state = 'queued'
      } else {
        step.continuation = null
        mission.state = 'cancelled'
      }
    })
  }
  recover(): void {
    for (const owner of this.owners()) {
      const state = this.get(owner)
      let changed = false
      for (const mission of state.missions) {
        for (const step of mission.steps)
          if (step.state === 'running') {
            step.state = 'uncertain'
            step.continuation = null
            step.approval = null
            step.receipt = {
              at: this.now(),
              text: 'Interrupted attempt; outcome unknown. Check the provider before an explicit paid retry.'
            }
            mission.state = 'uncertain'
            mission.revision++
            changed = true
          }
      }
      if (changed) this.save(owner, state)
    }
  }
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const owner of this.owners()) {
        if (!this.ports.allowed(owner)) continue
        for (const notice of this.get(owner).missions.filter(
          mission =>
            ['done', 'review', 'uncertain', 'paused'].includes(mission.state) &&
            mission.noticeRevision !== mission.revision
        )) {
          const state = this.get(owner),
            saved = state.missions.find(item => item.id === notice.id)!
          saved.noticeRevision = saved.revision
          this.save(owner, state)
          await this.ports.notify(owner, notice).catch(() => undefined)
        }
        const mission = this.get(owner).missions.find(
          mission =>
            mission.state === 'queued' &&
            this.ports.available(owner, mission.thread)
        )
        if (!mission) continue
        const index = mission.steps.findIndex(step => step.state === 'queued'),
          controller = new AbortController(),
          key = `${owner}:${mission.id}`
        this.active.set(key, controller)
        try {
          const claimed = this.change(
            owner,
            mission.id,
            mission.revision,
            current => {
              current.state = 'running'
              current.steps[index]!.state = 'running'
              current.steps[index]!.attempt++
            }
          )
          const step = claimed.steps[index]!
          const result = await this.ports.execute(
            owner,
            claimed,
            step,
            controller.signal
          )
          const current = this.mission(owner, mission.id)
          if (current.state !== 'running' || controller.signal.aborted) continue
          this.change(owner, mission.id, current.revision, saved => {
            const target = saved.steps[index]!
            target.continuation = null
            if (result.approval) {
              target.state = 'review'
              target.approval = {
                token: id(),
                expiresAt: this.now() + 600000,
                value: result.approval
              }
              target.receipt = {
                at: this.now(),
                text: 'Tool proposal received. No proposed action was approved by this workflow.'
              }
              saved.state = 'review'
            } else {
              target.events.push({
                at: this.now(),
                state: 'reported',
                text: result.text.slice(0, 4000)
              })
              target.output = { ...result, sources: sourceList(result.sources) }
              target.state = 'done'
              target.receipt = {
                at: this.now(),
                text: 'Provider response received; external outcomes are only as reported in the tool result.'
              }
              saved.state = saved.steps.every(step => step.state === 'done')
                ? 'done'
                : 'queued'
              if (saved.mode === 'chain' && index === 0) {
                this.append(saved, target.output, 'Reviewed action draft')
                saved.state = 'paused'
              }
              if (saved.state === 'done')
                this.append(
                  saved,
                  target.output,
                  `Mission result ${saved.versions.length + 1}`
                )
            }
          })
        } catch (error) {
          const state = this.get(owner),
            saved = state.missions.find(item => item.id === mission.id)
          if (saved?.state === 'running') {
            saved.state = 'uncertain'
            saved.revision++
            const step = saved.steps[index]!
            step.state = 'uncertain'
            step.continuation = null
            step.approval = null
            step.receipt = {
              at: this.now(),
              text:
                error instanceof UserError
                  ? error.message
                  : 'Attempt failed or acknowledgement was lost. No automatic paid retry. Check external state before retrying.'
            }
            this.save(owner, state)
          }
        } finally {
          this.active.delete(key)
        }
      }
    } finally {
      this.ticking = false
    }
  }
  private append(
    mission: Mission,
    reply: ModelReply,
    label: string
  ): ResultVersion {
    if (
      mission.versions.length >= 10 ||
      !reply.text.trim() ||
      reply.text.length > 60000
    )
      throw new UserError(
        'Result needs 1..60000 characters and at most 10 versions. Create another mission for further revisions.'
      )
    const version: ResultVersion = {
      id: id(),
      parent: mission.selected,
      label,
      createdAt: this.now(),
      reply: structuredClone(reply)
    }
    mission.versions.push(version)
    mission.selected = version.id
    return version
  }
  result(owner: string, missionId: string, versionId?: string): ResultVersion {
    const mission = this.mission(owner, missionId),
      version = mission.versions.find(
        version => version.id === (versionId ?? mission.selected)
      )
    if (!version) throw new UserError('Result version not found.')
    return version
  }
  editResult(
    owner: string,
    missionId: string,
    revision: number,
    text: string
  ): Mission {
    return this.change(owner, missionId, revision, mission => {
      if (mission.state !== 'done' && mission.state !== 'paused')
        throw new UserError(
          'Edit only a completed result before proposing another revision.'
        )
      const current = this.result(owner, missionId)
      this.append(mission, { ...current.reply, text }, 'Manual edit')
    })
  }
  restore(
    owner: string,
    missionId: string,
    revision: number,
    versionId: string
  ): Mission {
    return this.change(owner, missionId, revision, mission => {
      if (mission.state !== 'done' && mission.state !== 'paused')
        throw new UserError(
          'Restore only a completed result before proposing another revision.'
        )
      this.result(owner, missionId, versionId)
      mission.selected = versionId
    })
  }
  revise(
    owner: string,
    missionId: string,
    revision: number,
    instructions: string
  ): Mission {
    return this.change(owner, missionId, revision, mission => {
      if (
        mission.state !== 'done' ||
        mission.steps.length >= 10 ||
        mission.versions.length >= 10 ||
        !instructions.trim() ||
        instructions.length > 2000
      )
        throw new UserError(
          'Revise a completed mission with 1..2000 instruction characters within the version/step limits.'
        )
      this.result(owner, missionId)
      const final = mission.steps.at(-1)!,
        kind = mission.steps[0]!.kind === 'analysis' ? 'analysis' : 'compose'
      mission.steps.push({
        ...this.step(kind, 'Revise selected result', instructions),
        ...(final.workflow && final.kind === 'compose'
          ? { workflow: structuredClone(final.workflow) }
          : {}),
        estimate: studioEstimate(
          this.config,
          kind,
          final.kind === 'compose' ? final.workflow : undefined
        )
      })
      mission.state = 'draft'
      mission.expiresAt = this.now() + 600000
    })
  }
  remove(owner: string, missionId: string): void {
    const mission = this.mission(owner, missionId)
    if (mission.state === 'running')
      throw new UserError('Cancel the running mission first.')
    const state = this.get(owner)
    state.missions = state.missions.filter(item => item.id !== missionId)
    this.save(owner, state)
  }
  deleteThread(owner: string, thread: string): void {
    const state = this.get(owner)
    for (const mission of state.missions)
      if (
        mission.thread === thread &&
        mission.state !== 'done' &&
        mission.state !== 'cancelled'
      )
        this.control(owner, mission.id, mission.revision, 'cancel')
    const current = this.get(owner)
    delete current.collecting[thread]
    this.save(owner, current)
  }
  erase(owner: string): void {
    for (const [key, controller] of this.active)
      if (key.startsWith(`${owner}:`)) controller.abort()
    this.store?.deleteRecord('studio', owner)
    this.cache.delete(owner)
  }
  stop(): void {
    for (const controller of this.active.values()) controller.abort()
  }
}
