export type WatchTarget =
  { kind: 'url'; url: string } | { kind: 'file'; project: string; name: string }
export interface Watch {
  id: string
  thread: string
  target: WatchTarget
  interval: number
  threshold: number
  revision: number
  enabled: boolean
  nextAt: number
  lastAt: number
  baseline: { hash: string; title: string; text: string } | null
  error: string
  changes: {
    at: number
    before: string
    after: string
    diff: string
    notified: boolean
  }[]
}
export interface WatchPorts {
  allowed(owner: string): boolean
  read(
    owner: string,
    target: WatchTarget,
    signal: AbortSignal
  ): Promise<{ title: string; text: string }>
  notify(owner: string, watch: Watch): Promise<void>
}
