import { Telegraf, Input, type Context } from 'telegraf'
import { message } from 'telegraf/filters'
import type { Config } from '../config.js'
import { Profiles } from '../application/profiles.js'
import { formatSources } from '../application/sources.js'
import type { Speech } from '../domain/speech.js'
import type { StateStore } from '../domain/state.js'
import { downloadTelegramDocument } from '../infrastructure/documents.js'
import { Conversations } from '../application/conversations.js'
import type { Document, Image, LanguageModel } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import { downloadTelegramImage } from '../infrastructure/images.js'
import type { Message as TelegramMessage } from 'telegraf/types'
import { downloadTelegramAudio } from '../infrastructure/telegram-audio.js'

export interface BotDependencies {
  config: Config
  model: LanguageModel
  speech?: Speech
  store?: StateStore
  downloadDocument?: typeof downloadTelegramDocument
  downloadImage?: typeof downloadTelegramImage
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
  speech,
  store,
  downloadDocument = downloadTelegramDocument,
  downloadImage = downloadTelegramImage,
  downloadAudio = downloadTelegramAudio,
  reportError = () => console.error('Telegram update failed')
}: BotDependencies): Telegraf {
  const bot = new Telegraf(config.telegramToken, {
    handlerTimeout: config.imageTimeoutMs + config.requestTimeoutMs * 4 + 30000
  })
  const conversations = new Conversations(model, config, Date.now, store)
  const profiles = new Profiles(config, store)
  const active = new Set<string>()
  const albums = new Map<string, { id: string; messages: TelegramMessage[] }>()
  const keyFor = (user: number, chat: number) => `${chat}:${user}`
  const ownerFor = (ctx: Context) => keyFor(ctx.from!.id, ctx.chat!.id)
  const sessionFor = (ctx: Context) =>
    `${ownerFor(ctx)}:${profiles.get(ownerFor(ctx)).active}`

  bot.use(async (ctx, next) => {
    // Never expose group conversations or spend API credits for unknown users.
    if (
      ctx.chat?.type !== 'private' ||
      !ctx.from ||
      !config.allowedUsers.has(ctx.from.id)
    )
      return
    const key = keyFor(ctx.from.id, ctx.chat.id)
    const msg = ctx.message
    const group =
      msg && 'media_group_id' in msg ? msg.media_group_id : undefined
    const pending = albums.get(key)
    if (group && pending?.id === group) {
      if (pending.messages.length < 10) pending.messages.push(msg!)
      return
    }
    if (active.has(key) || active.size >= config.maxConcurrentRequests) {
      await ctx.reply('Busy. Please wait for the current request to finish.')
      return
    }
    active.add(key)
    try {
      if (group && msg) {
        const album = { id: group, messages: [msg] }
        albums.set(key, album)
        // Telegram delivers albums as separate updates. Collect one bounded batch.
        await new Promise(resolve => setTimeout(resolve, 750))
        albums.delete(key)
        ctx.state.photoMessages = album.messages
      }
      await next()
    } finally {
      albums.delete(key)
      active.delete(key)
    }
  })

  const help = [
    'Send text, voice, photos or documents (PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, JSON). Captions are instructions; reply to a file/photo to select it. Reference albums are supported.',
    '/search query — search the web with sources; fresh-fact questions can search automatically.',
    '/image description — generate; /edit instructions — edit images in context. Results arrive as original PNG files.',
    '/new [name] — create and switch conversation; /chats — list; /switch id; /rename name; /delete id.',
    '/reset — clear current history and attachments. /start displays help.',
    '/remember note (or “запомни: …”) — save a user note across conversations; /memory — view; /forget number | all (or exact note). Nothing is remembered automatically.',
    '/voice off | on | auto — voice replies (auto: only after voice input); /speak [text] — narrate text or the last answer. Voice is AI-generated. Text is always available.',
    'With the production store, history, photos and documents persist locally until TTL/eviction/reset; named conversations, saved notes and voice preferences persist until changed/deleted. Text, audio, files, notes and relevant history are sent to OpenAI. Search queries also reach search providers. API usage is billed.'
  ].join('\n\n')
  const speak = async (ctx: Context, text: string): Promise<void> => {
    if (!speech) throw new UserError('Voice output is not configured.')
    const chunks = splitReply(text, config.maxSpeechCharacters)
    if (!chunks.length)
      throw new UserError(
        'No text to narrate. Send /speak text or ask a question first.'
      )
    // Bound speech spend to one request; never silently truncate a long answer.
    if (chunks.length > 1)
      throw new UserError(
        'Text is too long for voice. Use /speak with a shorter passage.'
      )
    const audio = await speech.synthesize(text)
    if (!audio.length || audio.length > config.maxSpeechBytes)
      throw new Error('Invalid voice output')
    await ctx.replyWithVoice(
      Input.fromBuffer(Buffer.from(audio), 'reply.ogg'),
      { caption: 'AI-generated voice' }
    )
  }
  const manage = async (ctx: Context, text: string): Promise<boolean> => {
    const naturalRemember = text.match(
      /^(?:запомни|remember)(?:\s*[:：]\s*|\s+)([\s\S]+)$/i
    )
    const naturalForget = text.match(
      /^(?:забудь|forget)(?:\s*[:：]\s*|\s+)([\s\S]+)$/i
    )
    const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+|$)/)
    const command = naturalRemember
      ? 'remember'
      : naturalForget
        ? 'forget'
        : match?.[1]?.toLowerCase()
    const argument =
      naturalRemember?.[1]?.trim() ??
      naturalForget?.[1]?.trim() ??
      (match ? text.slice(match[0].length).trim() : '')
    const owner = ownerFor(ctx)
    switch (command) {
      case 'start':
      case 'help':
        await ctx.reply(help)
        break
      case 'reset':
        conversations.reset(sessionFor(ctx))
        await ctx.reply(
          'Conversation cleared, including photos and documents. Saved notes and other conversations are preserved.'
        )
        break
      case 'new': {
        const profile = profiles.create(owner, argument)
        await ctx.reply(
          `Conversation ${profile.active} created. Use /chats to switch.`
        )
        break
      }
      case 'chats': {
        const profile = profiles.get(owner)
        for (const chunk of splitReply(
          profile.threads
            .map(
              thread =>
                `${thread.id === profile.active ? '→ ' : ''}${thread.id}: ${thread.title}`
            )
            .join('\n')
        ))
          await ctx.reply(chunk)
        break
      }
      case 'switch':
        profiles.switch(owner, argument)
        await ctx.reply(`Switched to conversation ${argument}.`)
        break
      case 'rename':
        profiles.rename(owner, argument)
        await ctx.reply('Conversation renamed.')
        break
      case 'delete':
        profiles.delete(owner, argument)
        conversations.reset(`${owner}:${argument}`)
        await ctx.reply('Conversation and its history deleted.')
        break
      case 'remember':
        profiles.remember(owner, argument)
        await ctx.reply('Saved. Use /memory to view or /forget to remove.')
        break
      case 'memory': {
        const notes = profiles.get(owner).memories
        for (const chunk of splitReply(
          notes.length
            ? notes.map((note, index) => `${index + 1}. ${note}`).join('\n')
            : 'No saved notes.'
        ))
          await ctx.reply(chunk)
        break
      }
      case 'forget':
        profiles.forget(
          owner,
          /^(?:всё|все)$/i.test(argument) ? 'all' : argument
        )
        await ctx.reply(
          'Saved memory removed. Previous conversation content is unchanged; /reset clears it.'
        )
        break
      case 'voice':
        profiles.voice(owner, argument)
        await ctx.reply(`Voice replies: ${argument}. Voice is AI-generated.`)
        break
      case 'speak':
        await speak(
          ctx,
          argument || conversations.lastReply(sessionFor(ctx)) || ''
        )
        break
      default:
        return false
    }
    return true
  }
  const fileLink = async (
    ctx: Context,
    fileId: string,
    timeoutMs: number
  ): Promise<{ url: URL; remaining: number }> => {
    const started = Date.now()
    // Telegraf declares the legacy abort-controller type; node-fetch also accepts
    // Node's standards-compatible signal at runtime.
    const options = {
      signal: AbortSignal.timeout(timeoutMs)
    } as unknown as NonNullable<Parameters<typeof ctx.telegram.callApi>[2]>
    const file = await ctx.telegram.callApi(
      'getFile',
      { file_id: fileId },
      options
    )
    if (!file.file_path)
      throw new UserError(
        'Telegram file is unavailable. Send the attachment again.'
      )
    const remaining = timeoutMs - (Date.now() - started)
    if (remaining <= 0)
      throw new UserError(
        'Attachment download timed out. Send fewer or smaller files.'
      )
    return { url: await ctx.telegram.getFileLink(file), remaining }
  }
  const readAttachment = async (
    ctx: Context,
    msg: TelegramMessage,
    timeoutMs = config.requestTimeoutMs
  ): Promise<{ image?: Image; document?: Document }> => {
    const file =
      'photo' in msg
        ? msg.photo.at(-1)
        : 'document' in msg
          ? msg.document
          : undefined
    if (!file) return {}
    const isImage =
      'photo' in msg ||
      ('mime_type' in file && file.mime_type.startsWith('image/')) ||
      ('file_name' in file && /\.(?:png|jpe?g|webp)$/i.test(file.file_name))
    const maxBytes = isImage ? config.maxImageBytes : config.maxDocumentBytes
    if (file.file_size !== undefined && file.file_size > maxBytes)
      throw new UserError('Attachment exceeds the configured size limit.')
    const { url, remaining } = await fileLink(ctx, file.file_id, timeoutMs)
    if (isImage) return { image: await downloadImage(url, maxBytes, remaining) }
    return {
      document: await downloadDocument(
        url,
        'file_name' in file ? file.file_name : 'document',
        maxBytes,
        remaining
      )
    }
  }
  const respond = async (
    ctx: Context,
    text: string,
    images: Image[] = [],
    documents: Document[] = [],
    voiceInput = false
  ): Promise<void> => {
    if (!images.length && !documents.length && (await manage(ctx, text))) return
    const command = text.match(/^\/(image|edit|search)(?:@\w+)?(?:\s+|$)/i)
    const action =
      command?.[1]?.toLowerCase() === 'image'
        ? 'generate'
        : command?.[1]?.toLowerCase() === 'edit'
          ? 'edit'
          : 'auto'
    const prompt = command ? text.slice(command[0].length).trim() : text
    if (command && !prompt)
      throw new UserError(`Usage: /${command[1]} description`)
    if (!command && text.startsWith('/')) {
      await ctx.reply('Unknown command. Use /help.')
      return
    }
    const msg = ctx.message
    if (
      !images.length &&
      !documents.length &&
      msg &&
      'reply_to_message' in msg &&
      msg.reply_to_message
    ) {
      const reference = await readAttachment(ctx, msg.reply_to_message)
      if (reference.image) images.push(reference.image)
      if (reference.document) documents.push(reference.document)
    }
    const signalProgress = () =>
      ctx
        .sendChatAction(action === 'auto' ? 'typing' : 'upload_photo')
        .catch(() => undefined)
    await signalProgress()
    const progress = setInterval(() => {
      void signalProgress()
    }, 4000)
    progress.unref()
    try {
      const answer = await conversations.respond(
        sessionFor(ctx),
        prompt ||
          (documents.length
            ? 'Summarize these documents and describe what questions you can answer about them.'
            : 'Describe this image and offer ways to work with it.'),
        images,
        {
          action,
          ...(command?.[1]?.toLowerCase() === 'search' ? { search: true } : {}),
          memories: profiles.get(ownerFor(ctx)).memories,
          documents
        }
      )
      for (const chunk of splitReply(answer.text)) await ctx.reply(chunk)
      for (const chunk of splitReply(formatSources(answer.sources)))
        await ctx.reply(chunk)
      for (const image of answer.images) {
        await ctx.replyWithDocument(
          Input.fromBuffer(Buffer.from(image.data, 'base64'), 'image.png')
        )
      }
      const voice = profiles.get(ownerFor(ctx)).voice
      if (answer.text && (voice === 'on' || (voice === 'auto' && voiceInput))) {
        try {
          await speak(ctx, answer.text)
        } catch (error) {
          if (!(error instanceof UserError)) reportError()
          await ctx.reply(
            error instanceof UserError
              ? error.message
              : 'Voice output failed. The text answer above is available; use /speak to retry.'
          )
        }
      }
    } finally {
      clearInterval(progress)
    }
  }
  bot.on(message('text'), async ctx => {
    await respond(ctx, ctx.message.text)
  })
  bot.on([message('photo'), message('document')], async ctx => {
    const batch = (ctx.state.photoMessages as
      TelegramMessage[] | undefined) ?? [ctx.message]
    const images: Image[] = []
    const documents: Document[] = []
    const captions: string[] = []
    const deadline = Date.now() + config.requestTimeoutMs
    for (const msg of batch) {
      const remaining = deadline - Date.now()
      if (remaining <= 0)
        throw new UserError(
          'Image download timed out. Send fewer or smaller images.'
        )
      const attachment = await readAttachment(ctx, msg, remaining)
      if (!attachment.image && !attachment.document)
        throw new UserError('Send an album of supported images or documents.')
      if (attachment.image) images.push(attachment.image)
      if (attachment.document) documents.push(attachment.document)
      if (
        [...images, ...documents].reduce(
          (sum, item) => sum + item.data.length,
          0
        ) > Math.min(config.maxHistoryImageBytes, config.maxTotalImageBytes)
      )
        throw new UserError(
          'Images exceed the configured memory limit. Send fewer or smaller images.'
        )
      if ('caption' in msg && msg.caption) captions.push(msg.caption)
    }
    await respond(ctx, captions.join('\n'), images, documents)
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
    const { url, remaining } = await fileLink(
      ctx,
      voice.file_id,
      config.requestTimeoutMs
    )
    const audio = await downloadAudio(url, config.maxVoiceBytes, remaining)
    const text = await model.transcribe(audio)
    if (!text.trim() || text.length > config.maxInputCharacters)
      throw new UserError(
        'Transcription is empty or too long. Send a shorter voice message.'
      )
    for (const chunk of splitReply(`Transcript: ${text}`))
      await ctx.reply(chunk)
    await respond(ctx, text, [], [], true)
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
