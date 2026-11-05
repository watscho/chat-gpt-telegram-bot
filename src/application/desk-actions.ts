import { UserError, type Document } from '../domain/conversation.js'
import type { DeskScope, DeskPreview } from '../domain/desk.js'
import { Desk, deskID, deskText, deskHash } from './desk.js'
import { Workflow } from './workflow.js'
import { Studio } from './studio.js'
import type { WorkSearch } from './work-search.js'
import { parseTable, tableCSV } from '../domain/table.js'
export class DeskActions {
  constructor(
    private readonly data: Desk,
    private readonly workflow: Workflow,
    private readonly studio: Studio,
    private readonly search: Pick<WorkSearch, 'search'>
  ) {}
  confirm(
    owner: string,
    scope: DeskScope,
    token: string,
    revision: number
  ): string {
    const p = this.data.review(owner, scope, token, revision)
    if (p.kind === 'edit') this.data.acceptEdit(owner, scope, p)
    else if (p.kind === 'table') this.data.acceptTable(owner, scope, p)
    else if (p.kind === 'photo') this.data.acceptPhoto(owner, scope, p)
    else
      throw new UserError(
        'Confirm voice proposals in their active live session.'
      )
    return 'Accepted ' + p.kind
  }
  importTable(owner: string, scope: DeskScope, title: string, file: Document) {
    if (!/\.(csv|json)$/i.test(file.name))
      throw new UserError(
        'Use a UTF-8 CSV/JSON table or run reviewed Excel analysis first.'
      )
    let raw: string
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.from(file.data, 'base64')
      )
    } catch {
      throw new UserError('Table input must be valid UTF-8.')
    }
    const value = parseTable(raw)
    return this.data.tablePreview(
      owner,
      scope,
      'import:' + deskID(),
      title,
      value.columns,
      value.rows,
      'Explicit file ' + file.name
    )
  }
  file(
    owner: string,
    scope: DeskScope,
    kind: string,
    id: string,
    version: string
  ): Document {
    if (kind === 'canvas') {
      const item = this.data.document(owner, id, scope),
        saved = item.versions.find(item => item.id === version)
      if (!saved) throw new UserError('Choose a retained document version.')
      return {
        name: `${item.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)}.${item.language === 'text' ? 'txt' : item.language}`,
        mime: 'text/plain',
        data: Buffer.from(saved.text).toString('base64')
      }
    }
    if (kind === 'table') {
      const item = this.data.table(owner, id, scope),
        saved = item.versions.find(item => item.id === version)
      if (!saved) throw new UserError('Choose a retained table version.')
      return {
        name: 'table.csv',
        mime: 'text/csv',
        data: Buffer.from(
          tableCSV({ columns: item.columns, rows: saved.rows })
        ).toString('base64')
      }
    }
    if (kind === 'photo') {
      const item = this.data.photo(owner, id, scope),
        saved = item.images.find(item => item.id === version)
      if (!saved) throw new UserError('Choose a retained photo version.')
      return {
        name: 'photo.' + saved.image.mime.slice(6).replace('jpeg', 'jpg'),
        mime: saved.image.mime,
        data: saved.image.data
      }
    }
    throw new UserError('Choose canvas, table or photo export.')
  }
  voice(
    owner: string,
    scope: DeskScope,
    call: string,
    callID: string,
    args: string
  ): DeskPreview {
    if (!/^[a-zA-Z0-9_-]{1,180}$/.test(callID) || args.length > 6000)
      throw new UserError('Invalid voice action request.')
    let value: unknown
    try {
      value = JSON.parse(args)
    } catch {
      throw new UserError('Voice action arguments must be JSON.')
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some(key => !['kind', 'text'].includes(key)) ||
      !('kind' in value) ||
      !['task', 'find', 'draft'].includes(String(value.kind)) ||
      !('text' in value) ||
      typeof value.text !== 'string'
    )
      throw new UserError('Choose task, find or draft with explicit text.')
    deskText(value.text, 2000)
    return this.data.preview(
      owner,
      scope,
      'voice',
      `voice:${call}:${callID}`,
      deskHash({ scope, call }),
      { kind: value.kind, text: value.text, call, callID }
    )
  }
  voiceConfirm(
    owner: string,
    scope: DeskScope,
    call: string,
    token: string,
    revision: number
  ): { output: string; mission: string | null } {
    const p = this.data.review(owner, scope, token, revision)
    if (p.kind !== 'voice') throw new UserError('Choose a live voice proposal.')
    const value = JSON.parse(p.value) as {
      kind: string
      text: string
      call: string
    }
    if (value.call !== call || p.base !== deskHash({ scope, call }))
      throw new UserError('Voice session changed.')
    let output: string,
      mission: string | null = null
    if (value.kind === 'task') {
      this.workflow.addReviewedTasks(owner, scope.thread, p.origin, [
        { title: deskText(value.text, 1000), dueAt: null }
      ])
      output = 'Created the explicitly reviewed local task.'
    } else if (value.kind === 'find') {
      const results = this.search.search(owner, value.text).slice(0, 5)
      output = JSON.stringify(
        results.map(item => ({
          title: item.title,
          text: item.text.slice(0, 2000),
          id: item.id
        }))
      )
      if (!results.length) output = 'No matching retained materials.'
    } else {
      let draft = this.studio
        .get(owner)
        .missions.find(item =>
          item.input.sources?.some(source => source.id === p.origin)
        )
      if (!draft)
        draft = this.studio.plan(
          owner,
          scope.thread,
          'workflow',
          {
            prompt: 'Prepare a draft only: ' + value.text,
            project: scope.project,
            images: [],
            documents: [],
            memories: [],
            instructions:
              'Return an editable draft. Do not send or perform external actions.',
            sources: [
              {
                id: p.origin,
                title: 'Explicitly reviewed voice request',
                text: value.text,
                thread: scope.thread,
                project: scope.project
              }
            ]
          },
          [],
          [
            {
              kind: 'compose',
              title: 'Prepare reviewed voice draft',
              prompt:
                'Draft the requested text; clearly state missing context. No sending.',
              connection: null
            }
          ]
        )
      mission = draft.id
      output = `Prepared inert draft mission ${mission}; review and approve its estimate in Telegram or Workspace before generation.`
    }
    this.data.accept(owner, scope, token, revision, p.base, () => {})
    return { output, mission }
  }
}
