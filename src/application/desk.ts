import { articleURL } from '../infrastructure/article-reader.js'
import { randomUUID, createHash } from 'node:crypto'
import type { Config } from '../config.js'
import type { StateStore } from '../domain/state.js'
import type {
  DeskState,
  DeskScope,
  DeskPreview,
  CanvasDocument,
  DataTable,
  PhotoProject,
  Rectangle
} from '../domain/desk.js'
import type { SourceQuote } from '../domain/suite.js'
import type { Image } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
export const deskID = () => randomUUID().slice(0, 12)
export const deskHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function deskText(value: string, max = 1000): string {
  if (!value.trim() || value.length > max)
    throw new UserError(`Provide text between 1 and ${max} characters.`)
  return value.trim()
}
export function deskScope(item: DeskScope, scope: DeskScope): void {
  if (item.thread !== scope.thread || item.project !== scope.project)
    throw new UserError(
      'Select the original conversation/project for this material.'
    )
}
export function tableData(columns: string[], rows: (string | null)[][]): void {
  if (
    !columns.length ||
    columns.length > 20 ||
    new Set(columns).size !== columns.length ||
    columns.some(value => !value.trim() || value.length > 80) ||
    rows.length > 500 ||
    rows.some(
      row =>
        row.length !== columns.length ||
        row.some(
          value =>
            value !== null && (typeof value !== 'string' || value.length > 2000)
        )
    )
  )
    throw new UserError(
      'Use unique named columns (1..20), at most 500 rectangular rows and text/null cells up to 2000 characters.'
    )
}
export class Desk {
  private readonly local = new Map<string, DeskState>()
  constructor(
    readonly config: Config,
    private readonly store?: StateStore,
    readonly now = Date.now
  ) {}
  get(owner: string): DeskState {
    const state = structuredClone(
      this.store?.getRecord<DeskState>('desk', owner) ??
        this.local.get(owner) ?? {
          documents: [],
          assistants: [],
          active: {},
          tables: [],
          photos: [],
          browsers: [],
          pending: null,
          accepted: []
        }
    )
    if (state.pending && state.pending.expiresAt <= this.now()) {
      state.pending = null
      this.save(owner, state)
    }
    return state
  }
  private save(owner: string, state: DeskState): void {
    if (
      state.documents.length > 30 ||
      state.assistants.length > 20 ||
      state.tables.length > 20 ||
      state.photos.length > 10 ||
      state.browsers.length > 10 ||
      Buffer.byteLength(JSON.stringify(state)) > this.config.maxProjectBytes
    )
      throw new UserError(
        'Desk capacity is full. Export and remove unused material first.'
      )
    this.store?.putRecord('desk', owner, state)
    if (!this.store) this.local.set(owner, structuredClone(state))
  }
  update(owner: string, change: (state: DeskState) => void): DeskState {
    const state = this.get(owner)
    change(state)
    state.accepted = state.accepted.slice(-1000)
    this.save(owner, state)
    return structuredClone(state)
  }
  document(owner: string, id: string, scope: DeskScope): CanvasDocument {
    const item = this.get(owner).documents.find(item => item.id === id)
    if (!item) throw new UserError('Canvas document not found.')
    deskScope(item, scope)
    return item
  }
  create(
    owner: string,
    scope: DeskScope,
    title: string,
    language: string,
    text: string
  ): CanvasDocument {
    deskText(text, 60000)
    if (!/^[a-z0-9_+-]{1,30}$/i.test(language))
      throw new UserError('Choose a short language identifier.')
    const item = {
      ...scope,
      id: deskID(),
      title: deskText(title, 100),
      language,
      text,
      revision: 1,
      versions: [{ id: deskID(), text, at: this.now(), label: 'Created' }]
    }
    this.update(owner, state => {
      state.documents.push(item)
    })
    return item
  }
  write(
    owner: string,
    scope: DeskScope,
    id: string,
    revision: number,
    text: string,
    label = 'Manual edit'
  ): CanvasDocument {
    const current = this.document(owner, id, scope)
    if (current.revision !== revision)
      throw new UserError(
        'Document changed. Open its latest revision before saving.'
      )
    deskText(text, 60000)
    let result!: CanvasDocument
    this.update(owner, state => {
      const item = state.documents.find(item => item.id === id)!
      item.text = text
      item.revision++
      item.versions = [
        ...item.versions,
        { id: deskID(), text, at: this.now(), label }
      ].slice(-20)
      result = item
    })
    return result
  }
  restore(
    owner: string,
    scope: DeskScope,
    id: string,
    revision: number,
    version: string
  ): CanvasDocument {
    const item = this.document(owner, id, scope),
      saved = item.versions.find(item => item.id === version)
    if (!saved) throw new UserError('Document version is no longer retained.')
    return this.write(
      owner,
      scope,
      id,
      revision,
      saved.text,
      'Restored ' + version
    )
  }
  preview(
    owner: string,
    scope: DeskScope,
    kind: DeskPreview['kind'],
    origin: string,
    base: string,
    value: unknown
  ): DeskPreview {
    const item = {
      ...scope,
      kind,
      origin,
      base,
      value: JSON.stringify(value),
      token: deskID(),
      revision: 1,
      expiresAt: this.now() + 600000
    }
    this.update(owner, state => {
      if (state.accepted.includes(origin))
        throw new UserError('This result was already accepted.')
      state.pending = item
    })
    return item
  }
  review(
    owner: string,
    scope: DeskScope,
    token: string,
    revision: number
  ): DeskPreview {
    const item = this.get(owner).pending
    if (!item || item.token !== token || item.revision !== revision)
      throw new UserError('Desk review expired or changed.')
    deskScope(item, scope)
    return item
  }
  accept(
    owner: string,
    scope: DeskScope,
    token: string,
    revision: number,
    base: string,
    apply: (state: DeskState, pending: DeskPreview) => void
  ): void {
    const p = this.review(owner, scope, token, revision)
    if (p.base !== base)
      throw new UserError('Source material changed. Prepare a fresh review.')
    this.update(owner, state => {
      if (state.accepted.includes(p.origin))
        throw new UserError('This result was already accepted.')
      apply(state, p)
      state.accepted.push(p.origin)
      state.pending = null
    })
  }
  cancel(
    owner: string,
    scope: DeskScope,
    token: string,
    revision: number
  ): void {
    this.review(owner, scope, token, revision)
    this.update(owner, state => {
      state.pending = null
    })
  }
  selection(
    owner: string,
    scope: DeskScope,
    id: string,
    revision: number,
    start: number,
    end: number
  ): CanvasDocument {
    const item = this.document(owner, id, scope)
    if (
      item.revision !== revision ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end > item.text.length
    )
      throw new UserError(
        'Select a nonempty range in the current document revision.'
      )
    return item
  }
  editPreview(
    owner: string,
    scope: DeskScope,
    origin: string,
    id: string,
    revision: number,
    start: number,
    end: number,
    replacement: string
  ) {
    const item = this.selection(owner, scope, id, revision, start, end)
    if (!replacement.trim() || replacement.length > 60000)
      throw new UserError(
        'Use a nonempty bounded replacement; review deletions manually.'
      )
    return this.preview(owner, scope, 'edit', origin, deskHash(item), {
      id,
      start,
      end,
      before: item.text.slice(start, end),
      replacement
    })
  }
  acceptEdit(owner: string, scope: DeskScope, p: DeskPreview): void {
    const value = JSON.parse(p.value) as {
      id: string
      start: number
      end: number
      replacement: string
    }
    const item = this.document(owner, value.id, scope),
      text =
        item.text.slice(0, value.start) +
        value.replacement +
        item.text.slice(value.end)
    deskText(text, 60000)
    this.accept(owner, scope, p.token, p.revision, deskHash(item), state => {
      const target = state.documents.find(item => item.id === value.id)!
      target.text = text
      target.revision++
      target.versions = [
        ...target.versions,
        { id: deskID(), text, at: this.now(), label: 'Accepted selected edit' }
      ].slice(-20)
    })
  }
  assistant(
    owner: string,
    title: string,
    instructions: string,
    model: string | null,
    tools: string[]
  ): string {
    if (model !== null && !/^[a-zA-Z0-9_.:-]{1,100}$/.test(model))
      throw new UserError('Choose a valid model identifier.')
    const allowed = [
      'search',
      'analysis',
      ...this.config.workbench.connections
        .filter(item => item.owner === Number(owner.split(':')[0]))
        .map(item => 'connection:' + item.id)
    ]
    if (
      new Set(tools).size !== tools.length ||
      tools.some(tool => !allowed.includes(tool))
    )
      throw new UserError('Choose available assistant tools explicitly.')
    const item = {
      id: deskID(),
      title: deskText(title, 80),
      instructions: deskText(instructions, 4000),
      model,
      tools,
      sources: [],
      revision: 1
    }
    this.update(owner, state => {
      state.assistants.push(item)
    })
    return item.id
  }
  assistantItem(owner: string, id: string) {
    const item = this.get(owner).assistants.find(item => item.id === id)
    if (!item) throw new UserError('Assistant not found.')
    return item
  }
  assistantSources(owner: string, id: string, sources: SourceQuote[]): void {
    this.assistantItem(owner, id)
    if (
      sources.length > 20 ||
      sources.some(item => !item.text.trim() || item.text.length > 12000)
    )
      throw new UserError('Choose at most 20 bounded explicit source excerpts.')
    this.update(owner, state => {
      const item = state.assistants.find(item => item.id === id)!
      item.sources = structuredClone(sources)
      item.revision++
    })
  }
  use(owner: string, thread: string, id: string): void {
    if (id !== 'none') this.assistantItem(owner, id)
    this.update(owner, state => {
      if (id === 'none') delete state.active[thread]
      else state.active[thread] = id
    })
  }
  table(owner: string, id: string, scope: DeskScope): DataTable {
    const item = this.get(owner).tables.find(item => item.id === id)
    if (!item) throw new UserError('Table not found.')
    deskScope(item, scope)
    return item
  }
  tablePreview(
    owner: string,
    scope: DeskScope,
    origin: string,
    title: string,
    columns: string[],
    rows: (string | null)[][],
    source: string
  ) {
    tableData(columns, rows)
    return this.preview(owner, scope, 'table', origin, 'new-table', {
      title: deskText(title, 100),
      columns,
      rows,
      source
    })
  }
  acceptTable(owner: string, scope: DeskScope, p: DeskPreview): void {
    const value = JSON.parse(p.value) as Pick<
      DataTable,
      'title' | 'columns' | 'rows' | 'source'
    >
    tableData(value.columns, value.rows)
    this.accept(owner, scope, p.token, p.revision, 'new-table', state => {
      state.tables.push({
        ...scope,
        ...value,
        id: deskID(),
        revision: 1,
        versions: [
          { id: deskID(), rows: structuredClone(value.rows), at: this.now() }
        ]
      })
    })
  }
  cell(
    owner: string,
    scope: DeskScope,
    id: string,
    revision: number,
    row: number,
    column: number,
    value: string | null
  ): void {
    const item = this.table(owner, id, scope)
    if (
      item.revision !== revision ||
      !Number.isSafeInteger(row) ||
      !Number.isSafeInteger(column) ||
      row < 0 ||
      row >= item.rows.length ||
      column < 0 ||
      column >= item.columns.length ||
      (value !== null && value.length > 2000)
    )
      throw new UserError(
        'Choose a current owned table cell and bounded text/null.'
      )
    this.update(owner, state => {
      const table = state.tables.find(item => item.id === id)!
      table.rows[row]![column] = value
      table.revision++
      table.versions = [
        ...table.versions,
        { id: deskID(), rows: structuredClone(table.rows), at: this.now() }
      ].slice(-10)
    })
  }
  tableRestore(
    owner: string,
    scope: DeskScope,
    id: string,
    revision: number,
    version: string
  ): void {
    const item = this.table(owner, id, scope),
      saved = item.versions.find(item => item.id === version)
    if (!saved || item.revision !== revision)
      throw new UserError(
        'Choose a retained table version and current revision.'
      )
    this.update(owner, state => {
      const item = state.tables.find(item => item.id === id)!
      item.rows = structuredClone(saved.rows)
      item.revision++
      item.versions = [
        ...item.versions,
        { id: deskID(), rows: structuredClone(saved.rows), at: this.now() }
      ].slice(-10)
    })
  }
  photo(owner: string, id: string, scope: DeskScope): PhotoProject {
    const item = this.get(owner).photos.find(item => item.id === id)
    if (!item) throw new UserError('Photo project not found.')
    deskScope(item, scope)
    return item
  }
  photoAdd(
    owner: string,
    scope: DeskScope,
    title: string,
    images: Image[]
  ): string {
    if (
      !images.length ||
      images.length > 8 ||
      images.some(
        image =>
          !image.data ||
          Buffer.byteLength(image.data, 'base64') > this.config.maxImageBytes
      )
    )
      throw new UserError('Choose 1..8 bounded explicit images.')
    const item = {
      ...scope,
      id: deskID(),
      title: deskText(title, 100),
      revision: 1,
      images: images.map((image, index) => ({
        id: deskID(),
        image,
        label: `Original ${index + 1}`,
        at: this.now()
      }))
    }
    this.update(owner, state => {
      state.photos.push(item)
    })
    return item.id
  }
  photoPreview(
    owner: string,
    scope: DeskScope,
    origin: string,
    id: string,
    images: Image[]
  ) {
    const item = this.photo(owner, id, scope)
    if (
      !images.length ||
      images.length > 4 ||
      images.some(
        image =>
          Buffer.byteLength(image.data, 'base64') > this.config.maxImageBytes
      )
    )
      throw new UserError('Image edit returned no supported bounded output.')
    return this.preview(owner, scope, 'photo', origin, deskHash(item), {
      id,
      images
    })
  }
  acceptPhoto(owner: string, scope: DeskScope, p: DeskPreview): void {
    const value = JSON.parse(p.value) as { id: string; images: Image[] },
      item = this.photo(owner, value.id, scope)
    this.accept(owner, scope, p.token, p.revision, deskHash(item), state => {
      const item = state.photos.find(item => item.id === value.id)!
      if (item.images.length + value.images.length > 20)
        throw new UserError(
          'Photo project has 20 retained versions. Export and create a new project.'
        )
      item.images.push(
        ...value.images.map(image => ({
          id: deskID(),
          image,
          label: 'Accepted edit',
          at: this.now()
        }))
      )
      item.revision++
    })
  }
  browser(
    owner: string,
    title: string,
    connection: string,
    origins: string[],
    tools: string[]
  ): string {
    const configured = this.config.workbench.connections.find(
      item =>
        item.owner === Number(owner.split(':')[0]) && item.id === connection
    )
    if (
      !configured ||
      !tools.length ||
      tools.some(tool => !configured.tools.includes(tool)) ||
      !origins.length ||
      origins.length > 10 ||
      origins.some(origin => {
        try {
          return articleURL(origin).origin !== origin
        } catch {
          return true
        }
      })
    )
      throw new UserError(
        'Choose a configured isolated browser connection, allowed tools and 1..10 exact HTTPS origins.'
      )
    const item = {
      id: deskID(),
      title: deskText(title, 80),
      connection,
      origins: [...new Set(origins)],
      tools: [...new Set(tools)],
      revision: 1
    }
    this.update(owner, state => {
      state.browsers.push(item)
    })
    return item.id
  }
  remove(owner: string, scope: DeskScope, kind: string, id: string): void {
    if (
      !['documents', 'tables', 'photos', 'assistants', 'browsers'].includes(
        kind
      )
    )
      throw new UserError('Choose a known Desk material type.')
    this.update(owner, state => {
      const key = kind as
          'documents' | 'tables' | 'photos' | 'assistants' | 'browsers',
        item = state[key].find(item => item.id === id)
      if (!item) throw new UserError('Desk material not found.')
      if ('thread' in item) deskScope(item, scope)
      ;(state[key] as { id: string }[]) = state[key].filter(
        item => item.id !== id
      )
      for (const [thread, active] of Object.entries(state.active))
        if (active === id) delete state.active[thread]
      state.pending = null
    })
  }
  deleteMaterialScope(
    owner: string,
    kind: 'thread' | 'project',
    id: string
  ): void {
    this.update(owner, state => {
      state.documents = state.documents.filter(item => item[kind] !== id)
      state.tables = state.tables.filter(item => item[kind] !== id)
      state.photos = state.photos.filter(item => item[kind] !== id)
      if (state.pending?.[kind] === id) state.pending = null
      for (const assistant of state.assistants) {
        const sources = assistant.sources.filter(item => item[kind] !== id)
        if (sources.length !== assistant.sources.length) {
          assistant.sources = sources
          assistant.revision++
        }
      }
      if (kind === 'thread') delete state.active[id]
    })
  }
  deleteThread(owner: string, thread: string): void {
    this.update(owner, state => {
      if (state.pending?.thread === thread) state.pending = null
      delete state.active[thread]
    })
  }
  erase(owner: string): void {
    this.store?.deleteRecord('desk', owner)
    this.local.delete(owner)
  }
}
export function photoRegion(
  value: Rectangle,
  width: number,
  height: number
): void {
  if (
    [value.x, value.y, value.width, value.height, width, height].some(
      value => !Number.isSafeInteger(value)
    ) ||
    width < 1 ||
    height < 1 ||
    width * height > 16777216 ||
    value.x < 0 ||
    value.y < 0 ||
    value.width < 1 ||
    value.height < 1 ||
    value.x + value.width > width ||
    value.y + value.height > height
  )
    throw new UserError(
      'Select a nonempty rectangle inside the original image dimensions.'
    )
}
