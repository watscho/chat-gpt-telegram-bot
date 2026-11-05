import { Element } from './helpers.js'
export class WorkspaceElement extends Element {
  tag = ''
  className = ''
  href = ''
  download = ''
  target = ''
  rel = ''
  click() {
    this.events.click?.()
  }
}
export function workspaceDOM() {
  const nodes = Object.fromEntries(
    [
      'project',
      'thread',
      'nav',
      'title',
      'status',
      'error',
      'list',
      'detail',
      'review',
      'result',
      'actions',
      'files',
      'hint',
      'usage',
      'refresh'
    ].map(id => [id, new WorkspaceElement()])
  )
  const created: WorkspaceElement[] = [],
    events: Record<string, () => void> = {}
  const document = {
    baseURI: 'https://voice.example.com/voice/',
    getElementById: (id: string) => nodes[id] ?? null,
    createElement: (tag: string) => {
      const element = new WorkspaceElement()
      element.tag = tag
      created.push(element)
      return element
    }
  }
  let confirm = true
  const window = {
    Telegram: { WebApp: { initData: 'signed', ready() {}, expand() {} } },
    confirm: () => confirm,
    addEventListener: (name: string, callback: () => void) => {
      events[name] = callback
    }
  }
  const find = (parent: string, label: string) => {
    const node = (nodes[parent]!.children as WorkspaceElement[]).find(
      element => element.textContent === label
    )
    if (!node) throw new Error(`Missing control ${label}`)
    return node
  }
  return {
    nodes,
    created,
    events,
    document: document as unknown as Document,
    window,
    find,
    confirm: (value: boolean) => {
      confirm = value
    }
  }
}
