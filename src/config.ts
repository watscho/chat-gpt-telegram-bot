export interface Config {
  statePath: string
  maxThreads: number
  maxMemories: number
  maxMemoryCharacters: number
  maxDocumentBytes: number
  maxSpeechCharacters: number
  maxSpeechBytes: number
  speechModel: string
  speechVoice: string
  ffmpegPath: string
  maxWebSearchCalls: number
  telegramToken: string
  openaiKey: string
  chatModel: string
  transcriptionModel: string
  imageModel: string
  imageQuality: 'low' | 'medium' | 'high' | 'auto'
  imageSize: 'auto' | '1024x1024' | '1536x1024' | '1024x1536'
  imageTimeoutMs: number
  maxImageBytes: number
  maxHistoryImageBytes: number
  maxTotalImageBytes: number
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
  const choice = <T extends string>(
    key: string,
    values: readonly T[],
    fallback: T
  ): T => {
    const value = env[key]?.trim() ?? fallback
    if (!values.includes(value as T))
      throw new ConfigurationError(`Invalid configuration: ${key}`)
    return value as T
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
    statePath: env.STATE_DB_PATH?.trim() || './data/bot.sqlite',
    maxThreads: integer('MAX_THREADS', 20, 100),
    maxMemories: integer('MAX_MEMORIES', 20, 100),
    maxMemoryCharacters: integer('MAX_MEMORY_CHARACTERS', 4000, 16000),
    maxDocumentBytes: integer('MAX_DOCUMENT_BYTES', 10000000, 20000000),
    maxSpeechCharacters: integer('MAX_SPEECH_CHARACTERS', 3000, 4000),
    maxSpeechBytes: integer('MAX_SPEECH_BYTES', 10000000, 20000000),
    speechModel: env.OPENAI_SPEECH_MODEL?.trim() || 'gpt-realtime-2.1-mini',
    speechVoice: choice(
      'OPENAI_SPEECH_VOICE',
      [
        'alloy',
        'ash',
        'ballad',
        'coral',
        'echo',
        'sage',
        'shimmer',
        'verse',
        'marin',
        'cedar'
      ],
      'marin'
    ),
    ffmpegPath: env.FFMPEG_PATH?.trim() || 'ffmpeg',
    maxWebSearchCalls: integer('MAX_WEB_SEARCH_CALLS', 3, 10),
    telegramToken: required('TELEGRAM_API_KEY'),
    openaiKey: required('OPENAI_API_KEY'),
    chatModel: required('OPENAI_CHAT_MODEL'),
    transcriptionModel:
      env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-mini-transcribe',
    imageModel: env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2.5-sunburst',
    imageQuality: choice(
      'OPENAI_IMAGE_QUALITY',
      ['low', 'medium', 'high', 'auto'],
      'high'
    ),
    imageSize: choice(
      'OPENAI_IMAGE_SIZE',
      ['auto', '1024x1024', '1536x1024', '1024x1536'],
      'auto'
    ),
    imageTimeoutMs: integer('IMAGE_TIMEOUT_MS', 300000, 900000),
    maxImageBytes: integer('MAX_IMAGE_BYTES', 10000000, 20000000),
    maxHistoryImageBytes: integer(
      'MAX_HISTORY_IMAGE_BYTES',
      20000000,
      100000000
    ),
    maxTotalImageBytes: integer('MAX_TOTAL_IMAGE_BYTES', 64000000, 500000000),
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
