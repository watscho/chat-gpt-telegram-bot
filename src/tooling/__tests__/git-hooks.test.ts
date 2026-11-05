import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { HookPorts, HookResult } from '../git-hooks.js'
const head = 'a'.repeat(40),
  other = 'b'.repeat(40),
  zeros = '0'.repeat(40)
const native = {
  stdin: '',
  exists: false,
  files: ['pre-push.sample'],
  calls: [] as {
    file: string
    args: string[]
    options: { stdio: string; shell: boolean }
  }[]
}
mock.module('node:child_process', {
  namedExports: {
    spawnSync: (
      file: string,
      args: string[],
      options: { stdio: string; shell: boolean }
    ) => {
      native.calls.push({ file, args, options })
      const stdout =
        file === 'npm'
          ? null
          : args.includes('HEAD') || args.some(arg => arg.endsWith('^{commit}'))
            ? head
            : args.includes('--is-inside-work-tree')
              ? 'true'
              : args.includes('--git-path')
                ? '.git/hooks'
                : ''
      return { status: args.includes('--get') ? 1 : 0, stdout }
    }
  }
})
mock.module('node:fs', {
  namedExports: {
    readFileSync: (path: number | URL) =>
      path === 0 ? native.stdin : '26.13.0\n',
    existsSync: () => native.exists,
    readdirSync: () => native.files
  }
})
const { requireNode, pushUpdates, prePush, installHooks } =
  await import('../git-hooks.js')
