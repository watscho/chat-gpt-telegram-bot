export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface LanguageModel {
  reply(messages: readonly Message[]): Promise<string>
  transcribe(audio: Uint8Array): Promise<string>
}

export class UserError extends Error {}
