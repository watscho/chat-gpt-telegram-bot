import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deskSetup, owner } from '../../__tests__/desk.js'
import { ConnectionCenter } from '../connection-center.js'
import { config } from '../../__tests__/helpers.js'
import { loadConfig } from '../../config.js'
void test('connection center exposes permissions without credentials and enforces local disconnection for every resolver', () => {
  const s = deskSetup()
  assert.equal(s.center.resolve(owner, 'mail').authorization, 'private-token')
  assert.equal(
    JSON.stringify(s.center.list(owner)).includes('private-token'),
    false
  )
  s.center.disconnect(owner, 'mail')
  assert.equal(s.center.list(owner)[0]!.enabled, false)
  assert.throws(() => s.center.resolve(owner, 'mail'))
  s.center.enable(owner, 'mail')
  assert.equal(s.center.resolve(owner, 'mail').id, 'mail')
  assert.throws(() => s.center.resolve('43:43', 'mail'))
  assert.deepEqual(s.center.list('43:43'), [])
  const local = new ConnectionCenter(s.settings)
  local.disconnect(owner, 'mail')
  assert.throws(() => local.resolve(owner, 'mail'))
  local.erase(owner)
  assert.equal(local.resolve(owner, 'mail').id, 'mail')
  s.center.erase(owner)
  assert.throws(() => s.center.begin(owner, 'mail'))
  s.oauth()
  assert.throws(() => local.begin(owner, 'mail'))
  s.settings.statePath = ':memory:'
  assert.throws(() => s.center.begin(owner, 'mail'))
  s.settings.statePath = '/unit/state'
  s.settings.workbench.miniAppURL = null
  assert.throws(() => s.center.begin(owner, 'mail'))
})
void test('OAuth authorization binds owner and connection, consumes PKCE state once, seals tokens and never exposes them through status', async () => {
  const s = deskSetup(),
    provider = s.oauth()
  provider.oauth!.clientSecret = 'unit-secret'
  assert.equal(s.center.list(owner)[0]!.authorized, false)
  assert.throws(() => s.center.resolve(owner, 'mail'))
  const url = new URL(s.center.begin(owner, 'mail'))
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://bot.example.com/voice/oauth/callback'
  )
  assert.ok(url.searchParams.get('code_challenge'))
  await s.center.callback(
    new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' })
  )
  assert.equal(
    s.center.resolve(owner, 'mail').authorization,
    'oauth-unit-token'
  )
  assert.equal(s.center.list(owner)[0]!.authorized, true)
  const stored = JSON.stringify(s.store.records('connection-auth'))
  assert.doesNotMatch(stored, /oauth-unit-token/)
  assert.match(
    (s.requests[0]!.options!.body as URLSearchParams).toString(),
    /code_verifier/
  )
  await assert.rejects(
    s.center.callback(
      new URLSearchParams({
        state: url.searchParams.get('state')!,
        code: 'again'
      })
    )
  )
  s.settings.telegramToken = 'rotated-key'
  assert.throws(() => s.center.resolve(owner, 'mail'), /Reauthorize/)
  s.center.disconnect(owner, 'mail')
  assert.throws(() => s.center.resolve(owner, 'mail'))
  s.center.enable(owner, 'mail')
  assert.throws(() => s.center.resolve(owner, 'mail'))
})
void test('OAuth rejects expired/replayed states, malformed responses and changed owner state without publishing a credential', async () => {
  const s = deskSetup()
  s.oauth()
  for (const query of [
    {},
    { state: 'x' },
    { state: 'x', code: 'x', error: 'denied' },
    { state: 'x', code: 'x'.repeat(4001) },
    { state: 'wrong', code: 'x' }
  ])
    await assert.rejects(s.center.callback(new URLSearchParams(query)))
  let url = new URL(s.center.begin(owner, 'mail'))
  s.time(s.now() + 600001)
  await assert.rejects(
    s.center.callback(
      new URLSearchParams({
        state: url.searchParams.get('state')!,
        code: 'code'
      })
    )
  )
  for (const [value, ok, raw] of [
    [{}, false, null],
    [{}, true, 'bad'],
    [{}, true, 'x'.repeat(50001)],
    [null, true, null],
    [{}, true, null],
    [{ access_token: 1, expires_in: 1 }, true, null],
    [{ access_token: '', expires_in: 1 }, true, null],
    [{ access_token: 'x'.repeat(8001), expires_in: 1 }, true, null],
    [{ access_token: 'x\ny', expires_in: 1 }, true, null],
    [{ access_token: 'x' }, true, null],
    [{ access_token: 'x', expires_in: 'x' }, true, null],
    [{ access_token: 'x', expires_in: 0 }, true, null],
    [{ access_token: 'x', expires_in: 31536001 }, true, null]
  ] as [unknown, boolean, string | null][]) {
    s.setOAuth(value, ok, raw)
    url = new URL(s.center.begin(owner, 'mail'))
    await assert.rejects(
      s.center.callback(
        new URLSearchParams({
          state: url.searchParams.get('state')!,
          code: 'code'
        })
      )
    )
    assert.equal(s.center.list(owner)[0]!.authorized, false)
  }
  s.setOAuth({ access_token: 'short-lived', expires_in: 1 })
  url = new URL(s.center.begin(owner, 'mail'))
  await s.center.callback(
    new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' })
  )
  s.time(s.now() + 1001)
  assert.throws(() => s.center.resolve(owner, 'mail'))
  const center = new ConnectionCenter(
    s.settings,
    s.store,
    () => {
      s.center.erase(owner)
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'late', expires_in: 3600 }))
      )
    },
    s.now
  )
  url = new URL(center.begin(owner, 'mail'))
  await assert.rejects(
    center.callback(
      new URLSearchParams({
        state: url.searchParams.get('state')!,
        code: 'code'
      })
    ),
    /changed/
  )
  assert.equal(s.store.records('connection-auth').length, 0)
})
void test('OAuth configuration validates trusted fixed endpoints, scopes and client fields without issuing network requests', () => {
  const settings = config(),
    entry = {
      id: 'mail',
      owner: 42,
      title: 'Mail',
      server: 'https://mcp.example.com',
      authorization: '',
      tools: ['read'],
      oauth: {
        authorizationURL: 'https://auth.example.com/authorize',
        tokenURL: 'https://auth.example.com/token',
        clientID: 'client',
        scopes: ['read']
      }
    }
  const env = {
    TELEGRAM_API_KEY: settings.telegramToken,
    OPENAI_API_KEY: 'unit',
    ALLOWED_TELEGRAM_USER_IDS: '42',
    OPENAI_MCP_CONNECTIONS: JSON.stringify([entry])
  }
  assert.equal(
    loadConfig(env).workbench.connections[0]!.oauth!.clientID,
    'client'
  )
  for (const change of [
    { oauth: null },
    { oauth: {} },
    { oauth: { ...entry.oauth, clientID: '' } },
    { oauth: { ...entry.oauth, clientID: 'x'.repeat(201) } },
    { oauth: { ...entry.oauth, scopes: 'x' } },
    {
      oauth: {
        ...entry.oauth,
        scopes: Array.from({ length: 21 }, () => 'read')
      }
    },
    { oauth: { ...entry.oauth, scopes: [1] } },
    { oauth: { ...entry.oauth, scopes: [''] } },
    { oauth: { ...entry.oauth, scopes: ['x'.repeat(201)] } },
    { oauth: { ...entry.oauth, clientSecret: 1 } },
    { oauth: { ...entry.oauth, clientSecret: 'x'.repeat(4001) } }
  ])
    assert.throws(() =>
      loadConfig({
        ...env,
        OPENAI_MCP_CONNECTIONS: JSON.stringify([{ ...entry, ...change }])
      })
    )
  for (const address of [
    'http://auth.example.com',
    'https://u:p@auth.example.com',
    'https://auth.example.com/#x',
    'https://auth.example.com/?x=1',
    'https://auth.example.com:8443',
    'https://localhost',
    'https://127.0.0.1'
  ])
    assert.throws(() =>
      loadConfig({
        ...env,
        OPENAI_MCP_CONNECTIONS: JSON.stringify([
          { ...entry, oauth: { ...entry.oauth, tokenURL: address } }
        ])
      })
    )
  assert.equal(
    loadConfig({
      ...env,
      OPENAI_MCP_CONNECTIONS: JSON.stringify([
        { ...entry, oauth: { ...entry.oauth, clientSecret: 'secret' } }
      ])
    }).workbench.connections[0]!.oauth!.clientSecret,
    'secret'
  )
})
void test('disconnect invalidates an in-flight authorization and re-enablement changes continuation permissions', async () => {
  const s = deskSetup()
  s.oauth()
  const initial = s.center.resolve.bind(s.center)
  assert.throws(() => initial(owner, 'mail'))
  let url = new URL(s.center.begin(owner, 'mail'))
  s.center.disconnect(owner, 'mail')
  await assert.rejects(
    s.center.callback(
      new URLSearchParams({ state: url.searchParams.get('state')!, code: 'x' })
    )
  )
  s.center.enable(owner, 'mail')
  s.center.disconnect(owner, 'mail')
  url = new URL(s.center.begin(owner, 'mail'))
  await s.center.callback(
    new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code' })
  )
  assert.equal(s.center.list(owner)[0]!.enabled, true)
  const local = new ConnectionCenter(s.settings)
  await assert.rejects(
    local.callback(new URLSearchParams({ state: 'unknown', code: 'code' }))
  )
})
void test('OAuth rejects nonfinite token lifetime and pending state changes without restoring an old grant', async () => {
  const s = deskSetup()
  s.oauth()
  s.setOAuth({}, true, '{"access_token":"x","expires_in":1e999}')
  const url = new URL(s.center.begin(owner, 'mail'))
  await assert.rejects(
    s.center.callback(
      new URLSearchParams({
        state: url.searchParams.get('state')!,
        code: 'code'
      })
    )
  )
})
void test('connection mutation rejects malformed and unallowlisted owner keys', () => {
  const s = deskSetup()
  for (const id of ['42:43', '42:42:1', '99:99'])
    assert.throws(() => s.center.enable(id, 'mail'))
})
