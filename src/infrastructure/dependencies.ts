import OpenAI from 'openai'
import { loadConfig } from '../config.js'
import { OpenAIModel } from './openai-model.js'
import { SQLiteStateStore } from './state-store.js'
import { RealtimeSpeech } from './realtime-speech.js'
import { createBot } from '../telegram/bot.js'

// Constructor references allow entrypoint unit tests without opening external resources.
export const dependencies = {
  loadConfig,
  OpenAI,
  OpenAIModel,
  SQLiteStateStore,
  RealtimeSpeech,
  createBot
}
