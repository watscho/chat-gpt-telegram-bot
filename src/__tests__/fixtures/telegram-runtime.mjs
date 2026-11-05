// Offline transport for child-process lifecycle tests only.
import { Telegram } from 'telegraf'

const runtimeMode = process.env.RUNTIME_TEST_MODE
if (runtimeMode?.startsWith('shutdown-')) {
  const originalTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback, delay, ...args) =>
    originalTimeout(callback, delay === 10000 ? 100 : delay, ...args)
}

Telegram.prototype.callApi = function (method, _payload, options) {
  void _payload
  if (method === 'getMe') {
    if (process.env.RUNTIME_TEST_MODE === 'failure') {
      return Promise.reject(new Error('provider-secret-token'))
    }
    if (process.env.RUNTIME_TEST_MODE === 'startup') {
      process.send?.('startup')
      return new Promise(() => setInterval(() => {}, 1000))
    }
    return Promise.resolve({
      id: 1,
      is_bot: true,
      username: 'test_bot',
      first_name: 'Test'
    })
  }
  if (method === 'deleteWebhook') return Promise.resolve(true)
  if (method === 'getUpdates' && options?.signal) {
    process.send?.(
      runtimeMode?.startsWith('shutdown-') ? runtimeMode : 'polling'
    )
    return new Promise((_resolve, reject) => {
      const keepAlive = setInterval(() => {}, 1000)
      options.signal.addEventListener(
        'abort',
        () => {
          if (runtimeMode?.startsWith('shutdown-')) {
            if (runtimeMode === 'shutdown-failure') process.exitCode = 1
            process.send?.('stopping')
            return
          }
          clearInterval(keepAlive)
          const error = new Error('Stopped')
          error.name = 'AbortError'
          reject(error)
        },
        { once: true }
      )
    })
  }
  if (method === 'getUpdates') return Promise.resolve([])
  throw new Error(`Unexpected test transport call: ${method}`)
}
