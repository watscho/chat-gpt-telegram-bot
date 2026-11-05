import { workspacePage, workspaceStyles } from '../web/workspace-page.js'
import type { WorkspaceView } from '../application/studio-workspace.js'
import type { Document } from '../domain/conversation.js'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server
} from 'node:http'
import { readFileSync } from 'node:fs'
import type { Config } from '../config.js'
import { UserError } from '../domain/conversation.js'
import { miniAppOwner } from './miniapp-auth.js'
import { voicePage, voiceStyles } from '../web/voice-page.js'

export interface LiveBackend {
  workspace?(owner: string, missionId?: string): WorkspaceView
  workspaceAction?(owner: string, body: Record<string, unknown>): WorkspaceView
  workspaceFile?(
    owner: string,
    missionId: string,
    version: string,
    name: string
  ): Document
  liveStatus(owner: string): {
    enabled: boolean
    seconds: number
    estimate: number
    project: string | null
  }
  openLive(
    owner: string,
    offer: string,
    mode: string
  ): Promise<{ id: string; sdp: string; expiresAt: number }>
  closeLive(owner: string, id: string): Promise<void>
}
export class MiniAppServer {
  private stopping: Promise<void> | undefined
  private readonly server: Server
  private readonly origin: string
  private readonly base: string
  private readonly scripts: Record<string, string>
  constructor(
    private readonly config: Config,
    private readonly backend: LiveBackend
  ) {
    if (!config.workbench.miniAppURL)
      throw new Error('MINI_APP_URL is required for the voice server.')
    const url = new URL(config.workbench.miniAppURL)
    this.origin = url.origin
    this.base = url.pathname.replace(/\/$/, '')
    this.scripts = Object.fromEntries(
      ['voice-client.js', 'live-controller.js', 'workspace-client.js'].map(
        file => [
          `${this.base}/${file}`,
          readFileSync(
            new URL(`../../dist/web/${file}`, import.meta.url),
            'utf8'
          )
        ]
      )
    )
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        if (!response.headersSent) {
          response.writeHead(500, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
          })
          response.end(JSON.stringify({ error: 'Mini App service failed.' }))
        } else response.destroy()
      })
    })
    this.server.requestTimeout = 15000
    this.server.headersTimeout = 10000
  }
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.workbench.miniAppPort, '127.0.0.1', () => {
        this.server.removeListener('error', reject)
        resolve()
      })
    })
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopping = new Promise((resolve, reject) => {
      this.server.close(error => (error ? reject(error) : resolve()))
      this.server.closeIdleConnections()
    })
    return this.stopping
  }
  private send(
    response: ServerResponse,
    status: number,
    value: string | Uint8Array,
    type = 'application/json'
  ): void {
    response.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store'
    })
    response.end(value)
  }
  async handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader(
      'Permissions-Policy',
      'microphone=(self), camera=(), geolocation=()'
    )
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; base-uri 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org; form-action 'none'"
    )
    const path = (request.url ?? '').split('?')[0]!
    if (
      request.method === 'GET' &&
      (path === this.base || path === `${this.base}/`)
    ) {
      this.send(
        response,
        200,
        voicePage(`${this.base}/`),
        'text/html; charset=utf-8'
      )
      return
    }
    if (
      request.method === 'GET' &&
      (path === `${this.base}/workspace` || path === `${this.base}/workspace/`)
    ) {
      this.send(
        response,
        200,
        workspacePage(`${this.base}/`),
        'text/html; charset=utf-8'
      )
      return
    }
    if (request.method === 'GET' && path === `${this.base}/workspace.css`) {
      this.send(response, 200, workspaceStyles, 'text/css; charset=utf-8')
      return
    }
    if (request.method === 'GET' && path === `${this.base}/style.css`) {
      this.send(response, 200, voiceStyles, 'text/css; charset=utf-8')
      return
    }
    if (request.method === 'GET' && Object.hasOwn(this.scripts, path)) {
      this.send(
        response,
        200,
        this.scripts[path]!,
        'text/javascript; charset=utf-8'
      )
      return
    }
    const status =
        path === `${this.base}/api/status` && request.method === 'GET',
      offer = path === `${this.base}/api/offer` && request.method === 'POST',
      close = path === `${this.base}/api/close` && request.method === 'POST',
      workspace =
        path === `${this.base}/api/workspace` && request.method === 'GET',
      workspaceFile =
        path === `${this.base}/api/workspace/file` && request.method === 'GET',
      workspaceAction =
        path === `${this.base}/api/workspace/action` &&
        request.method === 'POST'
    if (
      !status &&
      !offer &&
      !close &&
      !workspace &&
      !workspaceFile &&
      !workspaceAction
    ) {
      this.send(response, 404, JSON.stringify({ error: 'Not found.' }))
      return
    }
    if (request.headers.origin && request.headers.origin !== this.origin) {
      this.send(response, 403, JSON.stringify({ error: 'Origin not allowed.' }))
      return
    }
    try {
      const header = request.headers['x-telegram-init-data']
      if (typeof header !== 'string')
        throw new UserError('Telegram authorization is required.')
      const owner = miniAppOwner(
        header,
        this.config.telegramToken,
        this.config.allowedUsers,
        Date.now(),
        close ? this.config.workbench.liveSeconds + 300 : 300
      )
      if (workspace) {
        if (!this.backend.workspace)
          throw new UserError('Workspace is not configured.')
        const mission =
          new URL(request.url!, 'http://workspace.invalid').searchParams.get(
            'mission'
          ) ?? undefined
        if (mission && mission.length > 120)
          throw new UserError('Invalid mission ID.')
        this.send(
          response,
          200,
          JSON.stringify(this.backend.workspace(owner, mission))
        )
        return
      }
      if (workspaceFile) {
        if (!this.backend.workspaceFile)
          throw new UserError('Workspace file access is not configured.')
        const query = new URL(request.url!, 'http://workspace.invalid')
            .searchParams,
          mission = query.get('mission'),
          version = query.get('version'),
          name = query.get('name')
        if (
          !mission ||
          !version ||
          !name ||
          mission.length > 120 ||
          version.length > 120 ||
          name.length > 200
        )
          throw new UserError('Invalid result file request.')
        const file = this.backend.workspaceFile(owner, mission, version, name)
        response.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`
        )
        this.send(response, 200, Buffer.from(file.data, 'base64'), file.mime)
        return
      }
      if (status) {
        this.send(response, 200, JSON.stringify(this.backend.liveStatus(owner)))
        return
      }
      if (!request.headers['content-type']?.startsWith('application/json'))
        throw new UserError('Use a JSON request.')
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk as Uint8Array)
        length += bytes.length
        if (length > 120000)
          throw new UserError('Mini App request exceeds the size limit.')
        chunks.push(bytes)
      }
      let value: unknown
      try {
        value = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks)
          )
        )
      } catch {
        throw new UserError('Invalid Mini App request JSON.')
      }
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new UserError('Invalid Mini App request.')
      const body = value as Record<string, unknown>
      if (workspaceAction) {
        if (!this.backend.workspaceAction)
          throw new UserError('Workspace actions are not configured.')
        this.send(
          response,
          200,
          JSON.stringify(this.backend.workspaceAction(owner, body))
        )
        return
      }
      if (offer) {
        if (
          typeof body.sdp !== 'string' ||
          typeof body.mode !== 'string' ||
          Object.keys(body).some(key => !['sdp', 'mode'].includes(key))
        )
          throw new UserError('Invalid voice offer fields.')
        const result = await this.backend.openLive(owner, body.sdp, body.mode)
        this.send(response, 200, JSON.stringify(result))
        return
      }
      if (
        typeof body.id !== 'string' ||
        body.id.length > 180 ||
        Object.keys(body).length !== 1
      )
        throw new UserError('Invalid voice session ID.')
      await this.backend.closeLive(owner, body.id)
      this.send(response, 200, JSON.stringify({ closed: true }))
    } catch (error) {
      this.send(
        response,
        error instanceof UserError ? 400 : 502,
        JSON.stringify({
          error:
            error instanceof UserError
              ? error.message
              : 'Mini App request failed. Reopen from Telegram or ask the operator to check setup.'
        })
      )
    }
  }
}
