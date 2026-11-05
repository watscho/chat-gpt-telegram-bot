import { oauthResponse } from '../infrastructure/oauth-response.js'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from 'node:crypto'
import type { Config } from '../config.js'
import type { StateStore } from '../domain/state.js'
import type { Connection } from '../domain/workbench.js'
import { UserError } from '../domain/conversation.js'
export interface ConnectionAuth {
  exchange: string | null
  revision: number
  disabled: string[]
  grants: Record<string, { cipher: string; expiresAt: number }>
  pending: {
    state: string
    verifier: string
    connection: string
    expiresAt: number
  } | null
}
export class ConnectionCenter {
  private readonly local = new Map<string, ConnectionAuth>()
  constructor(
    private readonly config: Config,
    private readonly store?: StateStore,
    private readonly request: typeof fetch = fetch,
    private readonly now = Date.now
  ) {}
  private get(owner: string): ConnectionAuth {
    return structuredClone(
      this.store?.getRecord<ConnectionAuth>('connection-auth', owner) ??
        this.local.get(owner) ?? {
          exchange: null,
          revision: 0,
          disabled: [],
          grants: {},
          pending: null
        }
    )
  }
  private save(owner: string, state: ConnectionAuth): void {
    state.revision++
    this.store?.putRecord('connection-auth', owner, state)
    if (!this.store) this.local.set(owner, structuredClone(state))
  }
  private configured(owner: string, id: string): Connection {
    const parts = owner.split(':')
    if (
      parts.length !== 2 ||
      parts[0] !== parts[1] ||
      !this.config.allowedUsers.has(Number(parts[0]))
    )
      throw new UserError(
        'Connection access requires an allowlisted private owner.'
      )
    const item = this.config.workbench.connections.find(
      item => item.owner === Number(owner.split(':')[0]) && item.id === id
    )
    if (!item)
      throw new UserError('Connection is not configured for this owner.')
    return item
  }
  private crypt(
    owner: string,
    id: string,
    value: string,
    decode = false
  ): string {
    const key = createHash('sha256')
        .update('telegram-connection-v1:' + this.config.telegramToken)
        .digest(),
      aad = Buffer.from(owner + ':' + id)
    if (decode) {
      const bytes = Buffer.from(value, 'base64')
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAAD(aad)
      cipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final()
      ]).toString('utf8')
    }
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(aad)
    const result = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), result]).toString('base64')
  }
  list(owner: string) {
    const state = this.get(owner)
    return this.config.workbench.connections
      .filter(item => item.owner === Number(owner.split(':')[0]))
      .map(item => ({
        id: item.id,
        title: item.title,
        server: item.server,
        tools: item.tools,
        authentication: item.oauth ? 'oauth' : 'operator credential',
        enabled: !state.disabled.includes(item.id),
        authorized:
          !item.oauth ||
          (!!state.grants[item.id] &&
            state.grants[item.id]!.expiresAt > this.now()),
        expiresAt: state.grants[item.id]?.expiresAt ?? null
      }))
  }
  resolve(owner: string, id: string): Connection {
    const item = this.configured(owner, id),
      state = this.get(owner)
    if (state.disabled.includes(id))
      throw new UserError(
        'Connection is disconnected. Enable it explicitly in Connections.'
      )
    if (!item.oauth) return { ...item, permissionRevision: state.revision }
    const grant = state.grants[id]
    if (!grant || grant.expiresAt <= this.now())
      throw new UserError(
        'Authorize this connection in the Connections center.'
      )
    let token: string
    try {
      token = this.crypt(owner, id, grant.cipher, true)
    } catch {
      throw new UserError(
        'Connection credentials changed. Reauthorize the service.'
      )
    }
    return { ...item, authorization: token, permissionRevision: state.revision }
  }
  enable(owner: string, id: string): void {
    this.configured(owner, id)
    const state = this.get(owner)
    state.disabled = state.disabled.filter(item => item !== id)
    this.save(owner, state)
  }
  disconnect(owner: string, id: string): void {
    this.configured(owner, id)
    const state = this.get(owner)
    state.disabled = [...new Set([...state.disabled, id])]
    state.exchange = null
    delete state.grants[id]
    if (state.pending?.connection === id) state.pending = null
    this.save(owner, state)
  }
  begin(owner: string, id: string): string {
    const item = this.configured(owner, id)
    if (
      !item.oauth ||
      !this.config.workbench.miniAppURL ||
      !this.store ||
      this.config.statePath === ':memory:'
    )
      throw new UserError(
        'OAuth requires a configured provider, public Mini App and persistent private state.'
      )
    const state = this.get(owner),
      nonce = randomBytes(24).toString('base64url'),
      verifier = randomBytes(32).toString('base64url'),
      url = new URL(item.oauth.authorizationURL)
    state.pending = {
      state: nonce,
      verifier,
      connection: id,
      expiresAt: this.now() + 600000
    }
    this.save(owner, state)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', item.oauth.clientID)
    url.searchParams.set('redirect_uri', this.redirect())
    url.searchParams.set('scope', item.oauth.scopes.join(' '))
    url.searchParams.set('state', nonce)
    url.searchParams.set(
      'code_challenge',
      createHash('sha256').update(verifier).digest('base64url')
    )
    url.searchParams.set('code_challenge_method', 'S256')
    return url.href
  }
  private redirect(): string {
    return (
      this.config.workbench.miniAppURL!.replace(/\/$/, '') + '/oauth/callback'
    )
  }
  async callback(query: URLSearchParams): Promise<void> {
    const nonce = query.get('state'),
      code = query.get('code')
    if (!nonce || !code || code.length > 4000 || query.has('error'))
      throw new UserError(
        'Authorization was not completed. Start again from Connections.'
      )
    const match = (
      this.store?.records<ConnectionAuth>('connection-auth') ?? []
    ).find(([, value]) => value.pending?.state === nonce)
    if (!match)
      throw new UserError('Authorization expired or was already used.')
    const [owner, state] = match,
      pending = state.pending!
    if (pending.expiresAt <= this.now())
      throw new UserError('Authorization expired.')
    const item = this.configured(owner, pending.connection),
      oauth = item.oauth!
    state.pending = null
    state.exchange = nonce
    this.save(owner, state)
    const revision = state.revision,
      body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: oauth.clientID,
        redirect_uri: this.redirect(),
        code_verifier: pending.verifier,
        ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {})
      })
    const response = await this.request(oauth.tokenURL, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10000)
    })
    const raw = await oauthResponse(response)
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new UserError('Service returned invalid authorization data.')
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !('access_token' in value) ||
      typeof value.access_token !== 'string' ||
      !value.access_token ||
      value.access_token.length > 8000 ||
      /[\r\n]/.test(value.access_token) ||
      !('expires_in' in value) ||
      typeof value.expires_in !== 'number' ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in <= 0 ||
      value.expires_in > 31536000
    )
      throw new UserError('Service returned unsupported token fields.')
    const current = this.get(owner)
    if (current.revision !== revision || current.exchange !== nonce)
      throw new UserError('Connection changed while authorization was pending.')
    current.exchange = null
    current.grants[item.id] = {
      cipher: this.crypt(owner, item.id, value.access_token),
      expiresAt: this.now() + value.expires_in * 1000
    }
    current.disabled = current.disabled.filter(id => id !== item.id)
    this.save(owner, current)
  }
  erase(owner: string): void {
    this.store?.deleteRecord('connection-auth', owner)
    this.local.delete(owner)
  }
}
