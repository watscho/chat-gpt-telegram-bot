import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'

function start(mode: string, credentials = true) {
  const child = fork(new URL('../index.ts', import.meta.url), [], {
    execArgv: [
      '--import',
      'tsx',
      '--import',
      new URL('./fixtures/telegram-runtime.mjs', import.meta.url).href
    ],
    silent: true,
    env: {
      PATH: process.env.PATH,
      RUNTIME_TEST_MODE: mode,
      STATE_DB_PATH: ':memory:',
      ...(credentials
        ? {
            TELEGRAM_API_KEY: '123456:test-secret',
            OPENAI_API_KEY: 'test-secret',
            OPENAI_CHAT_MODEL: 'test-model',
            ALLOWED_TELEGRAM_USER_IDS: '42'
          }
        : {})
    }
  })
  let output = ''
  child.stdout?.on('data', (data: Buffer) => {
    output += data.toString()
  })
  child.stderr?.on('data', (data: Buffer) => {
    output += data.toString()
  })
  const exited = once(child, 'exit') as Promise<
    [number | null, NodeJS.Signals | null]
  >
  return { child, exited, output: () => output }
}

void test(
  'startup validates configuration before accessing providers',
  { timeout: 10000 },
  async t => {
    const app = start('failure', false)
    t.after(() => {
      app.child.kill('SIGKILL')
    })
    const [code] = await app.exited
    assert.equal(code, 1)
    assert.match(app.output(), /Missing required configuration/)
    assert.ok(!app.output().includes('test-secret'))
  }
)

void test(
  'provider startup failures exit nonzero without leaking credentials',
  { timeout: 10000 },
  async t => {
    const app = start('failure')
    t.after(() => {
      app.child.kill('SIGKILL')
    })
    const [code] = await app.exited
    assert.equal(code, 1)
    assert.match(app.output(), /Bot startup or polling failed/)
    assert.ok(!app.output().includes('secret'))
  }
)

for (const mode of ['startup', 'polling']) {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    void test(
      `${signal} terminates cleanly during ${mode}`,
      { timeout: 10000 },
      async t => {
        const app = start(mode)
        t.after(() => {
          app.child.kill('SIGKILL')
        })
        const [ready] = await (once(app.child, 'message') as Promise<[unknown]>)
        assert.equal(ready, mode)
        app.child.kill(signal)
        const [code, exitSignal] = await app.exited
        assert.equal(code, 0)
        assert.equal(exitSignal, null)
        assert.ok(!app.output().includes('failed'))
      }
    )
  }
}

for (const mode of ['shutdown-ok', 'shutdown-failure']) {
  void test(
    `shutdown deadline terminates stuck polling and tolerates repeated signals: ${mode}`,
    { timeout: 10000 },
    async t => {
      const app = start(mode)
      t.after(() => {
        app.child.kill('SIGKILL')
      })
      const [ready] = await (once(app.child, 'message') as Promise<[unknown]>)
      assert.equal(ready, mode)
      const stopped = once(app.child, 'message') as Promise<[unknown]>
      app.child.kill('SIGTERM')
      assert.equal((await stopped)[0], 'stopping')
      app.child.kill('SIGINT')
      const [code, signal] = await app.exited
      assert.equal(code, mode === 'shutdown-failure' ? 1 : 0)
      assert.equal(signal, null)
    }
  )
}