function setup() {
  const calls: { file: string; args: string[]; inherit: boolean }[] = [],
    messages: string[] = []
  let config: HookResult = { status: 1, stdout: '' },
    dirty = '',
    lastHead = head,
    inside: HookResult = { status: 0, stdout: 'true' },
    failure: ((file: string, args: string[]) => HookResult | null) | null = null
  const io: HookPorts = {
    node: '26.13.0',
    required: '26.13.0',
    input: () => `refs/heads/main ${head} refs/heads/main ${other}\n`,
    activeHooks: () => [],
    log: message => messages.push(message),
    run: (file, args, inherit = false) => {
      calls.push({ file, args, inherit })
      const failed = failure?.(file, args)
      if (failed) return failed
      if (args.includes('--is-inside-work-tree')) return inside
      if (args.includes('--get')) return config
      if (args.includes('--git-path'))
        return { status: 0, stdout: '.git/hooks' }
      if (args.includes('HEAD'))
        return {
          status: 0,
          stdout:
            calls.filter(call => call.args.includes('HEAD')).length > 1
              ? lastHead
              : head
        }
      if (args.includes('status')) return { status: 0, stdout: dirty }
      return {
        status: 0,
        stdout: args.some(arg => arg.endsWith('^{commit}')) ? head : ''
      }
    }
  }
  return {
    io,
    calls,
    messages,
    config: (value: HookResult) => {
      config = value
    },
    dirty: (value: string) => {
      dirty = value
    },
    lastHead: (value: string) => {
      lastHead = value
    },
    inside: (value: HookResult) => {
      inside = value
    },
    fail: (value: typeof failure) => {
      failure = value
    }
  }
}
void test('push checks enforce the pinned Node major and minimum patch without starting any process', () => {
  for (const actual of ['26.13.0', '26.13.1', '26.14.0'])
    requireNode(actual, '26.13.0')
  for (const [actual, minimum] of [
    ['25.13.0', '26.13.0'],
    ['27.0.0', '26.13.0'],
    ['26.12.9', '26.13.0'],
    ['26.13.0', '26.13.1'],
    ['26.13.0-rc', '26.13.0'],
    ['26.13.0', 'invalid']
  ])
    assert.throws(() => requireNode(actual!, minimum!), /Use Node/)
})
void test('pre-push references validate the exact outgoing commit, including annotated tags and deletion-only pushes', () => {
  assert.equal(
    pushUpdates('', head, () => other),
    true
  )
  assert.equal(
    pushUpdates(`(delete) ${zeros} refs/heads/old ${other}`, head, () => {
      throw new Error('Deletion cannot resolve code')
    }),
    false
  )
  assert.equal(
    pushUpdates(
      `refs/tags/v1 ${other} refs/tags/v1 ${zeros}`,
      head,
      () => head
    ),
    true
  )
  assert.equal(
    pushUpdates(
      `refs/heads/main ${'a'.repeat(64)} refs/heads/main ${'b'.repeat(64)}`,
      head,
      () => head
    ),
    true
  )
  assert.throws(
    () =>
      pushUpdates(
        `refs/heads/other ${other} refs/heads/other ${zeros}`,
        head,
        () => other
      ),
    /differs/
  )
  for (const line of [
    'one two',
    `ref ${'x'.repeat(40)} ref ${zeros}`,
    `ref ${head} ref ${zeros} extra`
  ])
    assert.throws(() => pushUpdates(line, head, () => head), /Invalid/)
})
void test('pre-push installs the locked tree without lifecycle scripts and runs the exact shared CI gate', () => {
  const s = setup()
  prePush(s.io)
  assert.deepEqual(
    s.calls.filter(call => call.file === 'npm'),
    [
      {
        file: 'npm',
        args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
        inherit: true
      },
      { file: 'npm', args: ['run', 'verify'], inherit: true }
    ]
  )
  assert.equal(s.calls.filter(call => call.args.includes('status')).length, 2)
  assert.match(s.messages.at(-1)!, /all CI checks passed/)
  const deletion = setup()
  deletion.io.input = () => `delete ${zeros} refs/heads/old ${head}`
  prePush(deletion.io)
  assert.equal(
    deletion.calls.some(call => call.file === 'npm'),
    false
  )
})
void test('pre-push fails closed on dirty state, dependency/check failures, changed HEAD and changes made during checks', () => {
  for (const stage of [
    'dirty',
    'install',
    'verify',
    'spawn',
    'head',
    'late-dirty',
    'metadata'
  ] as const) {
    const s = setup()
    if (stage === 'dirty') s.dirty(' M src/file.ts')
    if (stage === 'head') s.lastHead(other)
    s.fail((file, args) => {
      if (stage === 'install' && file === 'npm' && args[0] === 'ci')
        return { status: 1, stdout: '' }
      if (stage === 'verify' && file === 'npm' && args[0] === 'run')
        return { status: 2, stdout: '' }
      if (stage === 'spawn' && file === 'npm')
        return { status: null, stdout: '' }
      if (stage === 'metadata' && file === 'git')
        return { status: 128, stdout: '' }
      if (stage === 'late-dirty' && file === 'npm' && args[0] === 'run')
        s.dirty('?? uncommitted.ts')
      return null
    })
    assert.throws(() => prePush(s.io))
    assert.equal(
      s.messages.some(message => message.includes('all CI checks passed')),
      false
    )
  }
})
void test('hook installation is idempotent, local and preserves pre-existing global/local or default hooks', () => {
  const s = setup()
  installHooks(s.io)
  assert.deepEqual(s.calls.at(-1)!.args, [
    'config',
    '--local',
    'core.hooksPath',
    '.githooks'
  ])
  s.config({ status: 0, stdout: '.githooks\n' })
  installHooks(s.io)
  s.config({ status: 0, stdout: '/existing/global-hooks' })
  assert.throws(() => installHooks(s.io), /preserved/)
  s.config({ status: 2, stdout: '' })
  assert.throws(() => installHooks(s.io), /Reading/)
  s.config({ status: 1, stdout: '' })
  s.io.activeHooks = () => ['pre-commit']
  assert.throws(() => installHooks(s.io), /preserved/)
  s.io.activeHooks = () => []
  s.fail((_file, args) =>
    args.includes('--local') ? { status: null, stdout: '' } : null
  )
  assert.throws(() => installHooks(s.io), /Installing/)
  for (const result of [
    { status: 128, stdout: '' },
    { status: 0, stdout: 'false' }
  ]) {
    s.inside(result)
    installHooks(s.io)
    assert.match(s.messages.at(-1)!, /skipped/)
  }
})
void test('default hook ports use mocked process/filesystem boundaries and never execute real Git, npm or network calls', t => {
  const messages: string[] = []
  t.mock.method(console, 'log', (value: unknown) =>
    messages.push(typeof value === 'string' ? value : '')
  )
  native.stdin = ''
  prePush()
  assert.ok(native.calls.every(call => call.options.shell === false))
  assert.equal(
    native.calls.find(call => call.file === 'npm')!.options.stdio,
    'inherit'
  )
  installHooks()
  native.exists = true
  native.files = ['pre-push.sample']
  installHooks()
  native.files = ['pre-push']
  assert.throws(() => installHooks(), /preserved/)
  assert.ok(messages.some(message => message.includes('installed')))
})
