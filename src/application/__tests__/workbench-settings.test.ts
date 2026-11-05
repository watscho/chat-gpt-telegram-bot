import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workbenchSettings } from '../workbench-settings.js'
import { loadConfig, ConfigurationError } from '../../config.js'
const integer = (_key: string, fallback: number) => fallback
const connection = {
  id: 'mail',
  owner: 42,
  title: 'Mail',
  server: 'https://mcp.example.com/',
  authorization: 'private-test-token',
  tools: ['search', 'send']
}
void test('provider settings default to explicit current workflows and parse scoped MCP configuration without exposing secrets', () => {
  const defaults = workbenchSettings({}, integer)
  assert.equal(defaults.analysisModel, 'gpt-6-astra')
  assert.equal(defaults.diarizationModel, null)
  assert.equal(defaults.miniAppURL, null)
  const settings = workbenchSettings(
    {
      MINI_APP_URL: 'https://voice.example.com/voice',
      OPENAI_ANALYSIS_MODEL: 'custom',
      OPENAI_MEETING_MODEL: 'meeting',
      OPENAI_DIARIZATION_MODEL: 'speaker',
      OPENAI_LIVE_MODEL: 'live',
      OPENAI_MCP_CONNECTIONS: JSON.stringify([
        { ...connection, tools: ['search', 'search'] }
      ])
    },
    integer
  )
  assert.equal(settings.connections[0]!.tools.length, 1)
  assert.equal(settings.connections[0]!.owner, 42)
  assert.equal(settings.liveModel, 'live')
  assert.equal(settings.meetingModel, 'meeting')
  assert.equal(settings.diarizationModel, 'speaker')
  assert.equal(settings.analysisModel, 'custom')
})
void test('invalid Mini App URLs, connection metadata, duplicate IDs and tool scopes fail before startup', () => {
  for (const url of [
    'bad',
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/?q=1',
    'https://example.com/#hash'
  ])
    assert.throws(() => workbenchSettings({ MINI_APP_URL: url }, integer))
  for (const raw of [
    'bad',
    '{}',
    JSON.stringify(Array.from({ length: 21 }, () => connection))
  ])
    assert.throws(() =>
      workbenchSettings({ OPENAI_MCP_CONNECTIONS: raw }, integer)
    )
  for (const item of [
    null,
    [],
    1,
    { ...connection, id: 1 },
    { ...connection, id: 'Bad' },
    { ...connection, owner: 0 },
    { ...connection, owner: 1.5 },
    { ...connection, title: '' },
    { ...connection, title: 1 },
    { ...connection, title: 'x'.repeat(81) },
    { ...connection, server: 1 },
    { ...connection, authorization: 1 },
    { ...connection, authorization: '' },
    { ...connection, authorization: 'x'.repeat(8001) },
    { ...connection, authorization: 'secret\nunsafe' },
    { ...connection, tools: null },
    { ...connection, tools: [] },
    { ...connection, tools: Array(21).fill('search') },
    { ...connection, tools: [1] },
    { ...connection, tools: ['invalid tool'] }
  ])
    assert.throws(() =>
      workbenchSettings(
        { OPENAI_MCP_CONNECTIONS: JSON.stringify([item]) },
        integer
      )
    )
  for (const server of [
    'bad',
    'http://mcp.example.com',
    'https://user:pass@mcp.example.com',
    'https://mcp.example.com/#hash',
    'https://mcp.example.com/?q=1',
    'https://mcp.example.com:444',
    'https://localhost',
    'https://a.local',
    'https://127.0.0.1',
    'https://[::1]'
  ])
    assert.throws(() =>
      workbenchSettings(
        { OPENAI_MCP_CONNECTIONS: JSON.stringify([{ ...connection, server }]) },
        integer
      )
    )
  assert.throws(() =>
    workbenchSettings(
      { OPENAI_MCP_CONNECTIONS: JSON.stringify([connection, connection]) },
      integer
    )
  )
  assert.equal(
    workbenchSettings(
      {
        OPENAI_MCP_CONNECTIONS: JSON.stringify([
          connection,
          { ...connection, owner: 43 }
        ])
      },
      integer
    ).connections.length,
    2
  )
  assert.throws(
    () =>
      loadConfig({
        TELEGRAM_API_KEY: 'test',
        OPENAI_API_KEY: 'test',
        ALLOWED_TELEGRAM_USER_IDS: '42',
        OPENAI_MCP_CONNECTIONS: 'private-invalid-json'
      }),
    error =>
      error instanceof ConfigurationError &&
      !error.message.includes('private-invalid-json')
  )
})
