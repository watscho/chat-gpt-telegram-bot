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

import { studioSetup, studioFile } from '../../__tests__/studio.js'
void test('workspace endpoints share Telegram authentication and expose only owner-scoped snapshots, strict actions and attachment downloads', async () => {
  const s = studioSetup(),
    mission = await s.finish(s.plan()),
    settings = s.settings
  settings.workbench.miniAppURL = 'https://voice.example.com/voice'
  const backend = {
    liveStatus: () => ({
      enabled: true,
      seconds: 60,
      estimate: 1,
      project: null
    }),
    openLive: () => Promise.resolve({ id: 'rtc1', sdp: 'v=0', expiresAt: 1 }),
    closeLive: () => Promise.resolve(),
    workspace: s.view.snapshot.bind(s.view),
    workspaceAction: s.view.action.bind(s.view),
    workspaceFile: s.view.file.bind(s.view)
  }
  const server = new MiniAppServer(settings, backend)
  const request = async (
    path: string,
    method = 'GET',
    body?: Record<string, unknown>
  ) => {
    const response = new Response(),
      req = {
        url: path,
        method,
        headers: {
          'x-telegram-init-data': signed(settings.telegramToken),
          'content-type': 'application/json'
        },
        async *[Symbol.asyncIterator]() {
          if (body)
            yield await Promise.resolve(Buffer.from(JSON.stringify(body)))
        }
      }
    await server.handle(
      req as unknown as IncomingMessage,
      response as unknown as ServerResponse
    )
    return response
  }
  for (const path of [
    '/voice/workspace',
    '/voice/workspace/',
    '/voice/workspace.css',
    '/voice/workspace-client.js'
  ])
    assert.equal((await request(path)).status, 200)
  assert.equal((await request('/voice/api/workspace')).status, 200)
  const detail = await request(`/voice/api/workspace?mission=${mission.id}`)
  assert.equal(detail.status, 200)
  assert.match(detail.body, /Report based/)
  assert.ok(!detail.body.includes(studioFile.data))
  assert.equal(
    (await request('/voice/api/workspace?mission=' + 'x'.repeat(121))).status,
    400
  )
  assert.equal(
    (
      await request('/voice/api/workspace/action', 'POST', {
        action: 'inspect',
        id: mission.id
      })
    ).status,
    200
  )
  assert.equal(
    (
      await request('/voice/api/workspace/action', 'POST', {
        action: 'approve',
        id: mission.id,
        revision: mission.revision
      })
    ).status,
    400
  )
  const version = s.studio.result('42:42', mission.id),
    query = `/voice/api/workspace/file?mission=${mission.id}&version=${version.id}&name=${studioFile.name}`
  const file = await request(query)
  assert.equal(file.status, 200)
  assert.match(file.headers['Content-Disposition']!, /attachment/)
  assert.equal(
    Buffer.from(file.body).toString(),
    Buffer.from(studioFile.data, 'base64').toString()
  )
  for (const path of [
    '/voice/api/workspace/file',
    `/voice/api/workspace/file?mission=x&version=y`,
    '/voice/api/workspace/file?mission=' +
      'x'.repeat(121) +
      '&version=y&name=z',
    '/voice/api/workspace/file?mission=x&version=' +
      'x'.repeat(121) +
      '&name=z',
    '/voice/api/workspace/file?mission=x&version=y&name=' + 'x'.repeat(201)
  ])
    assert.equal((await request(path)).status, 400)
  const unsupported = new MiniAppServer(settings, {
    liveStatus: backend.liveStatus,
    openLive: backend.openLive,
    closeLive: backend.closeLive
  })
  for (const [path, method, body] of [
    ['/voice/api/workspace', 'GET', undefined],
    ['/voice/api/workspace/file', 'GET', undefined],
    ['/voice/api/workspace/action', 'POST', {}]
  ] as const) {
    const r = new Response(),
      req = {
        url: path,
        method,
        headers: {
          'x-telegram-init-data': signed(settings.telegramToken),
          'content-type': 'application/json'
        },
        async *[Symbol.asyncIterator]() {
          if (body) yield await Promise.resolve(Buffer.from('{}'))
        }
      }
    await unsupported.handle(
      req as unknown as IncomingMessage,
      r as unknown as ServerResponse
    )
    assert.equal(r.status, 400)
  }
})
