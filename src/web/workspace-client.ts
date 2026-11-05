import { renderHome } from './home-panel.js'
import type { WorkspaceView } from '../application/studio-workspace.js'
export interface WorkspaceWindow {
  Telegram?: {
    WebApp?: {
      initData: string
      ready(): void
      expand(): void
      addToHomeScreen?(): void
    }
  }
  confirm(message: string): boolean
  addEventListener(type: string, callback: () => void): void
}
export function mountWorkspace(
  document: Document,
  window: WorkspaceWindow
): { refresh(): Promise<void> } {
  const get = <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id)
    if (!element) throw new Error('Workspace interface is incomplete.')
    return element as T
  }
  const project = get<HTMLSelectElement>('project'),
    thread = get<HTMLSelectElement>('thread'),
    nav = get('nav'),
    title = get('title'),
    status = get('status'),
    error = get('error'),
    list = get('list'),
    detail = get('detail'),
    review = get('review'),
    result = get<HTMLTextAreaElement>('result'),
    actions = get('actions'),
    files = get('files'),
    hint = get('hint'),
    usage = get('usage'),
    refreshButton = get<HTMLButtonElement>('refresh')
  const app = window.Telegram?.WebApp,
    initData = app?.initData ?? ''
  app?.ready()
  app?.expand()
  let view: WorkspaceView | null = null,
    section = 'Home',
    busy = false,
    selected: string | undefined,
    alive = true,
    generation = 0
  const edits = new Map<string, { revision: number; text: string }>()
  const fail = () => {
    error.hidden = false
    error.textContent =
      'Unable to update. Reopen from Telegram or refresh to inspect the latest state.'
    status.textContent = 'Update failed'
  }
  const request = async (
    body?: Record<string, unknown>
  ): Promise<WorkspaceView> => {
    const url = new URL(
      body ? 'api/workspace/action' : 'api/workspace',
      document.baseURI
    )
    if (!body && selected) url.searchParams.set('mission', selected)
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'X-Telegram-Init-Data': initData,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    if (!response.ok) throw new Error('Workspace request failed.')
    const data: unknown = await response.json()
    if (
      !data ||
      typeof data !== 'object' ||
      !('missions' in data) ||
      !Array.isArray(data.missions) ||
      !('projects' in data) ||
      !Array.isArray(data.projects)
    )
      throw new Error('Invalid workspace response.')
    return data as WorkspaceView
  }
  const button = (
    parent: HTMLElement,
    text: string,
    action: () => void,
    primary = false
  ) => {
    const element = document.createElement('button')
    element.textContent = text
    if (primary) element.className = 'primary'
    element.addEventListener('click', action)
    parent.append(element)
    return element
  }
  const download = async (mission: string, version: string, name: string) => {
    try {
      const url = new URL('api/workspace/file', document.baseURI)
      url.searchParams.set('mission', mission)
      url.searchParams.set('version', version)
      url.searchParams.set('name', name)
      const response = await fetch(url, {
        headers: { 'X-Telegram-Init-Data': initData }
      })
      if (!response.ok) throw new Error('Download failed.')
      const href = URL.createObjectURL(await response.blob()),
        link = document.createElement('a')
      link.href = href
      link.download = name
      link.click()
      URL.revokeObjectURL(href)
    } catch {
      fail()
    }
  }
  const act = async (body: Record<string, unknown>) => {
    if (busy) return
    busy = true
    generation++
    error.hidden = true
    status.textContent = 'Saving…'
    try {
      view = await request(body)
      if (body.action === 'edit' || body.action === 'restore')
        edits.delete(String(body.id))
      if (alive) render(view)
    } catch {
      fail()
    } finally {
      busy = false
    }
  }
  const article = (heading: string, text: string) => {
    const node = document.createElement('article'),
      h = document.createElement('h2'),
      p = document.createElement('p')
    h.textContent = heading
    p.textContent = text
    node.append(h, p)
    list.append(node)
    return node
  }
  const selectOptions = (
    node: HTMLSelectElement,
    values: { id: string; title: string }[],
    current: string
  ) => {
    node.replaceChildren()
    for (const value of values) {
      const option = document.createElement('option')
      option.value = value.id
      option.textContent = value.title
      node.append(option)
    }
    node.value = current
  }
  const render = (snapshot: WorkspaceView) => {
    if (section === 'Home' && !snapshot.home) section = 'Missions'
    title.textContent = section
    status.textContent = 'Updated'
    error.hidden = true
    selectOptions(
      project,
      [{ id: 'none', title: 'No project' }, ...snapshot.projects],
      snapshot.project ?? 'none'
    )
    selectOptions(thread, snapshot.threads, snapshot.thread)
    usage.textContent = `${snapshot.usage.requests} requests today · estimated $${(snapshot.usage.estimatedMicroUsd / 1000000).toFixed(2)}`
    nav.replaceChildren()
    for (const name of [
      ...(snapshot.home ? ['Home'] : []),
      'Missions',
      'Inbox',
      'Tasks',
      'Files',
      'Jobs',
      ...(snapshot.suite ? ['Suite'] : [])
    ]) {
      const element = button(nav, name, () => {
        section = name
        render(snapshot)
      })
      element.setAttribute('aria-current', String(section === name))
    }
    list.replaceChildren()
    if (section === 'Home' && snapshot.home)
      renderHome(document, list, snapshot.home, {
        act: body => {
          void act(body)
        },
        inspect: id => {
          section = 'Missions'
          void act({ action: 'inspect', id })
        },
        confirm: message => window.confirm(message),
        ...(app?.addToHomeScreen
          ? { shortcut: () => app.addToHomeScreen!() }
          : {})
      })
    if (section === 'Missions')
      for (const mission of snapshot.missions) {
        const node = article(
          mission.title,
          `${mission.state} · conversation ${mission.thread}\nRemaining estimate $${(mission.estimate / 1000000).toFixed(2)}`
        )
        button(node, 'Open', () => {
          selected = mission.id
          void act({ action: 'inspect', id: mission.id })
        })
      }
    if (section === 'Inbox')
      for (const item of snapshot.inbox) {
        const node = article(
          item.text || item.recording || 'Captured material',
          `${item.kind} · conversation ${item.thread} · project ${item.project ?? 'none'}\n${item.files.join(', ')}\nTelegram: /inbox plan ${item.id}`
        )
        const select = document.createElement('select')
        selectOptions(
          select,
          [{ id: 'none', title: 'No project' }, ...snapshot.projects],
          item.project ?? 'none'
        )
        select.addEventListener('change', () => {
          void act({ action: 'inbox-assign', id: item.id, value: select.value })
        })
        node.append(select)
        button(node, 'Delete', () => {
          if (window.confirm('Delete this Inbox item?'))
            void act({ action: 'inbox-delete', id: item.id, confirm: true })
        })
      }
    if (section === 'Tasks')
      for (const task of snapshot.tasks) {
        const node = article(
          task.title,
          `${task.status} · conversation ${task.thread}${task.dueAt ? ' · ' + new Date(task.dueAt).toISOString() : ''}`
        )
        button(node, task.status === 'done' ? 'Reopen' : 'Mark done', () => {
          void act({
            action: 'task',
            id: task.id,
            value: task.status === 'done' ? 'open' : 'done'
          })
        })
      }
    if (section === 'Files')
      for (const item of snapshot.projects)
        for (const file of item.files) {
          const node = article(file.name, `${item.title} · ${file.bytes} bytes`)
          button(node, 'Download', () => {
            void download(`project:${item.id}`, 'project', file.name)
          })
        }
    if (section === 'Jobs')
      for (const job of snapshot.jobs)
        article(
          job.id,
          `${job.state} · conversation ${job.thread}\nTelegram: /job ${job.id}`
        )
    if (section === 'Suite' && snapshot.suite) {
      const suite = snapshot.suite
      const search = article(
        'Search your retained work',
        'Keyword search over your own retained conversations, indexed files, tasks and records. Selected excerpts are sent only with a reviewed workflow plan.'
      )
      const input = document.createElement('input')
      input.setAttribute('aria-label', 'Search retained work')
      search.append(input)
      button(search, 'Search', () => {
        void act({ action: 'suite:search', id: '', value: input.value })
      })
      button(search, 'Clear selected sources', () => {
        void act({ action: 'suite:clear', id: '' })
      })
      for (const hit of suite.hits) {
        const node = article(hit.title, `${hit.kind}\n${hit.excerpt}`)
        button(node, 'Select source', () => {
          void act({ action: 'suite:select', id: hit.id })
        })
      }
      article(
        'Selected sources',
        suite.selected.map(source => source.title).join('\n') ||
          'None selected. Telegram: /suite lists workflow commands.'
      )
      for (const record of suite.records) {
        const node = article(
          `${record.kind}: ${record.title}`,
          `Revision ${record.revision} · conversation ${record.thread}\n${record.rows
            .map(row =>
              Object.entries(row)
                .map(([key, value]) => `${key}: ${value ?? '(missing)'}`)
                .join('\n')
            )
            .join('\n\n')}\nTelegram: /suite record ${record.id}`
        )
        button(node, 'Delete record', () => {
          if (window.confirm('Delete this record and retained revisions?'))
            void act({ action: 'suite:delete', id: record.id, confirm: true })
        })
      }
      for (const watch of suite.watches) {
        const node = article(
          `Watch ${watch.id}`,
          `${JSON.stringify(watch.target)}\n${watch.error}\n${watch.changes.map(change => change.diff).join('\n')}\nTelegram: /suite watch show ${watch.id}`
        )
        button(node, watch.enabled ? 'Disable watch' : 'Enable watch', () => {
          void act({
            action: 'suite:watch',
            id: watch.id,
            value: !watch.enabled
          })
        })
      }
      for (const team of suite.teams) {
        const node = article(
          `Shared: ${team.title}`,
          `Your role: ${team.role}\n${team.members.map(member => `${member.owner}: ${member.role}`).join('\n')}\n${team.notes.map(note => note.text).join('\n')}\n${team.tasks.map(task => `${task.done ? 'Done' : 'Open'}: ${task.title}`).join('\n')}\nTelegram: /suite team show ${team.id}. Access is rechecked on every request.`
        )
        for (const file of team.files)
          button(node, `Download ${file.name}`, () => {
            void download(`team:${team.id}`, file.id, file.name)
          })
      }
      for (const template of suite.templates)
        article(
          `Template: ${template.name}`,
          `${template.brand} · ${template.font} · #${template.accent}\n/suite brand ${template.name} docx | goal`
        )
      for (const criterion of suite.criteria)
        article(`Criterion: ${criterion.label}`, criterion.check)
      for (const recipe of suite.recipes)
        article(
          `Recipe: ${recipe.name}`,
          `Revision ${recipe.revision}\n${recipe.goal}\n${recipe.steps.map(step => step.title).join('\n')}\n/suite recipe run ${recipe.name}`
        )
    }
    if (!list.childElementCount)
      article(
        'Nothing here yet',
        section === 'Missions'
          ? 'Start in Telegram: /autopilot goal or /investigate question'
          : section === 'Inbox'
            ? 'Use /inbox on in Telegram to collect messages, files and recordings.'
            : 'Choose another section or add material in Telegram.'
      )
    const current = snapshot.detail
    detail.hidden = !current
    if (!current) return
    selected = current.id
    review.textContent = `${current.title}\n${current.state} · revision ${current.revision} · conversation ${current.thread}\nGoal: ${current.goal}\nPreferences: ${current.instructions || 'none'}\nMaterials: ${current.documents.join(', ') || 'none'}; ${current.images} images\nRemaining estimate: $${(current.estimate / 1000000).toFixed(6)}\n\n${current.steps.map((step, index) => `${index + 1}. ${step.title} · ${step.state}\n${step.prompt}\n${step.receipt?.text ?? 'Not attempted.'}${step.actions.length ? '\nActions awaiting Telegram review:\n' + step.actions.map(call => call.name + '\n' + call.arguments).join('\n') : ''}`).join('\n\n')}`
    result.value = edits.get(current.id)?.text ?? current.result?.text ?? ''
    result.disabled = !current.result
    actions.replaceChildren()
    files.replaceChildren()
    const mutate = (action: string, value?: string) => {
      void act({
        action,
        id: current.id,
        revision:
          action === 'edit'
            ? (edits.get(current.id)?.revision ?? current.revision)
            : current.revision,
        ...(value !== undefined ? { value } : {})
      })
    }
    if (current.state === 'draft')
      button(
        actions,
        'Approve plan and estimate',
        () => {
          if (
            window.confirm(
              'Start the displayed plan with these materials and configured estimate? External tool actions require separate approval in Telegram.'
            )
          )
            mutate('start')
        },
        true
      )
    if (current.state === 'queued')
      button(actions, 'Pause', () => mutate('pause'))
    if (current.state === 'paused')
      button(actions, 'Resume', () => mutate('resume'))
    if (!['done', 'cancelled'].includes(current.state))
      button(actions, 'Cancel', () => {
        if (
          window.confirm(
            'Cancel this mission? Already-started provider work may still be billed.'
          )
        )
          mutate('cancel')
      })
    if (current.result) {
      if (current.state === 'done' || current.state === 'paused') {
        button(
          actions,
          'Save text version',
          () => mutate('edit', result.value),
          true
        )
        const versions = document.createElement('select')
        selectOptions(
          versions,
          current.versions.map(version => ({
            id: version.id,
            title: version.label
          })),
          current.selected!
        )
        actions.append(versions)
        button(actions, 'Restore selected version', () => {
          if (
            !edits.has(current.id) ||
            window.confirm('Discard unsaved text and restore this version?')
          )
            mutate('restore', versions.value)
        })
      }
      for (const file of current.result.files)
        button(files, `Download ${file.name}`, () => {
          void download(current.id, current.selected!, file.name)
        })
      for (const source of current.result.sources) {
        const link = document.createElement('a')
        link.href = source.url
        link.textContent = source.title
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        files.append(link)
      }
    }
    hint.textContent = `/mission context ${current.id} downloads the full stored context; /result revise ${current.id} | instructions proposes a paid revision. External approvals and uncertain retries require Telegram.`
  }
  const refresh = async () => {
    if (!initData) {
      status.textContent = 'Open this workspace from Telegram.'
      refreshButton.disabled = true
      return
    }
    const sequence = ++generation
    refreshButton.disabled = true
    status.textContent = 'Loading…'
    try {
      const latest = await request()
      if (alive && sequence === generation && !busy) {
        view = latest
        render(view)
      }
    } catch {
      if (alive) fail()
    } finally {
      refreshButton.disabled = false
    }
  }
  result.addEventListener('input', () => {
    const current = view?.detail
    if (current)
      edits.set(current.id, {
        revision: edits.get(current.id)?.revision ?? current.revision,
        text: result.value
      })
  })
  refreshButton.addEventListener('click', () => {
    void refresh()
  })
  project.addEventListener('change', () => {
    void act({ action: 'project', id: project.value })
  })
  thread.addEventListener('change', () => {
    selected = undefined
    void act({ action: 'thread', id: thread.value })
  })
  window.addEventListener('pagehide', () => {
    alive = false
    generation++
  })
  void refresh()
  return { refresh }
}
if (typeof document !== 'undefined' && typeof window !== 'undefined')
  mountWorkspace(document, window)
