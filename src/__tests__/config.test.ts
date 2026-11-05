import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../config.js'

const env = {
  TELEGRAM_API_KEY: 'secret',
  OPENAI_API_KEY: 'secret',
  OPENAI_CHAT_MODEL: 'test',
  ALLOWED_TELEGRAM_USER_IDS: '42, 43'
}
void test('configuration parses defaults and allowlist without global mutation', () => {
  const config = loadConfig(env)
  assert.deepEqual([...config.allowedUsers], [42, 43])
  assert.equal(config.maxVoiceBytes, 10000000)
  assert.equal(config.requestTimeoutMs, 60000)
})
for (const key of [
  'TELEGRAM_API_KEY',
  'OPENAI_API_KEY',
  'ALLOWED_TELEGRAM_USER_IDS'
]) {
  void test(`configuration requires ${key} without leaking credentials`, () => {
    assert.throws(
      () => loadConfig({ ...env, [key]: '' }),
      error =>
        error instanceof Error &&
        error.message.includes(key) &&
        !error.message.includes('secret')
    )
  })
}
for (const value of ['0', '-1', '1.5', 'NaN', '', '99999999999999']) {
  void test(`configuration rejects invalid numeric limit: ${JSON.stringify(value)}`, () => {
    assert.throws(() => loadConfig({ ...env, MAX_VOICE_BYTES: value }))
  })
}
for (const ids of ['42,', '42,a', '-1', '1.5', '9007199254740992']) {
  void test(`configuration rejects invalid allowlist: ${ids}`, () =>
    assert.throws(() => loadConfig({ ...env, ALLOWED_TELEGRAM_USER_IDS: ids })))
}

void test('image settings default to high quality and reject invalid quality, sizes and limits', () => {
  const settings = loadConfig(env)
  assert.equal(settings.imageQuality, 'high')
  assert.equal(settings.imageTimeoutMs, 300000)
  for (const overrides of [
    { OPENAI_IMAGE_QUALITY: 'ultra' },
    { OPENAI_IMAGE_SIZE: '999x999' },
    { MAX_IMAGE_BYTES: '20000001' },
    { MAX_HISTORY_IMAGE_BYTES: '0' },
    { MAX_TOTAL_IMAGE_BYTES: '-1' },
    { IMAGE_TIMEOUT_MS: '900001' }
  ])
    assert.throws(() => loadConfig({ ...env, ...overrides }))
})

void test('all model/path overrides and optional numeric settings are parsed explicitly', () => {
  const settings = loadConfig({
    ...env,
    STATE_DB_PATH: '/tmp/custom.sqlite',
    OPENAI_SPEECH_MODEL: 'speech-custom',
    OPENAI_TRANSCRIPTION_MODEL: 'transcribe-custom',
    OPENAI_IMAGE_MODEL: 'image-custom',
    FFMPEG_PATH: '/custom/ffmpeg',
    OPENAI_SPEECH_VOICE: 'cedar',
    OPENAI_IMAGE_QUALITY: 'medium',
    OPENAI_IMAGE_SIZE: '1536x1024',
    MAX_WEB_SEARCH_CALLS: '5'
  })
  assert.equal(settings.statePath, '/tmp/custom.sqlite')
  assert.equal(settings.speechModel, 'speech-custom')
  assert.equal(settings.transcriptionModel, 'transcribe-custom')
  assert.equal(settings.imageModel, 'image-custom')
  assert.equal(settings.ffmpegPath, '/custom/ffmpeg')
  assert.equal(settings.speechVoice, 'cedar')
  assert.equal(settings.maxWebSearchCalls, 5)
  assert.throws(() => loadConfig({ ...env, MAX_THREADS: '9007199254740992' }))
  assert.throws(() => loadConfig({}))
})

void test('chat model defaults when unset or blank and preserves explicit overrides', () => {
  for (const value of [undefined, '', '   ']) {
    assert.equal(
      loadConfig({ ...env, OPENAI_CHAT_MODEL: value }).chatModel,
      'gpt-6.1-sol'
    )
  }
  assert.equal(
    loadConfig({ ...env, OPENAI_CHAT_MODEL: ' custom-model ' }).chatModel,
    'custom-model'
  )
})
