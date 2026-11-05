import { createHash, randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import type {
  Document,
  Message,
  ModelReply,
  ReplyOptions
} from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import type { StateStore } from '../domain/state.js'
import type {
  ProviderWorkbench,
  Resource,
  ToolApproval,
  WorkbenchRequest,
  WorkbenchState,
  Recording
} from '../domain/workbench.js'
import { Workspaces } from './workspaces.js'
import { ResourceJournal } from './resource-journal.js'

export class Workbench {
  private readonly cache = new Map<string, WorkbenchState>()
  private readonly busy = new Set<string>()
  private readonly busyHashes = new Set<string>()
  readonly journal: ResourceJournal
  constructor(
    private readonly config: Config,
    private readonly workspaces: Workspaces,
    private readonly provider?: ProviderWorkbench,
    private readonly store?: StateStore,
    private readonly now = Date.now,
    private readonly resolveConnection?: (
      owner: string,
      id: string
    ) => import('../domain/workbench.js').Connection
  ) {
    this.journal = new ResourceJournal(
      { remove: resource => this.port().remove(resource) },
      store,
      now
    )
  }
  port(): ProviderWorkbench {
    if (!this.provider)
      throw new UserError(
        'Provider workbench is not configured. Check the installation guide.'
      )
    return this.provider
  }
  enabled(): boolean {
    return this.provider !== undefined
  }
  get(owner: string): WorkbenchState {
    const state = structuredClone(
      this.cache.get(owner) ??
        this.store?.getRecord<WorkbenchState>('provider-workbench', owner) ?? {
          projects: {},
          approval: null,
          recording: null
        }
    )
    if (state.approval && state.approval.expiresAt <= this.now()) {
      state.approval = null
      this.save(owner, state)
    }
    if (state.recording && state.recording.expiresAt <= this.now()) {
      state.recording = null
      this.save(owner, state)
    }
    return state
  }
  private save(owner: string, state: WorkbenchState): void {
    if (Buffer.byteLength(JSON.stringify(state)) > 1000000)
      throw new UserError(
        'Provider workspace exceeds 1 MB. Clear old cloud references first.'
      )
    this.store?.putRecord('provider-workbench', owner, state)
    this.cache.set(owner, structuredClone(state))
  }
  estimate(request: WorkbenchRequest): number {
    if (request.kind === 'analysis')
      return this.config.workbench.estimateAnalysis
    if (request.kind === 'index') return this.config.workbench.estimateIndex
    if (request.kind === 'connection')
      return this.config.workbench.estimateConnection
    return this.config.estimateSearch
  }
  validate(owner: string, thread: string, request: WorkbenchRequest): void {
    const parts = owner.split(':')
    if (
      parts.length !== 2 ||
      parts[0] !== parts[1] ||
      !this.config.allowedUsers.has(Number(parts[0]))
    )
      throw new UserError('Provider workspace is not available for this owner.')
    this.port()
    if (!this.store || this.config.statePath === ':memory:')
      throw new UserError(
        'Provider workflows require persistent state for resource tracking.'
      )
    const project = this.workspaces.thread(owner, thread).project
    if (project !== request.project)
      throw new UserError(
        'The selected project changed. Create a fresh context preview.'
      )
    if (
      project &&
      !this.workspaces.get(owner).projects.some(item => item.id === project)
    )
      throw new UserError('The selected project no longer exists.')
    if ((request.kind === 'index' || request.kind === 'knowledge') && !project)
      throw new UserError('Select a project before using cloud knowledge.')
    if (
      request.kind === 'connection' &&
      !this.config.workbench.connections.some(
        item =>
          item.owner === Number(parts[0]) && item.id === request.connection
      )
    )
      throw new UserError(
        'Connection is not configured for this Telegram user.'
      )
    if (request.kind === 'connection')
      this.resolveConnection?.(owner, request.connection)
  }
  preflight(
    owner: string,
    thread: string,
    request: WorkbenchRequest,
    files: Document[]
  ): void {
    this.validate(owner, thread, request)
    if (
      request.kind === 'analysis' &&
      (!files.length ||
        files.length > 10 ||
        files.some(file => !/\.(csv|xlsx|json|txt|md|pdf)$/i.test(file.name)))
    )
      throw new UserError(
        'Analysis needs 1..10 supported data files. Keep at least one file in the context preview.'
      )
    if (request.kind === 'index' && files.length !== 1)
      throw new UserError('Keep exactly one file in the upload preview.')
    if (
      (request.kind === 'analysis' || request.kind === 'index') &&
      (files.some(
        file =>
          !Buffer.from(file.data, 'base64').length ||
          Buffer.from(file.data, 'base64').length > this.config.maxDocumentBytes
      ) ||
        files.reduce(
          (sum, file) => sum + Buffer.from(file.data, 'base64').length,
          0
        ) > this.config.maxProjectBytes)
    )
      throw new UserError(
        'Provider input files exceed the configured byte limits.'
      )
    if (
      request.kind === 'knowledge' &&
      !this.get(owner).projects[request.project!]?.files.some(
        file =>
          file.status === 'completed' && file.createdAt + 604800000 > this.now()
      )
    )
      throw new UserError(
        'No completed, unexpired cloud files. Use /knowledge status or upload a reference.'
      )
  }
  private files(messages: readonly Message[]): Document[] {
    const all = messages.flatMap(message => message.documents ?? [])
    return all.filter(
      (file, index) =>
        all.findIndex(
          item => item.name === file.name && item.data === file.data
        ) === index
    )
  }
  async run(
    messages: readonly Message[],
    options: ReplyOptions
  ): Promise<ModelReply> {
    const scope = options.scope,
      request = options.workbench
    if (!scope || !request)
      throw new UserError('Provider request scope is missing.')
    this.validate(scope.owner, scope.thread, request)
    if (this.busy.has(scope.owner))
      throw new UserError('Another provider operation is running. Please wait.')
    this.busy.add(scope.owner)
    this.busyHashes.add(this.journal.key(scope.owner))
    try {
      if (request.kind === 'analysis')
        return await this.analysis(scope.owner, messages, options)
      if (request.kind === 'index')
        return await this.index(
          scope.owner,
          scope.project!,
          this.files(messages),
          options.signal
        )
      if (request.kind === 'connection') {
        const connection = this.config.workbench.connections.find(
          item =>
            item.owner === Number(scope.owner.split(':')[0]) &&
            item.id === request.connection
        )!
        return await this.port().connection(
          this.resolveConnection?.(scope.owner, request.connection) ??
            connection,
          messages,
          options,
          request.continuation
        )
      }
      return await this.knowledge(
        scope.owner,
        scope.project!,
        messages,
        options
      )
    } finally {
      this.busy.delete(scope.owner)
      this.busyHashes.delete(this.journal.key(scope.owner))
    }
  }
  private async record(
    owner: string,
    resource: Resource,
    active = false
  ): Promise<void> {
    try {
      this.journal.remember(owner, resource, active)
    } catch (error) {
      await this.port()
        .remove(resource)
        .catch(() => undefined)
      throw error
    }
  }
  private async analysis(
    owner: string,
    messages: readonly Message[],
    options: ReplyOptions
  ): Promise<ModelReply> {
    const files = this.files(messages)
    if (
      !files.length ||
      files.length > 10 ||
      files.some(file => !/\.(csv|xlsx|json|txt|md|pdf)$/i.test(file.name))
    )
      throw new UserError(
        'Analysis needs 1..10 CSV, XLSX, JSON, text, Markdown or PDF files.'
      )
    const resources: Resource[] = []
    try {
      for (const file of files) {
        const id = await this.port().upload(file, options.signal)
        const resource = { kind: 'file' as const, id }
        resources.push(resource)
        await this.record(owner, resource)
      }
      const id = await this.port().container(
          resources.map(item => item.id),
          options.signal
        ),
        resource = { kind: 'container' as const, id }
      resources.push(resource)
      await this.record(owner, resource)
      return await this.port().analysis(id, messages.at(-1)!.content, options)
    } finally {
      for (const resource of [...resources].reverse())
        await this.journal.removeNow(owner, resource).catch(() => false)
    }
  }
  private async index(
    owner: string,
    project: string,
    files: Document[],
    signal?: AbortSignal
  ): Promise<ModelReply> {
    if (files.length !== 1)
      throw new UserError(
        'Choose exactly one document to upload into cloud knowledge.'
      )
    const file = files[0]!,
      bytes = Buffer.from(file.data, 'base64').length
    if (!bytes || bytes > this.config.maxDocumentBytes)
      throw new UserError('Cloud upload exceeds the configured document limit.')
    const state = this.get(owner),
      existing = state.projects[project],
      hash = createHash('sha256').update(file.data).digest('hex')
    if (
      existing?.files.some(
        item => item.hash === hash && item.createdAt + 604800000 > this.now()
      )
    )
      return {
        text: 'That file is already tracked. Use /knowledge status to inspect indexing.',
        images: []
      }
    if (
      (existing?.files.length ?? 0) >= 20 ||
      Object.values(state.projects)
        .flatMap(item => item.files)
        .reduce((sum, item) => sum + item.bytes, 0) +
        bytes >
        this.config.maxProjectBytes
    )
      throw new UserError(
        'Cloud knowledge exceeds 20 files per project or the owner file-byte ceiling. Clear old cloud files first.'
      )
    if (!existing) {
      const id = await this.port().createStore(signal)
      await this.record(owner, { kind: 'store', id }, true)
      state.projects[project] = { store: id, files: [] }
      this.save(owner, state)
    }
    const id = await this.port().upload(file, signal, 604800)
    await this.record(owner, { kind: 'file', id }, true)
    const current = this.get(owner)
    current.projects[project]!.files.push({
      id,
      name: file.name,
      hash,
      status: 'indexing',
      createdAt: this.now(),
      bytes
    })
    this.save(owner, current)
    try {
      const status = await this.port().attach(
        current.projects[project]!.store,
        id,
        signal
      )
      const updated = this.get(owner)
      updated.projects[project]!.files.find(item => item.id === id)!.status =
        status
      this.save(owner, updated)
      return {
        text: `Cloud file ${id}: ${status}. Retention is at most seven days; use /knowledge status, /knowledge ask question or /knowledge remove ID.`,
        images: []
      }
    } catch (error) {
      const failed = this.get(owner)
      failed.projects[project]!.files.find(item => item.id === id)!.status =
        'failed'
      this.save(owner, failed)
      throw error
    }
  }
  async status(
    owner: string,
    project: string,
    signal?: AbortSignal
  ): Promise<string> {
    const state = this.get(owner),
      library = state.projects[project]
    if (!library)
      return 'No cloud files in this project. Reply to a file with /knowledge add.'
    for (const file of library.files)
      if (file.status === 'indexing' && file.createdAt + 604800000 > this.now())
        file.status = await this.port().fileStatus(
          library.store,
          file.id,
          signal
        )
    this.save(owner, state)
    return (
      library.files
        .map(
          file =>
            `${file.id}: ${file.name} · ${file.createdAt + 604800000 <= this.now() ? 'expired; re-upload' : file.status}`
        )
        .join('\n') || 'No cloud files.'
    )
  }
  private async knowledge(
    owner: string,
    project: string,
    messages: readonly Message[],
    options: ReplyOptions
  ): Promise<ModelReply> {
    const library = this.get(owner).projects[project]
    const allowed =
      library?.files.filter(
        item =>
          item.status === 'completed' && item.createdAt + 604800000 > this.now()
      ) ?? []
    if (!library || !allowed.length)
      throw new UserError(
        'No completed, unexpired cloud files. Use /knowledge status or add a reference.'
      )
    const hits = (
      await this.port().search(
        library.store,
        messages.at(-1)!.content,
        options.signal
      )
    )
      .filter(
        hit => allowed.some(file => file.id === hit.file) && hit.text.trim()
      )
      .slice(0, 5)
    if (!hits.length)
      throw new UserError(
        'No matching evidence in this project. No answer was generated.'
      )
    return this.port().grounded(
      messages,
      hits.map((hit, index) => ({
        label: `K${index + 1}`,
        title: hit.name.slice(0, 256),
        text: hit.text.slice(0, 1200)
      })),
      options
    )
  }
  clear(owner: string, project: string, file?: string): void {
    const state = this.get(owner),
      library = state.projects[project]
    if (!library) throw new UserError('No cloud library for this project.')
    if (file && !library.files.some(item => item.id === file))
      throw new UserError('Cloud file not found in this project.')
    const resources: Resource[] = library.files
      .filter(item => !file || item.id === file)
      .map(item => ({ kind: 'file', id: item.id }))
    if (!file) {
      resources.push({ kind: 'store', id: library.store })
      delete state.projects[project]
    } else library.files = library.files.filter(item => item.id !== file)
    this.save(owner, state)
    this.journal.retire(owner, resources)
  }
  approval(
    owner: string,
    thread: string,
    revision: string | undefined,
    value: ToolApproval
  ): string {
    const state = this.get(owner),
      token = randomUUID().slice(0, 12)
    state.approval = {
      token,
      thread,
      revision,
      value,
      expiresAt: this.now() + 600000
    }
    this.save(owner, state)
    return token
  }
  takeApproval(
    owner: string,
    thread: string,
    revision: string | undefined,
    token: string
  ): ToolApproval {
    const state = this.get(owner),
      approval = state.approval
    if (
      !approval ||
      approval.thread !== thread ||
      approval.revision !== revision ||
      approval.token !== token
    )
      throw new UserError(
        'External approval expired or changed. Submit a new request.'
      )
    state.approval = null
    this.save(owner, state)
    return approval.value
  }
  stageRecording(
    owner: string,
    thread: string,
    revision: string | undefined,
    file: Recording,
    diarize: boolean
  ): string {
    if (diarize && !this.config.workbench.diarizationModel)
      throw new UserError(
        'Speaker labeling is not configured. Use /meeting without speakers or configure a supported model.'
      )
    if (
      (file.bytes !== null &&
        file.bytes > this.config.workbench.meetingBytes) ||
      (file.seconds !== null &&
        file.seconds > this.config.workbench.meetingSeconds)
    )
      throw new UserError(
        'Recording exceeds the meeting duration or byte limit.'
      )
    const state = this.get(owner),
      token = randomUUID().slice(0, 12)
    state.recording = {
      token,
      thread,
      revision,
      file,
      diarize,
      project: this.workspaces.thread(owner, thread).project,
      expiresAt: this.now() + 600000
    }
    this.save(owner, state)
    return token
  }
  takeRecording(
    owner: string,
    thread: string,
    revision: string | undefined,
    token: string
  ): NonNullable<WorkbenchState['recording']> {
    const state = this.get(owner),
      recording = state.recording
    if (
      !recording ||
      recording.thread !== thread ||
      recording.revision !== revision ||
      recording.token !== token ||
      recording.project !== this.workspaces.thread(owner, thread).project
    )
      throw new UserError(
        'Recording preview expired or changed. Reply to the recording again.'
      )
    state.recording = null
    this.save(owner, state)
    return recording
  }
  deleteThread(owner: string, thread: string): void {
    const state = this.get(owner)
    if (state.recording?.thread === thread) state.recording = null
    if (state.approval?.thread === thread) {
      state.approval = null
    }
    this.save(owner, state)
  }
  erase(owner: string): void {
    this.journal.retire(owner)
    this.cache.delete(owner)
    this.store?.deleteRecord('provider-workbench', owner)
  }
  refresh(owner: string): void {
    this.cache.delete(owner)
  }
  async tick(): Promise<void> {
    const states = new Map(
      this.store?.records<WorkbenchState>('provider-workbench') ?? []
    )
    for (const [owner, state] of this.cache) states.set(owner, state)
    const references = new Set<string>()
    for (const [owner] of states) {
      if (this.busy.has(owner)) continue
      const state = this.get(owner)
      for (const [project, library] of Object.entries(state.projects)) {
        if (
          !this.workspaces.get(owner).projects.some(item => item.id === project)
        ) {
          this.clear(owner, project)
          continue
        }
        references.add(`store:${library.store}`)
        for (const file of library.files) references.add(`file:${file.id}`)
      }
    }
    await this.journal.tick(references, this.busyHashes)
  }
}
