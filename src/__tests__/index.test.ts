import { test } from 'node:test'
import assert from 'node:assert/strict'

const events = new Map<string, (...args: unknown[]) => void>()
const exits: unknown[] = []
const logs: string[] = []
let failure: 'config' | 'provider' | undefined
let stoppingEarly = false
let storesClosed = 0
let stops = 0
let workerFailure = false
import { ConfigurationError } from '../config.js'
import { dependencies } from '../infrastructure/dependencies.js'
import { config } from './helpers.js'

void test('entrypoint initializes composition, reports safe failures and registers bounded shutdown', async t => {
  t.mock.property(dependencies, 'loadConfig', () => {
    if (failure === 'config')
      throw new ConfigurationError('Missing required configuration: TEST')
    return config()
  })
  t.mock.property(
    dependencies,
    'OpenAI',
    class {} as unknown as typeof dependencies.OpenAI
  )
  t.mock.property(
    dependencies,
    'OpenAIModel',
    class {} as unknown as typeof dependencies.OpenAIModel
  )
  t.mock.property(
    dependencies,
    'RealtimeSpeech',
    class {} as unknown as typeof dependencies.RealtimeSpeech
  )
  t.mock.property(
    dependencies,
    'SQLiteStateStore',
    class {
      close() {
        storesClosed++
      }
    } as unknown as typeof dependencies.SQLiteStateStore
  )
  t.mock.property(dependencies, 'createBot', (() => ({
    stopJobs: () => {},
    tickJobs: () =>
      workerFailure
        ? Promise.reject(new Error('private worker error'))
        : Promise.resolve(),
    stop: () => {
      stops++
      if (stoppingEarly) throw new Error('not started')
    },
    launch: (_options: unknown, ready: () => void) => {
      if (failure === 'provider')
        return Promise.reject(new Error('provider-secret'))
      ready()
      return Promise.resolve()
    }
  })) as unknown as typeof dependencies.createBot)
  t.mock.method(process, 'once', ((
    event: string,
    callback: (...args: unknown[]) => void
  ) => {
    events.set(event, callback)
    return process
  }) as typeof process.once)
  t.mock.method(process, 'exit', ((code: number) => {
    exits.push(code)
  }) as typeof process.exit)
  t.mock.method(console, 'info', (text: string) => {
    logs.push(text)
  })
  t.mock.method(console, 'error', (text: string) => {
    logs.push(text)
  })
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const previous = process.exitCode
  t.after(() => {
    process.exitCode = previous
  })
  failure = 'config'
  const { main, reportFailure } = await import('../index.js')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(process.exitCode, 1)
  assert.ok(logs.some(text => text.includes('Missing required configuration')))
  failure = 'provider'
  await main().catch(reportFailure)
  assert.ok(logs.some(text => text.includes('Bot startup or polling failed')))
  assert.ok(!logs.join('').includes('secret'))
  failure = undefined
  for (const code of [0, 1]) {
    process.exitCode = code
    await main()
    workerFailure = code === 1
    t.mock.timers.tick(config().workerIntervalMs)
    await new Promise(resolve => setImmediate(resolve))
    events.get('SIGTERM')!()
    events.get('SIGINT')!()
    t.mock.timers.tick(10000)
    assert.equal(exits.at(-1), code)
    events.get('exit')!()
  }
  stoppingEarly = true
  await main()
  events.get('SIGINT')!()
  assert.equal(exits.at(-1), 0)
  assert.equal(stops, 3)
  assert.equal(storesClosed, 2)
})
