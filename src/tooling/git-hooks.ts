import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
export interface HookResult {
  status: number | null
  stdout: string
}
export interface HookPorts {
  run(file: string, args: string[], inherit?: boolean): HookResult
  input(): string
  node: string
  required: string
  activeHooks(directory: string): string[]
  log(message: string): void
}
function ports(): HookPorts {
  return {
    run: (file, args, inherit = false) => {
      const result = spawnSync(file, args, {
        encoding: 'utf8',
        stdio: inherit ? 'inherit' : 'pipe',
        shell: false
      })
      return { status: result.status, stdout: result.stdout ?? '' }
    },
    input: () => readFileSync(0, 'utf8'),
    node: process.versions.node,
    required: readFileSync(
      new URL('../../.nvmrc', import.meta.url),
      'utf8'
    ).trim(),
    activeHooks: directory =>
      existsSync(directory)
        ? readdirSync(directory).filter(name => !name.endsWith('.sample'))
        : [],
    log: message => console.log(message)
  }
}
function checked(result: HookResult, label: string): string {
  if (result.status !== 0)
    throw new Error(
      `${label} failed${result.status === null ? ' to start' : ` (exit ${result.status})`}. Push blocked.`
    )
  return result.stdout.trim()
}
export function requireNode(actual: string, required: string): void {
  const parse = (value: string) =>
    /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : []
  const current = parse(actual),
    minimum = parse(required)
  if (
    current.length !== 3 ||
    minimum.length !== 3 ||
    current[0] !== minimum[0] ||
    current[1]! < minimum[1]! ||
    (current[1] === minimum[1] && current[2]! < minimum[2]!)
  )
    throw new Error(
      `Use Node ${required} or newer within Node ${minimum[0] ?? 'the pinned major'}; run nvm use before pushing.`
    )
}
export function pushUpdates(
  input: string,
  head: string,
  resolve: (sha: string) => string
): boolean {
  const lines = input.split('\n').filter(line => line.trim())
  if (!lines.length) return true
  let updates = false
  for (const line of lines) {
    const parts = line.trim().split(/\s+/),
      sha = parts[1]
    if (
      parts.length !== 4 ||
      !sha ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)
    )
      throw new Error('Invalid pre-push reference input. Push blocked.')
    if (/^0+$/.test(sha)) continue
    updates = true
    if (resolve(sha) !== head)
      throw new Error(
        'The outgoing commit differs from checked-out HEAD. Check out the branch being pushed and run the checks there.'
      )
  }
  return updates
}
export function prePush(io: HookPorts = ports()): void {
  requireNode(io.node, io.required)
  const git = (args: string[]) =>
      checked(io.run('git', args), `git ${args[0]}`),
    head = git(['rev-parse', '--verify', 'HEAD'])
  if (
    !pushUpdates(io.input(), head, sha =>
      git(['rev-parse', '--verify', `${sha}^{commit}`])
    )
  ) {
    io.log('Deletion-only push: no outgoing code to verify.')
    return
  }
  const clean = () => {
    if (git(['status', '--porcelain=v1', '--untracked-files=normal']))
      throw new Error(
        'Commit or stash tracked and untracked changes before pushing. Checks must match the outgoing commit.'
      )
  }
  clean()
  io.log(
    'Pre-push: installing the locked dependencies without lifecycle scripts, then running the CI checks.'
  )
  checked(
    io.run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], true),
    'Locked dependency installation'
  )
  checked(io.run('npm', ['run', 'verify'], true), 'CI verification')
  if (git(['rev-parse', '--verify', 'HEAD']) !== head)
    throw new Error(
      'HEAD changed during verification. Push again from the reviewed commit.'
    )
  clean()
  io.log('Pre-push: all CI checks passed for the outgoing commit.')
}
export function installHooks(io: HookPorts = ports()): void {
  const repository = io.run('git', ['rev-parse', '--is-inside-work-tree'])
  if (repository.status !== 0 || repository.stdout.trim() !== 'true') {
    io.log('Git hooks skipped: this directory is not a Git worktree.')
    return
  }
  const configured = io.run('git', ['config', '--get', 'core.hooksPath'])
  if (configured.status !== 0 && configured.status !== 1)
    checked(configured, 'Reading Git hook configuration')
  const existing = configured.stdout.trim()
  if (existing && existing !== '.githooks')
    throw new Error(
      'Existing core.hooksPath was preserved. Integrate .githooks/pre-push into your current hook setup before pushing.'
    )
  if (!existing) {
    const directory = checked(
      io.run('git', ['rev-parse', '--git-path', 'hooks']),
      'Reading Git hook directory'
    )
    if (io.activeHooks(directory).length)
      throw new Error(
        'Existing Git hooks were preserved. Integrate .githooks/pre-push into your current hook setup before pushing.'
      )
  }
  checked(
    io.run('git', ['config', '--local', 'core.hooksPath', '.githooks']),
    'Installing Git hooks'
  )
  io.log('Git pre-push checks installed in .githooks.')
}
