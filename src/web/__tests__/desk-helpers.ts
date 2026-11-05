import { WorkspaceElement, workspaceDOM } from './workspace-helpers.js'
export class DeskElement extends WorkspaceElement {
  style: Record<string, string> = {}
  rows = 0
  selectionStart = 0
  selectionEnd = 3
  naturalWidth = 100
  naturalHeight = 100
  videoWidth = 100
  videoHeight = 100
  muted = false
  src = ''
  width = 0
  height = 0
  name = ''
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 200, height: 200 }
  }
  getContext() {
    return { drawImage() {} }
  }
  toDataURL() {
    return 'data:image/jpeg;base64,QQ=='
  }
}
export function deskDOM() {
  const dom = workspaceDOM(),
    created: DeskElement[] = []
  dom.document.createElement = ((tag: string) => {
    const node = new DeskElement()
    node.tag = tag
    created.push(node)
    return node
  }) as typeof dom.document.createElement
  return { ...dom, created }
}
export function trigger(
  node: Pick<WorkspaceElement, 'events'>,
  event: string,
  value: unknown = { preventDefault() {} }
): void {
  const handler = node.events[event] as unknown as (event: unknown) => void
  handler(value)
}
