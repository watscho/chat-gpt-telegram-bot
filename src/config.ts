export interface Config {
  telegramToken: string
  openaiKey: string
  chatModel: string
  transcriptionModel: string
  allowedUsers: ReadonlySet<number>
  maxInputCharacters: number
  maxHistoryTurns: number
  maxHistoryCharacters: number
  sessionTtlMs: number
  maxSessions: number
  maxConcurrentRequests: number
  maxVoiceBytes: number
  maxVoiceSeconds: number
  maxOutputTokens: number
  requestTimeoutMs: number
}

export class ConfigurationError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (key: string): string => {
    const value = env[key]?.trim()
    if (!value)
      throw new ConfigurationError(`Missing required configuration: ${key}`)
    return value
  }
  const integer = (key: string, fallback: number, max: number): number => {
    const raw = env[key]?.trim()
    if (raw === undefined) return fallback
    if (!/^\d+$/.test(raw))
      throw new ConfigurationError(`Invalid configuration: ${key}`)
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      throw new ConfigurationError(`Invalid configuration: ${key}`)
    }
    return value
  }
  const ids = required('ALLOWED_TELEGRAM_USER_IDS')
    .split(',')
    .map(id => id.trim())
  if (
    ids.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
  ) {
    throw new ConfigurationError(
      'Invalid configuration: ALLOWED_TELEGRAM_USER_IDS'
    )
  }
  return {
    telegramToken: required('TELEGRAM_API_KEY'),
    openaiKey: required('OPENAI_API_KEY'),
    chatModel: required('OPENAI_CHAT_MODEL'),
    transcriptionModel:
      env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-mini-transcribe',
    allowedUsers: new Set(ids.map(Number)),
    maxInputCharacters: integer('MAX_INPUT_CHARACTERS', 8000, 32000),
    maxHistoryTurns: integer('MAX_HISTORY_TURNS', 20, 100),
    maxHistoryCharacters: integer('MAX_HISTORY_CHARACTERS', 60000, 200000),
    sessionTtlMs: integer('SESSION_TTL_SECONDS', 3600, 86400) * 1000,
    maxSessions: integer('MAX_SESSIONS', 1000, 10000),
    maxConcurrentRequests: integer('MAX_CONCURRENT_REQUESTS', 10, 100),
    maxVoiceBytes: integer('MAX_VOICE_BYTES', 10000000, 20000000),
    maxVoiceSeconds: integer('MAX_VOICE_SECONDS', 300, 1200),
    maxOutputTokens: integer('OPENAI_MAX_OUTPUT_TOKENS', 2000, 16000),
    requestTimeoutMs: integer('REQUEST_TIMEOUT_MS', 60000, 180000)
  }
}
