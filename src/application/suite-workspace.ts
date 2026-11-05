import { UserError } from '../domain/conversation.js'
import type { Suite } from './suite.js'
import type { Watches } from './watches.js'
import type { SharedProjects } from './shared-projects.js'
import type { WorkSearch } from './work-search.js'
export class SuiteWorkspace {
  constructor(
    private readonly suite: Suite,
    private readonly watches: Watches,
    private readonly teams: SharedProjects,
    private readonly search: WorkSearch,
    private readonly persistent: boolean
  ) {}
  snapshot(owner: string) {
    const state = this.suite.get(owner)
    return {
      records: state.records.map(record => ({
        id: record.id,
        title: record.title,
        kind: record.kind,
        revision: record.revision,
        thread: record.thread,
        project: record.project,
        rows: record.rows,
        sources: record.sources.map(source => ({
          id: source.id,
          title: source.title
        }))
      })),
      templates: state.templates,
      criteria: state.criteria,
      recipes: state.recipes.map(recipe => ({
        name: recipe.name,
        revision: recipe.revision,
        goal: recipe.goal,
        steps: recipe.steps.map(step => ({
          title: step.title,
          kind: step.kind
        }))
      })),
      watches: this.watches.get(owner).map(watch => ({
        id: watch.id,
        enabled: watch.enabled,
        target: watch.target,
        error: watch.error,
        lastAt: watch.lastAt,
        nextAt: watch.nextAt,
        changes: watch.changes
      })),
      teams: this.persistent ? this.teams.list(owner) : [],
      selected: state.selected.map(source => ({
        id: source.id,
        title: source.title
      })),
      hits: [] as { id: string; title: string; excerpt: string; kind: string }[]
    }
  }
  file(owner: string, team: string, id: string, name: string) {
    const file = this.teams.file(owner, team, id)
    if (file.name !== name)
      throw new UserError('Shared file changed. Open a fresh review.')
    return file
  }
  action(owner: string, body: Record<string, unknown>) {
    if (
      Object.keys(body).some(
        key => !['action', 'id', 'value', 'confirm'].includes(key)
      ) ||
      typeof body.id !== 'string' ||
      body.id.length > 120 ||
      typeof body.action !== 'string'
    )
      throw new UserError('Invalid Suite workspace action.')
    const action = body.action,
      id = body.id
    if (action === 'suite:search') {
      if (typeof body.value !== 'string')
        throw new UserError('Provide search text.')
      const result = this.snapshot(owner)
      result.hits = this.search.search(owner, body.value).map(hit => ({
        id: hit.id,
        title: hit.title,
        excerpt: hit.excerpt,
        kind: hit.kind
      }))
      return result
    }
    if (action === 'suite:select')
      this.suite.select(owner, this.search.open(owner, id))
    else if (action === 'suite:clear') this.suite.clearSelected(owner)
    else if (action === 'suite:watch') {
      if (typeof body.value !== 'boolean')
        throw new UserError('Choose an enabled or disabled watch state.')
      this.watches.enable(owner, id, body.value)
    } else if (action === 'suite:delete') {
      if (body.confirm !== true)
        throw new UserError('Confirm record deletion explicitly.')
      this.suite.removeRecord(owner, id)
    } else
      throw new UserError(
        'Use Telegram for workflow plans, record acceptance, invitations and sharing reviews.'
      )
    return this.snapshot(owner)
  }
}
export type SuiteView = ReturnType<SuiteWorkspace['snapshot']>
