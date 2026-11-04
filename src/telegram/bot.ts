import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import type { Config } from '../config.js'
import { Conversations } from '../application/conversations.js'
import type { LanguageModel } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import { downloadTelegramAudio } from '../infrastructure/telegram-audio.js'

export interface BotDependencies {
  config: Config
  model: LanguageModel
  downloadAudio?: typeof downloadTelegramAudio
  reportError?: () => void
}

// Telegram counts UTF-16 code units; never split a surrogate pair.
export function splitReply(text: string, limit = 4000): string[] {
  const chunks: string[] = []
  let chunk = ''
  for (const character of text) {
    if (chunk.length + character.length > limit) {
      chunks.push(chunk)
      chunk = ''
    }
    chunk += character
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

export function createBot({
  config,
  model,
  downloadAudio = downloadTelegramAudio,
  reportError = () => console.error('Telegram update failed')
}: BotDependencies): Telegraf {
  const bot = new Telegraf(config.telegramToken, {
    handlerTimeout: config.requestTimeoutMs * 3 + 30000
  })
  const conversations = new Conversations(model, config)
  const active = new Set<string>()
  const keyFor = (user: number, chat: number) => `${chat}:${user}`

  bot.use(async (ctx, next) => {
    // Never expose group conversations or spend API credits for unknown users.
    if (
      ctx.chat?.type !== 'private' ||
      !ctx.from ||
      !config.allowedUsers.has(ctx.from.id)
    )
      return
    const key = keyFor(ctx.from.id, ctx.chat.id)
    if (active.has(key) || active.size >= config.maxConcurrentRequests) {
      await ctx.reply('Busy. Please wait for the current request to finish.')
      return
    }
    active.add(key)
    try {
      await next()
    } finally {
      active.delete(key)
    }
  })

  bot.command(['start', 'reset', 'new'], async ctx => {
    conversations.reset(keyFor(ctx.from.id, ctx.chat.id))
    await ctx.reply(
      'Conversation cleared. Send a text or voice message. Use /help for details.'
    )
  })
  bot.help(async ctx => {
    await ctx.reply(
      'Send text or a voice message to chat. /reset clears the conversation. History expires automatically and is lost on restart. Text and audio are sent to OpenAI for processing.'
    )
  })
  bot.on(message('text'), async ctx => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply('Unknown command. Use /help.')
      return
    }
    const answer = await conversations.reply(
      keyFor(ctx.from.id, ctx.chat.id),
      ctx.message.text
    )
    for (const chunk of splitReply(answer)) await ctx.reply(chunk)
  })
  bot.on(message('voice'), async ctx => {
    const voice = ctx.message.voice
    if (
      voice.duration > config.maxVoiceSeconds ||
      (voice.file_size !== undefined && voice.file_size > config.maxVoiceBytes)
    ) {
      throw new UserError(
        'Voice message exceeds the configured duration or size limit.'
      )
    }
    const url = await ctx.telegram.getFileLink(voice.file_id)
    const audio = await downloadAudio(
      url,
      config.maxVoiceBytes,
      config.requestTimeoutMs
    )
    const text = await model.transcribe(audio)
    if (!text.trim() || text.length > config.maxInputCharacters)
      throw new UserError(
        'Transcription is empty or too long. Send a shorter voice message.'
      )
    for (const chunk of splitReply(`Transcript: ${text}`))
      await ctx.reply(chunk)
    const answer = await conversations.reply(
      keyFor(ctx.from.id, ctx.chat.id),
      text
    )
    for (const chunk of splitReply(answer)) await ctx.reply(chunk)
  })
  bot.catch(async (error, ctx) => {
    // SDK/network errors can contain credentials, URLs, prompts, and transcripts.
    if (!(error instanceof UserError)) reportError()
    await ctx
      .reply(
        error instanceof UserError
          ? error.message
          : 'Unable to process your message. Please try again.'
      )
      .catch(() => {
        reportError()
      })
  })
  return bot
}
