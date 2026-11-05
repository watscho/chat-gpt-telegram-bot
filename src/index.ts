import { ConfigurationError } from './config.js'
import { dependencies } from './infrastructure/dependencies.js'

export async function main(): Promise<void> {
  const {
    loadConfig,
    OpenAI,
    SQLiteStateStore,
    OpenAIModel,
    RealtimeSpeech,
    OpenAIWorkbench,
    MiniAppServer,
    createBot
  } = dependencies
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
    speech: new RealtimeSpeech(client, config),
    provider: new OpenAIWorkbench(client, config)
  })
  let miniApp: InstanceType<typeof MiniAppServer> | undefined
  try {
    if (config.workbench.miniAppURL) {
      miniApp = new MiniAppServer(config, bot)
      await miniApp.start()
    }
  } catch (error) {
    bot.stopJobs()
    store.close()
    throw error
  }
  let worker: ReturnType<typeof setInterval> | undefined
  const stopWorker = () => {
    if (worker) clearInterval(worker)
    bot.stopJobs()
    if (miniApp)
      void miniApp
        .stop()
        .catch(() => console.error('Voice server shutdown failed'))
  }
  process.once('exit', () => {
    stopWorker()
    store.close()
  })
  let stopping = false
  const shutdown = (signal: string): void => {
    if (stopping) return
    stopping = true
    stopWorker()
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
  try {
    await bot.launch({ dropPendingUpdates: true }, () => {
      console.info('Telegram bot authenticated; starting polling')
      worker = setInterval(() => {
        void bot
          .tickJobs()
          .catch(() => console.error('Background worker failed'))
      }, config.workerIntervalMs)
      worker.unref()
    })
  } catch (error) {
    stopWorker()
    throw error
  }
}

export function reportFailure(error: unknown): void {
  // Do not print provider exceptions: Telegram URLs contain the bot token.
  console.error(
    error instanceof ConfigurationError
      ? error.message
      : 'Bot startup or polling failed. Check configuration and provider access.'
  )
  process.exitCode = 1
}

void main().catch(reportFailure)
