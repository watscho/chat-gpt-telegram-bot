import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHmac } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from '../../__tests__/helpers.js'
import { UserError } from '../../domain/conversation.js'
let handler: (request: IncomingMessage, response: ServerResponse) => void
let listenError = false,
  closeError = false
class Server extends EventEmitter {
  requestTimeout = 0
  headersTimeout = 0
  listen(_port: number, _host: string, callback: () => void) {
    if (listenError) this.emit('error', new Error('listen'))
    else callback()
  }
  close(callback: (error?: Error) => void) {
    callback(closeError ? new Error('close') : undefined)
  }
  closeIdleConnections() {}
}
mock.module('node:http', {
  namedExports: {
    createServer: (callback: typeof handler) => {
      handler = callback
      return new Server()
    }
  }
})
mock.module('node:fs', {
  namedExports: { readFileSync: () => 'compiled script' }
})
const { MiniAppServer } = await import('../miniapp-server.js')
function signed(token: string) {
  const q = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 42 })
  })
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  q.set(
    'hash',
    createHmac('sha256', secret)
      .update(
        [...q]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
      )
      .digest('hex')
  )
  return q.toString()
}
class Response {
  status = 0
  body = ''
  headersSent = false
  destroyed = false
  headers: Record<string, string> = {}
  setHeader(key: string, value: string) {
    this.headers[key] = value
  }
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status
    Object.assign(this.headers, headers)
    this.headersSent = true
  }
  end(body: string) {
    this.body = body
  }
  destroy() {
    this.destroyed = true
  }
}
void test('Mini App HTTP routing authenticates owners and bounds requests without opening a socket', async () => {
  const settings = config()
  assert.throws(() => new MiniAppServer(settings, {} as never), /MINI_APP_URL/)
  settings.workbench.miniAppURL = 'https://voice.example.com/voice/'
  let fail: Error | undefined,
    closed = ''
  const backend = {
    liveStatus: (owner: string) => {
      assert.equal(owner, '42:42')
      return { enabled: true, seconds: 60, estimate: 100, project: null }
    },
    openLive: (owner: string, sdp: string, mode: string) => {
      assert.equal(owner, '42:42')
      assert.equal(sdp, 'v=0')
      assert.equal(mode, 'language')
      if (fail) return Promise.reject(fail)
      return Promise.resolve({ id: 'rtc1', sdp: 'v=0', expiresAt: 200 })
    },
    closeLive: (_owner: string, id: string) => {
      closed = id
      return Promise.resolve()
    }
  }
  const server = new MiniAppServer(settings, backend)
  await server.start()
  const request = async (
    path?: string,
    method = 'GET',
    body: unknown = undefined,
    headers: Record<string, string | string[]> = {},
    raw?: Buffer
  ) => {
    const response = new Response()
    const req = {
      url: path,
      method,
      headers: {
        'x-telegram-init-data': signed(settings.telegramToken),
        'content-type': 'application/json',
        ...headers
      },
      async *[Symbol.asyncIterator]() {
        if (raw) yield await Promise.resolve(raw)
        else if (body !== undefined) yield Buffer.from(JSON.stringify(body))
      }
    }
    await server.handle(
      req as unknown as IncomingMessage,
      response as unknown as ServerResponse
    )
    return response
  }
  for (const path of [
    '/voice',
    '/voice/',
    '/voice/style.css',
    '/voice/voice-client.js',
    '/voice/live-controller.js'
  ]) {
    const r = await request(path)
    assert.equal(r.status, 200)
    assert.match(r.headers['Content-Security-Policy']!, /default-src/)
  }
  assert.equal((await request()).status, 404)
  assert.equal((await request('/no')).status, 404)
  assert.equal((await request('/voice/api/status', 'POST')).status, 404)
  assert.equal(
    (
      await request('/voice/api/status', 'GET', undefined, {
        origin: 'https://wrong.example'
      })
    ).status,
    403
  )
  assert.equal(
    (
      await request('/voice/api/status', 'GET', undefined, {
        'x-telegram-init-data': []
      })
    ).status,
    400
  )
  assert.equal(
    (
      await request('/voice/api/status', 'GET', undefined, {
        'x-telegram-init-data': 'invalid'
      })
    ).status,
    400
  )
  assert.equal(
    (
      await request('/voice/api/status', 'GET', undefined, {
        origin: 'https://voice.example.com'
      })
    ).status,
    200
  )
  assert.equal(
    (
      await request('/voice/api/offer', 'POST', {
        sdp: 'v=0',
        mode: 'language'
      })
    ).status,
    200
  )
  for (const body of [
    null,
    [],
    true,
    { sdp: 1, mode: 'language' },
    { sdp: 'v=0', mode: 1 },
    { sdp: 'v=0', mode: 'language', owner: '99' }
  ])
    assert.equal((await request('/voice/api/offer', 'POST', body)).status, 400)
  for (const raw of [
    Buffer.from('{'),
    Buffer.from([255]),
    Buffer.alloc(120001)
  ])
    assert.equal(
      (await request('/voice/api/offer', 'POST', undefined, {}, raw)).status,
      400
    )
  assert.equal(
    (
      await request(
        '/voice/api/offer',
        'POST',
        {},
        { 'content-type': 'text/plain' }
      )
    ).status,
    400
  )
  for (const body of [
    { id: 1 },
    { id: 'a'.repeat(181) },
    { id: 'x', owner: '99' }
  ])
    assert.equal((await request('/voice/api/close', 'POST', body)).status, 400)
  assert.equal(
    (await request('/voice/api/close', 'POST', { id: 'rtc1' })).status,
    200
  )
  assert.equal(closed, 'rtc1')
  fail = new UserError('Quota')
  assert.equal(
    (
      await request('/voice/api/offer', 'POST', {
        sdp: 'v=0',
        mode: 'language'
      })
    ).status,
    400
  )
  fail = new Error('secret')
  const failed = await request('/voice/api/offer', 'POST', {
    sdp: 'v=0',
    mode: 'language'
  })
  assert.equal(failed.status, 502)
  assert.ok(!failed.body.includes('secret'))
  for (const headersSent of [false, true]) {
    const response = new Response()
    response.headersSent = headersSent
    response.setHeader = () => {
      throw new Error('transport')
    }
    handler({} as IncomingMessage, response as unknown as ServerResponse)
    await new Promise(resolve => setImmediate(resolve))
    if (headersSent) assert.equal(response.destroyed, true)
    else assert.equal(response.status, 500)
  }
  await server.stop()
  await server.stop()
  listenError = true
  await assert.rejects(new MiniAppServer(settings, backend).start())
  listenError = false
  closeError = true
  await assert.rejects(new MiniAppServer(settings, backend).stop())
  closeError = false
})
