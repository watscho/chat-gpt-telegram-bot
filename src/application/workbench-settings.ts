import type { Connection, WorkbenchConfig } from '../domain/workbench.js'

export function workbenchSettings(
  env: NodeJS.ProcessEnv,
  integer: (key: string, fallback: number, max: number) => number
): WorkbenchConfig {
  const miniAppURL = env.MINI_APP_URL?.trim() || null
  if (miniAppURL) {
    const url = new URL(miniAppURL)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid configuration: MINI_APP_URL')
  }
  const raw: unknown = JSON.parse(env.OPENAI_MCP_CONNECTIONS?.trim() || '[]')
  if (!Array.isArray(raw) || raw.length > 20)
    throw new Error('Invalid configuration: OPENAI_MCP_CONNECTIONS')
  const names = new Set<string>()
  const connections: Connection[] = raw.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Invalid connection')
    const entry = item as Record<string, unknown>
    if (
      typeof entry.id !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,23}$/.test(entry.id) ||
      !Number.isSafeInteger(entry.owner) ||
      Number(entry.owner) < 1 ||
      typeof entry.title !== 'string' ||
      !entry.title.trim() ||
      entry.title.length > 80 ||
      typeof entry.server !== 'string' ||
      typeof entry.authorization !== 'string' ||
      !entry.authorization ||
      entry.authorization.length > 8000 ||
      /[\r\n]/.test(entry.authorization) ||
      !Array.isArray(entry.tools) ||
      !entry.tools.length ||
      entry.tools.length > 20 ||
      entry.tools.some(
        (tool: unknown) =>
          typeof tool !== 'string' ||
          !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(tool)
      )
    )
      throw new Error('Invalid connection')
    const url = new URL(entry.server)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      url.port ||
      !url.hostname.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname) ||
      /^\[|^[\d.]+$/.test(url.hostname)
    )
      throw new Error('Invalid connection server')
    const key = `${Number(entry.owner)}:${entry.id}`
    if (names.has(key)) throw new Error('Duplicate connection')
    names.add(key)
    return {
      id: entry.id,
      owner: Number(entry.owner),
      title: entry.title,
      server: url.href,
      authorization: entry.authorization,
      tools: [...new Set(entry.tools as string[])]
    }
  })
  return {
    analysisModel: env.OPENAI_ANALYSIS_MODEL?.trim() || 'gpt-6-astra',
    meetingModel: env.OPENAI_MEETING_MODEL?.trim() || 'gpt-transcribe',
    diarizationModel: env.OPENAI_DIARIZATION_MODEL?.trim() || null,
    liveModel: env.OPENAI_LIVE_MODEL?.trim() || 'gpt-realtime-2.1-mini',
    miniAppURL,
    miniAppPort: integer('MINI_APP_PORT', 8787, 65535),
    liveSeconds: integer('LIVE_MAX_SECONDS', 180, 600),
    connections,
    meetingBytes: integer('MAX_MEETING_BYTES', 20000000, 20000000),
    meetingSeconds: integer('MAX_MEETING_SECONDS', 1800, 7200),
    estimateAnalysis: integer(
      'ESTIMATE_ANALYSIS_MICRO_USD',
      1000000,
      100000000
    ),
    estimateIndex: integer('ESTIMATE_INDEX_MICRO_USD', 100000, 10000000),
    estimateConnection: integer(
      'ESTIMATE_CONNECTION_MICRO_USD',
      100000,
      10000000
    ),
    estimateLiveMinute: integer(
      'ESTIMATE_LIVE_MINUTE_MICRO_USD',
      500000,
      10000000
    ),
    estimateMeetingMinute: integer(
      'ESTIMATE_MEETING_MINUTE_MICRO_USD',
      100000,
      10000000
    )
  }
}
