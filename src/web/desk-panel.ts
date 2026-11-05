import type { DeskView } from '../application/desk-workspace.js'
import { filterTable, chartValues } from '../domain/table.js'
export interface DeskPanelPorts {
  act(body: Record<string, unknown>): void
  inspect(id: string): void
  download(id: string, version: string, name: string): void
  confirm(text: string): boolean
  redraw(): void
  drafts: Map<string, { revision: number; text: string }>
}
export function renderDesk(
  document: Document,
  root: HTMLElement,
  view: DeskView,
  section: string,
  ports: DeskPanelPorts
): void {
  const node = (tag: string, parent: HTMLElement, text = '') => {
    const item = document.createElement(tag)
    item.textContent = text
    parent.append(item)
    return item
  }
  const article = (title: string, text: string) => {
    const item = node('article', root)
    node('h2', item, title)
    node('p', item, text)
    return item
  }
  const button = (parent: HTMLElement, label: string, run: () => void) => {
    const item = node('button', parent, label)
    item.addEventListener('click', run)
    return item
  }
  const act = (
    action: string,
    id = '',
    value?: string,
    revision?: number,
    confirm?: boolean
  ) =>
    ports.act({
      action: 'desk:' + action,
      id,
      ...(value === undefined ? {} : { value }),
      ...(revision === undefined ? {} : { revision }),
      ...(confirm === undefined ? {} : { confirm })
    })
  const form = (
    parent: HTMLElement,
    label: string,
    values: Record<string, string>,
    run: (value: Record<string, string>) => void
  ) => {
    const fields: Record<string, HTMLInputElement> = {},
      form = node('form', parent)
    for (const [key, value] of Object.entries(values)) {
      const label = node('label', form, key),
        input = document.createElement('input')
      input.value = value
      input.setAttribute('aria-label', key)
      label.append(input)
      fields[key] = input
    }
    const send = node('button', form, label)
    send.setAttribute('type', 'submit')
    form.addEventListener('submit', event => {
      event.preventDefault()
      run(
        Object.fromEntries(
          Object.entries(fields).map(([key, input]) => [key, input.value])
        )
      )
    })
  }
  const remove = (parent: HTMLElement, kind: string, id: string) =>
    button(parent, 'Remove', () => {
      if (ports.confirm('Remove this retained material?'))
        act('remove', id, kind, undefined, true)
    })
  if (view.mission)
    button(
      article(
        'Prepared mission',
        'Inspect inputs, estimated cost and approvals before starting.'
      ),
      'Review mission',
      () => ports.inspect(view.mission!)
    )
  if (view.authorizationURL) {
    const item = article(
        'Authorize connection',
        'Check the provider and requested permissions before continuing.'
      ),
      link = node('a', item, 'Open provider authorization') as HTMLAnchorElement
    link.href = view.authorizationURL
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
  }
  if (section === 'Ask') {
    const item = article(
      'Ask',
      'Use normal Telegram chat or prepare a reviewed request here. Your selected assistant supplies only its explicit sources and instructions.'
    )
    form(item, 'Prepare request', { prompt: '', tool: 'chat' }, value =>
      view.active
        ? act('assistant-run', view.active, JSON.stringify(value))
        : act('ask', '', JSON.stringify(value))
    )
    const link = node('a', item, 'Open live voice') as HTMLAnchorElement
    link.href = new URL('./', document.baseURI).href
  }
  if (section === 'Create') {
    const canvas = article(
      'New document',
      'Write text or code; refine a selected passage after saving.'
    )
    form(
      canvas,
      'Create document',
      { title: 'Untitled', language: 'text', text: '' },
      value => act('create', '', JSON.stringify(value))
    )
    const table = article(
      'New table',
      'Paste explicit columns/rows JSON, or reply to a file in Telegram with /sheet import or /sheet analyze.'
    )
    form(
      table,
      'Review table',
      {
        title: 'New table',
        json: '{"columns":["Item","Value"],"rows":[["Example","1"]]}'
      },
      value => act('table-import', '', JSON.stringify(value))
    )
    article(
      'Photo projects',
      'Attach or reply to images in Telegram: /photos add Project title. Open My materials to select a region and review image versions.'
    )
  }
  if (section === 'Assistants') {
    const intro = article(
      'Personal assistants',
      'Instructions, explicitly selected knowledge and separately granted tools. /assistant sources ID copies your current Suite source selection.'
    )
    form(
      intro,
      'Create assistant',
      { title: '', instructions: '', model: '', tools: '' },
      value =>
        act(
          'assistant-create',
          '',
          JSON.stringify({ ...value, model: value.model || null })
        )
    )
    button(intro, 'Use normal chat', () => act('assistant-use', 'none'))
    for (const assistant of view.assistants) {
      const item = article(
        assistant.title,
        `${view.active === assistant.id ? 'Active · ' : ''}${assistant.instructions}\nTools: ${assistant.tools.join(', ') || 'chat only'}\nSources: ${assistant.sources.map(item => item.title).join(', ') || 'none'}`
      )
      button(item, 'Use assistant', () => act('assistant-use', assistant.id))
      form(
        item,
        'Prepare assistant request',
        { prompt: '', tool: 'chat' },
        value => act('assistant-run', assistant.id, JSON.stringify(value))
      )
      remove(item, 'assistants', assistant.id)
    }
  }
  if (section === 'Connections') {
    for (const connection of view.connections) {
      const item = article(
        connection.title,
        `${connection.server}\n${connection.enabled ? 'Enabled' : 'Disconnected'} · ${connection.authorized ? 'Authorized' : 'Authorization required'}\nAuthentication: ${connection.authentication}\nAllowed tools: ${connection.tools.join(', ')}`
      )
      button(item, 'Enable', () => act('connection-enable', connection.id))
      if (connection.authentication === 'oauth')
        button(item, 'Authorize', () =>
          act('connection-authorize', connection.id)
        )
      button(item, 'Disconnect', () => {
        if (
          ports.confirm(
            'Disconnect local service access and remove its saved token?'
          )
        )
          act(
            'connection-disconnect',
            connection.id,
            undefined,
            undefined,
            true
          )
      })
    }
    const browser = article(
      'Browser recipes',
      'Use an operator-configured isolated MCP browser driver. Every proposed operation is reviewed in Telegram.'
    )
    form(
      browser,
      'Create browser recipe',
      { title: '', connection: '', origins: 'https://example.com', tools: '' },
      value => act('browser-create', '', JSON.stringify(value))
    )
    for (const recipe of view.browsers) {
      const item = article(
        recipe.title,
        `Origins: ${recipe.origins.join(', ')}\nTools: ${recipe.tools.join(', ')}`
      )
      form(
        item,
        'Prepare browser task',
        { url: recipe.origins[0]! + '/', goal: '' },
        value => act('browser-run', recipe.id, JSON.stringify(value))
      )
      remove(item, 'browsers', recipe.id)
    }
  }
  if (section === 'My materials') {
    for (const canvas of view.documents) {
      const item = article(
          canvas.title,
          `${canvas.language} · revision ${canvas.revision}`
        ),
        edit = document.createElement('textarea')
      edit.setAttribute('aria-label', 'Document text')
      edit.rows = 14
      const draft = ports.drafts.get(canvas.id)
      edit.value = draft?.text ?? canvas.text
      item.append(edit)
      edit.addEventListener('input', () =>
        ports.drafts.set(canvas.id, {
          revision: draft?.revision ?? canvas.revision,
          text: edit.value
        })
      )
      if (draft && draft.revision !== canvas.revision)
        node(
          'p',
          item,
          'This local draft was based on an older revision. Inspect the current server version before saving.'
        )
      button(item, 'Save document', () =>
        act(
          'save',
          canvas.id,
          edit.value,
          ports.drafts.get(canvas.id)?.revision ?? canvas.revision
        )
      )
      button(item, 'Discard local draft', () => {
        ports.drafts.delete(canvas.id)
        ports.redraw()
      })
      form(item, 'Propose selected edit', { goal: '' }, value =>
        act(
          'edit',
          canvas.id,
          JSON.stringify({
            start: edit.selectionStart,
            end: edit.selectionEnd,
            goal: value.goal
          }),
          canvas.revision
        )
      )
      const versions = node('select', item) as HTMLSelectElement
      versions.setAttribute('aria-label', 'Document version')
      for (const version of canvas.versions) {
        const option = node(
          'option',
          versions,
          version.label + ' · ' + new Date(version.at).toISOString()
        ) as HTMLOptionElement
        option.value = version.id
      }
      button(item, 'Restore document version', () =>
        act('restore', canvas.id, versions.value, canvas.revision)
      )
      button(item, 'Download document', () =>
        ports.download(
          `desk:canvas:${canvas.id}`,
          versions.value,
          'document.' + (canvas.language === 'text' ? 'txt' : canvas.language)
        )
      )
      remove(item, 'documents', canvas.id)
    }
    for (const table of view.tables) {
      const item = article(
        table.title,
        `${table.rows.length} rows · revision ${table.revision}\n${table.source}`
      )
      let query = '',
        sort = -1,
        descending = false,
        page = 0,
        labelColumn = 0,
        valueColumn = Math.min(1, table.columns.length - 1)
      const output = node('div', item),
        chart = node('div', item)
      const render = () => {
        output.replaceChildren()
        const filtered = filterTable(table, query, sort, descending),
          grid = node('table', output),
          header = node('tr', grid)
        for (const column of table.columns) node('th', header, column)
        for (const row of filtered.rows.slice(page * 25, page * 25 + 25)) {
          const tr = node('tr', grid)
          for (const cell of row) node('td', tr, cell ?? '—')
        }
        node(
          'p',
          output,
          `${filtered.rows.length} matching rows · page ${page + 1}`
        )
      }
      form(
        item,
        'Filter and sort',
        { query: '', column: '-1', descending: 'false' },
        value => {
          query = value.query!
          sort = Number(value.column)
          descending = value.descending === 'true'
          page = 0
          try {
            render()
          } catch {
            node(
              'p',
              output,
              'Choose a valid filter and sort column (-1 for none).'
            )
          }
        }
      )
      button(item, 'Previous rows', () => {
        page = Math.max(0, page - 1)
        render()
      })
      button(item, 'Next rows', () => {
        if (
          (page + 1) * 25 <
          filterTable(table, query, sort, descending).rows.length
        )
          page++
        render()
      })
      form(item, 'Save cell', { row: '1', column: '1', value: '' }, value =>
        act(
          'cell',
          table.id,
          JSON.stringify({
            row: Number(value.row) - 1,
            column: Number(value.column) - 1,
            value: value.value
          }),
          table.revision
        )
      )
      form(
        item,
        'Draw bar chart',
        { label: '0', value: String(valueColumn) },
        value => {
          labelColumn = Number(value.label)
          valueColumn = Number(value.value)
          chart.replaceChildren()
          try {
            const values = chartValues(
                filterTable(table, query, sort, descending),
                labelColumn,
                valueColumn
              ),
              max = Math.max(1, ...values.map(item => Math.abs(item.value)))
            for (const value of values) {
              const row = node('p', chart, `${value.label}: ${value.value}`),
                bar = node('span', row)
              bar.className = 'data-bar'
              bar.style.width = `${(Math.abs(value.value) / max) * 100}%`
              bar.setAttribute('aria-hidden', 'true')
            }
          } catch {
            node(
              'p',
              chart,
              'Choose valid columns with explicit numeric values.'
            )
          }
        }
      )
      const versions = node('select', item) as HTMLSelectElement
      versions.setAttribute('aria-label', 'Table version')
      for (const version of table.versions) {
        const option = node(
          'option',
          versions,
          new Date(version.at).toISOString()
        ) as HTMLOptionElement
        option.value = version.id
      }
      button(item, 'Restore table version', () =>
        act('table-restore', table.id, versions.value, table.revision)
      )
      button(item, 'Download CSV', () =>
        ports.download(`desk:table:${table.id}`, versions.value, 'table.csv')
      )
      remove(item, 'tables', table.id)
      render()
    }
    for (const project of view.photos) {
      const item = article(
        project.title,
        `Revision ${project.revision}. Select a region on the original PNG, then describe the change. Model edits may affect pixels outside the mask; inspect the result.`
      )
      let selected = project.images[0]!,
        region: { x: number; y: number; width: number; height: number } | null =
          null,
        start: { x: number; y: number } | null = null
      const image = document.createElement('img')
      image.src = `data:${selected.image.mime};base64,${selected.image.data}`
      image.alt = project.title
      image.className = 'photo-source'
      const frame = node('div', item)
      frame.className = 'photo-frame'
      frame.append(image)
      const marker = node('span', frame)
      marker.className = 'mask-region'
      marker.style.display = 'none'
      const selection = node('p', item, 'No region selected.')
      image.addEventListener('pointerdown', event => {
        const bounds = image.getBoundingClientRect()
        start = {
          x: Math.floor(
            ((event.clientX - bounds.left) / bounds.width) * image.naturalWidth
          ),
          y: Math.floor(
            ((event.clientY - bounds.top) / bounds.height) * image.naturalHeight
          )
        }
      })
      image.addEventListener('pointerup', event => {
        if (!start) return
        const bounds = image.getBoundingClientRect(),
          x = Math.floor(
            ((event.clientX - bounds.left) / bounds.width) * image.naturalWidth
          ),
          y = Math.floor(
            ((event.clientY - bounds.top) / bounds.height) * image.naturalHeight
          )
        region = {
          x: Math.min(start.x, x),
          y: Math.min(start.y, y),
          width: Math.abs(x - start.x),
          height: Math.abs(y - start.y)
        }
        selection.textContent = JSON.stringify(region)
        marker.style.display = 'block'
        marker.style.left = `${(region.x / image.naturalWidth) * 100}%`
        marker.style.top = `${(region.y / image.naturalHeight) * 100}%`
        marker.style.width = `${(region.width / image.naturalWidth) * 100}%`
        marker.style.height = `${(region.height / image.naturalHeight) * 100}%`
        start = null
      })
      const versions = node('select', item) as HTMLSelectElement
      versions.setAttribute('aria-label', 'Photo version')
      for (const version of project.images) {
        const option = node(
          'option',
          versions,
          version.label
        ) as HTMLOptionElement
        option.value = version.id
      }
      versions.addEventListener('change', () => {
        selected = project.images.find(item => item.id === versions.value)!
        image.src = `data:${selected.image.mime};base64,${selected.image.data}`
        region = null
        marker.style.display = 'none'
        selection.textContent = 'Select a region on this version.'
      })
      form(item, 'Prepare region edit', { goal: '' }, value =>
        act(
          'photo-edit',
          project.id,
          JSON.stringify({ ...region, image: selected.id, goal: value.goal })
        )
      )
      button(item, 'Download image', () =>
        ports.download(
          `desk:photo:${project.id}`,
          selected.id,
          'photo.' + selected.image.mime.slice(6).replace('jpeg', 'jpg')
        )
      )
      remove(item, 'photos', project.id)
    }
  }
  if (view.pending) {
    const pending = view.pending,
      item = article(
        `Review ${pending.kind} · revision ${pending.revision}`,
        pending.value
      )
    if (pending.kind === 'edit') {
      const value = JSON.parse(pending.value) as {
        before: string
        replacement: string
      }
      node('h3', item, 'Before')
      node('pre', item, value.before)
      node('h3', item, 'Proposed replacement')
      node('pre', item, value.replacement)
    }
    if (pending.kind !== 'voice')
      button(item, 'Accept exact proposal', () => {
        if (ports.confirm('Apply exactly the displayed proposal?'))
          act('confirm', pending.token, undefined, pending.revision, true)
      })
    button(item, 'Cancel proposal', () =>
      act('cancel', pending.token, undefined, pending.revision)
    )
  }
}
