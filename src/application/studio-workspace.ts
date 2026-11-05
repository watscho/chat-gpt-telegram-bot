import type { RoutineHome } from './routine-home.js'
import type { SuiteWorkspace } from './suite-workspace.js'
import { sourceList } from './sources.js'
import { UserError, type Document } from '../domain/conversation.js'
import type { Mission } from '../domain/studio.js'
import { Studio } from './studio.js'
import { Profiles } from './profiles.js'
import { Workspaces } from './workspaces.js'
import { Workflow } from './workflow.js'
import { UsageLedger } from './usage.js'
import { Jobs } from './jobs.js'
export class StudioWorkspace {
  constructor(
    private readonly studio: Studio,
    private readonly profiles: Profiles,
    private readonly ws: Workspaces,
    private readonly workflow: Workflow,
    private readonly usage: UsageLedger,
    private readonly jobs: Jobs,
    private readonly suite?: SuiteWorkspace,
    private readonly home?: RoutineHome
  ) {}
  snapshot(owner: string, missionId?: string) {
    const thread = this.profiles.get(owner).active,
      state = this.studio.get(owner),
      workspace = this.ws.get(owner)
    return {
      suite: this.suite?.snapshot(owner),
      home: this.home?.snapshot(owner),
      thread,
      threads: this.profiles.get(owner).threads,
      project: this.ws.thread(owner, thread).project,
      projects: workspace.projects.map(project => ({
        id: project.id,
        title: project.title,
        files: project.documents.map(file => ({
          name: file.name,
          mime: file.mime,
          bytes: Buffer.byteLength(file.data, 'base64')
        }))
      })),
      tasks: this.workflow.get(owner).tasks.map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        thread: task.thread,
        dueAt: task.dueAt
      })),
      inbox: state.inbox.map(item => ({
        id: item.id,
        kind: item.kind,
        text: item.text.slice(0, 1000),
        project: item.project,
        thread: item.thread,
        files: item.documents.map(file => file.name),
        recording: item.recording?.name ?? null
      })),
      missions: state.missions.map(mission => ({
        id: mission.id,
        title: mission.title,
        state: mission.state,
        revision: mission.revision,
        thread: mission.thread,
        project: mission.project,
        estimate: this.studio.estimate(mission)
      })),
      usage: this.usage.get(owner),
      jobs: this.jobs.get(owner).jobs.map(job => ({
        id: job.id,
        thread: job.thread,
        state: job.state
      })),
      detail: missionId
        ? this.detail(this.studio.mission(owner, missionId))
        : null
    }
  }
  private detail(mission: Mission) {
    const selected = mission.versions.find(
      version => version.id === mission.selected
    )
    return {
      id: mission.id,
      title: mission.title,
      revision: mission.revision,
      state: mission.state,
      thread: mission.thread,
      project: mission.project,
      estimate: this.studio.estimate(mission),
      goal: mission.input.prompt,
      instructions: mission.input.instructions,
      documents: mission.input.documents.map(file => file.name),
      images: mission.input.images.length,
      steps: mission.steps.map(step => ({
        title: step.title,
        prompt: step.prompt,
        state: step.state,
        estimate: step.estimate,
        attempt: step.attempt,
        receipt: step.receipt,
        events: step.events,
        actions:
          step.approval?.value.calls.map(call => ({
            name: call.name,
            arguments: call.arguments
          })) ?? []
      })),
      versions: mission.versions.map(version => ({
        id: version.id,
        label: version.label,
        createdAt: version.createdAt,
        parent: version.parent
      })),
      selected: mission.selected,
      result: selected
        ? {
            text: selected.reply.text,
            sources: sourceList(selected.reply.sources),
            files: (selected.reply.files ?? []).map(file => ({
              name: file.name,
              mime: file.mime
            }))
          }
        : null
    }
  }
  action(owner: string, body: Record<string, unknown>): WorkspaceView {
    const allowed = ['action', 'id', 'revision', 'value', 'confirm']
    if (
      Object.keys(body).some(key => !allowed.includes(key)) ||
      typeof body.action !== 'string' ||
      typeof body.id !== 'string' ||
      body.id.length > 120
    )
      throw new UserError('Invalid workspace action.')
    const action = body.action,
      id = body.id
    if (action.startsWith('home:')) {
      if (!this.home) throw new UserError('Daily home is unavailable.')
      const result = this.snapshot(owner)
      result.home = this.home.action(owner, body)
      return result
    }
    if (action.startsWith('suite:')) {
      if (!this.suite) throw new UserError('Pro Suite is unavailable.')
      const result = this.snapshot(owner)
      result.suite = this.suite.action(owner, body)
      return result
    }
    if (action === 'inspect') return this.snapshot(owner, id)
    if (action === 'project') {
      this.ws.configure(owner, this.profiles.get(owner).active, {
        project: id === 'none' ? null : id
      })
      return this.snapshot(owner)
    }
    if (action === 'thread') {
      this.profiles.switch(owner, id)
      return this.snapshot(owner)
    }
    if (action === 'task') {
      if (body.value !== 'done' && body.value !== 'open')
        throw new UserError('Choose an open or done task state.')
      this.workflow.task(owner, id, body.value)
      return this.snapshot(owner)
    }
    if (action === 'inbox-assign') {
      if (
        typeof body.value !== 'string' ||
        (body.value !== 'none' &&
          !this.ws
            .get(owner)
            .projects.some(project => project.id === body.value))
      )
        throw new UserError('Choose an existing project or none.')
      this.studio.assign(owner, id, body.value === 'none' ? null : body.value)
      return this.snapshot(owner)
    }
    if (action === 'inbox-delete' || action === 'mission-delete') {
      if (body.confirm !== true)
        throw new UserError('Confirm deletion explicitly.')
      if (action === 'inbox-delete') this.studio.removeItem(owner, id)
      else this.studio.remove(owner, id)
      return this.snapshot(owner)
    }
    if (!Number.isSafeInteger(body.revision))
      throw new UserError('Open a fresh mission review first.')
    const revision = Number(body.revision)
    if (action === 'start') this.studio.start(owner, id, revision)
    else if (action === 'pause' || action === 'resume' || action === 'cancel')
      this.studio.control(owner, id, revision, action)
    else if (action === 'restore') {
      if (typeof body.value !== 'string')
        throw new UserError('Choose a retained version.')
      this.studio.restore(owner, id, revision, body.value)
    } else if (action === 'edit') {
      if (typeof body.value !== 'string')
        throw new UserError('Provide edited text.')
      this.studio.editResult(owner, id, revision, body.value)
    } else
      throw new UserError(
        'Unknown workspace action. External approvals and paid retries require the Telegram review flow.'
      )
    return this.snapshot(owner, id)
  }
  file(
    owner: string,
    missionId: string,
    version: string,
    name: string
  ): Document {
    if (missionId.startsWith('team:')) {
      if (!this.suite) throw new UserError('Pro Suite is unavailable.')
      return this.suite.file(owner, missionId.slice(5), version, name)
    }
    const file = missionId.startsWith('project:')
      ? this.ws
          .get(owner)
          .projects.find(project => project.id === missionId.slice(8))
          ?.documents.find(file => file.name === name)
      : this.studio
          .result(owner, missionId, version)
          .reply.files?.find(file => file.name === name)
    if (!file)
      throw new UserError('Result file not found for this owner and version.')
    return file
  }
}
export type WorkspaceView = ReturnType<StudioWorkspace['snapshot']>
