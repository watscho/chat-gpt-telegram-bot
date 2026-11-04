import { loadConfig } from '../src/config.js'
import type { LanguageModel, Message } from '../src/domain/conversation.js'

export const config = () =>
  loadConfig({
    TELEGRAM_API_KEY: '123456:test-token',
    OPENAI_API_KEY: 'test-key',
    OPENAI_CHAT_MODEL: 'test-model',
    ALLOWED_TELEGRAM_USER_IDS: '42,43'
  })
export class FakeModel implements LanguageModel {
  calls: Message[][] = []
  answer = 'Test answer'
  failure = false
  reply(messages: readonly Message[]): Promise<string> {
    this.calls.push(structuredClone([...messages]))
    return this.failure
      ? Promise.reject(new Error('secret-token'))
      : Promise.resolve(this.answer)
  }
  transcribe(): Promise<string> {
    return Promise.resolve('Voice text')
  }
}
