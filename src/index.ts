import OpenAI from 'openai'
import { ConfigurationError, loadConfig } from './config.js'
import { OpenAIModel } from './infrastructure/openai-model.js'
import { SQLiteStateStore } from './infrastructure/state-store.js'
import { RealtimeSpeech } from './infrastructure/realtime-speech.js'
import { createBot } from './telegram/bot.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const client = new OpenAI({
    apiKey: config.openaiKey,
    timeout: config.requestTimeoutMs,
    maxRetries: 0
  })
  const store = new SQLiteStateStore(config.statePath)
  const bot = createBot({
    config,
    model: new OpenAIModel(client, config),
    store,
    speech: new RealtimeSpeech(client, config)
  })
  process.once('exit', () => store.close())
  let stopping = false
  const shutdown = (signal: string): void => {
    if (stopping) return
    stopping = true
    try {
      bot.stop(signal)
    } catch {
      // No polling handlers exist yet, so startup can terminate immediately.
      process.exit(0)
    }
    // Polling and in-flight handlers have a bounded window to release resources.
    const timer = setTimeout(
      () => process.exit(process.exitCode ? 1 : 0),
      10000
    )
    timer.unref()
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  await bot.launch({ dropPendingUpdates: true }, () => {
    console.info('Telegram bot authenticated; starting polling')
  })
}

main().catch((error: unknown) => {
  // Do not print provider exceptions: Telegram URLs contain the bot token.
  console.error(
    error instanceof ConfigurationError
      ? error.message
      : 'Bot startup or polling failed. Check configuration and provider access.'
  )
  process.exitCode = 1
})
