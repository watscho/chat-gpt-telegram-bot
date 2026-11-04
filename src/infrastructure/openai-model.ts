import OpenAI, { toFile } from 'openai'
import type { Config } from '../config.js'
import type { LanguageModel, Message } from '../domain/conversation.js'

type ModelConfig = Pick<
  Config,
  'chatModel' | 'transcriptionModel' | 'maxOutputTokens'
>

export class OpenAIModel implements LanguageModel {
  constructor(
    private readonly client: OpenAI,
    private readonly config: ModelConfig
  ) {}

  async reply(messages: readonly Message[]): Promise<string> {
    const response = await this.client.responses.create({
      model: this.config.chatModel,
      input: [...messages],
      max_output_tokens: this.config.maxOutputTokens,
      store: false
    })
    if (response.status !== 'completed' || !response.output_text?.trim()) {
      throw new Error('Incomplete model response')
    }
    return response.output_text
  }

  async transcribe(audio: Uint8Array): Promise<string> {
    const result = await this.client.audio.transcriptions.create({
      model: this.config.transcriptionModel,
      file: await toFile(audio, 'voice.ogg', { type: 'audio/ogg' })
    })
    if (!result.text.trim()) throw new Error('Empty transcription')
    return result.text
  }
}
