import { UserError } from '../domain/conversation.js'
import { Desk } from './desk.js'
import { DeskPlans } from './desk-plans.js'
import { DeskActions } from './desk-actions.js'
import { ConnectionCenter } from './connection-center.js'
import { Profiles } from './profiles.js'
import { Workspaces } from './workspaces.js'
import type { Rectangle } from '../domain/desk.js'
function fields(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length > 200000)
    throw new UserError('Use bounded Desk form fields.')
  let item: unknown
  try {
    item = JSON.parse(value)
  } catch {
    throw new UserError('Desk form contains invalid JSON.')
  }
  if (!item || typeof item !== 'object' || Array.isArray(item))
    throw new UserError('Desk fields must be an object.')
  return item as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string')
    throw new UserError('A required Desk text field is missing.')
  return value
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new UserError('A Desk numeric field must be an integer.')
  return value
}
export class DeskWorkspace {
  constructor(
    private readonly data: Desk,
    private readonly plans: DeskPlans,
    private readonly actions: DeskActions,
    private readonly center: ConnectionCenter,
    private readonly profiles: Profiles,
    private readonly ws: Workspaces
  ) {}
  private scope(owner: string) {
    const thread = this.profiles.get(owner).active
    return { thread, project: this.ws.thread(owner, thread).project }
  }
  snapshot(owner: string) {
    const state = this.data.get(owner),
      scope = this.scope(owner),
      owned = (item: { thread: string; project: string | null }) =>
        item.thread === scope.thread && item.project === scope.project
    return {
      documents: state.documents.filter(owned),
      assistants: state.assistants,
      active: state.active[scope.thread] ?? null,
      tables: state.tables.filter(owned),
      photos: state.photos.filter(owned),
      browsers: state.browsers,
      pending: state.pending && owned(state.pending) ? state.pending : null,
      connections: this.center.list(owner),
      mission: null as string | null,
      authorizationURL: null as string | null
    }
  }
  action(owner: string, body: Record<string, unknown>) {
    if (
      typeof body.action !== 'string' ||
      !body.action.startsWith('desk:') ||
      typeof body.id !== 'string' ||
      body.id.length > 120 ||
      Object.keys(body).some(
        key => !['action', 'id', 'value', 'revision', 'confirm'].includes(key)
      )
    )
      throw new UserError('Invalid Desk action.')
    const action = body.action.slice(5),
      id = body.id,
      scope = this.scope(owner)
    let mission: string | null = null,
      authorizationURL: string | null = null
    if (action === 'ask') {
      const v = fields(body.value)
      mission = this.plans.ask(
        owner,
        scope.thread,
        text(v.prompt),
        text(v.tool)
      ).id
    } else if (action === 'create') {
      const v = fields(body.value)
      this.data.create(
        owner,
        scope,
        text(v.title),
        text(v.language),
        text(v.text)
      )
    } else if (action === 'save')
      this.data.write(owner, scope, id, number(body.revision), text(body.value))
    else if (action === 'restore')
      this.data.restore(
        owner,
        scope,
        id,
        number(body.revision),
        text(body.value)
      )
    else if (action === 'edit') {
      const v = fields(body.value)
      mission = this.plans.edit(
        owner,
        scope.thread,
        id,
        number(body.revision),
        number(v.start),
        number(v.end),
        text(v.goal)
      ).id
    } else if (action === 'confirm' || action === 'cancel') {
      if (action === 'confirm') {
        if (body.confirm !== true)
          throw new UserError('Confirm the displayed exact Desk proposal.')
        this.actions.confirm(owner, scope, id, number(body.revision))
      } else this.data.cancel(owner, scope, id, number(body.revision))
    } else if (action === 'assistant-create') {
      const v = fields(body.value)
      this.data.assistant(
        owner,
        text(v.title),
        text(v.instructions),
        v.model === null ? null : text(v.model),
        text(v.tools)
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)
      )
    } else if (action === 'assistant-use')
      this.data.use(owner, scope.thread, id)
    else if (action === 'assistant-run') {
      const v = fields(body.value)
      mission = this.plans.assistant(
        owner,
        scope.thread,
        id,
        text(v.prompt),
        text(v.tool)
      ).id
    } else if (action === 'cell') {
      const v = fields(body.value)
      this.data.cell(
        owner,
        scope,
        id,
        number(body.revision),
        number(v.row),
        number(v.column),
        v.value === null ? null : text(v.value)
      )
    } else if (action === 'table-restore')
      this.data.tableRestore(
        owner,
        scope,
        id,
        number(body.revision),
        text(body.value)
      )
    else if (action === 'table-import') {
      const v = fields(body.value)
      this.actions.importTable(owner, scope, text(v.title), {
        name: 'table.json',
        mime: 'application/json',
        data: Buffer.from(text(v.json)).toString('base64')
      })
    } else if (action === 'photo-edit') {
      const v = fields(body.value),
        region: Rectangle = {
          x: number(v.x),
          y: number(v.y),
          width: number(v.width),
          height: number(v.height)
        }
      mission = this.plans.photo(
        owner,
        scope.thread,
        id,
        text(v.image),
        region,
        text(v.goal)
      ).id
    } else if (action === 'browser-create') {
      const v = fields(body.value)
      this.data.browser(
        owner,
        text(v.title),
        text(v.connection),
        text(v.origins)
          .split(',')
          .map(item => item.trim()),
        text(v.tools)
          .split(',')
          .map(item => item.trim())
      )
    } else if (action === 'browser-run') {
      const v = fields(body.value)
      mission = this.plans.browser(
        owner,
        scope.thread,
        id,
        text(v.url),
        text(v.goal)
      ).id
    } else if (action === 'connection-enable') this.center.enable(owner, id)
    else if (action === 'connection-disconnect') {
      if (body.confirm !== true)
        throw new UserError('Confirm disconnection explicitly.')
      this.center.disconnect(owner, id)
    } else if (action === 'connection-authorize')
      authorizationURL = this.center.begin(owner, id)
    else if (action === 'remove') {
      if (body.confirm !== true)
        throw new UserError('Confirm removal explicitly.')
      this.data.remove(owner, scope, text(body.value), id)
    } else throw new UserError('Unknown Desk action.')
    const view = this.snapshot(owner)
    view.mission = mission
    view.authorizationURL = authorizationURL
    return view
  }
  file(owner: string, kind: string, id: string, version: string) {
    return this.actions.file(owner, this.scope(owner), kind, id, version)
  }
}
export type DeskView = ReturnType<DeskWorkspace['snapshot']>
