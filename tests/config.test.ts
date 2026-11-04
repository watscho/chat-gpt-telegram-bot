import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../src/config.js'

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
for (const key of Object.keys(env)) {
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
