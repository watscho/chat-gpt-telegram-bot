import { createReadStream } from 'fs'
import {
  ChatCompletionRequestMessage,
  ChatCompletionResponseMessage,
  Configuration,
  CreateTranscriptionResponse,
  OpenAIApi
} from 'openai'

export class OpenAI {
  public readonly roles = {
    System: 'system',
    User: 'user',
    Assistant: 'assistant'
  }

  private chatGPTVersion = 'gpt-3.5-turbo'

  private openai: OpenAIApi

  public constructor(readonly filepath?: string) {
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY
    })

    this.openai = new OpenAIApi(configuration)
  }

  public async chat(
    messages: ChatCompletionRequestMessage[]
  ): Promise<ChatCompletionResponseMessage | undefined> {
    const response = await this.openai.createChatCompletion({
      model: this.chatGPTVersion,
      messages
    })

    return response.data.choices[0].message
  }

  public async transcription(): Promise<CreateTranscriptionResponse> {
    if (!this.filepath) {
      throw new Error('Something went wrong please try again.')
    }

    const { data } = await this.openai.createTranscription(
      createReadStream(this.filepath),
      'whisper-1'
    )

    return data
  }
}
