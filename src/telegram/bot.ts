import { Workbench } from '../application/workbench.js'
import { WorkbenchModel } from '../application/workbench-model.js'
import { LiveSessions } from '../application/live-sessions.js'
import {
  WorkbenchCommands,
  type WorkbenchContext
} from './workbench-commands.js'
import type { ProviderWorkbench } from '../domain/workbench.js'
import { recordingMeta } from './recordings.js'
import { meetingAudio } from '../infrastructure/meeting-audio.js'
import { downloadTelegramFile } from '../infrastructure/telegram-file.js'
import { Daily } from '../application/daily.js'
import { DailyCommands, type DailyContext } from './daily-commands.js'
import { readArticle } from '../infrastructure/article-reader.js'
import { referenceId } from '../application/evidence.js'
import { Experience } from '../application/experience.js'
import {
  ExperienceCommands,
  type ExperienceContext
} from './experience-commands.js'
import { translate, translateKeyboard } from './localization.js'
import type { Notice } from '../domain/experience.js'
import { Workflow } from '../application/workflow.js'
import { ArchiveImport } from '../application/archive.js'
import { WorkflowCommands, type WorkflowContext } from './workflow-commands.js'
import { Productivity } from '../application/productivity.js'
import { Library } from '../application/library.js'
import { extractDocumentText } from '../infrastructure/document-text.js'
import {
  ProductivityCommands,
  type ProductivityContext
} from './productivity-commands.js'
import type { PreparedRequest } from '../domain/productivity.js'
import { Telegraf, Input, type Context } from 'telegraf'
import { message } from 'telegraf/filters'
import type { Config } from '../config.js'
import { Profiles } from '../application/profiles.js'
import { formatSources } from '../application/sources.js'
import type { Speech } from '../domain/speech.js'
import type { StateStore } from '../domain/state.js'
import { downloadTelegramDocument } from '../infrastructure/documents.js'
import { Workspaces } from '../application/workspaces.js'
import { UsageLedger } from '../application/usage.js'
import { ResponseControls } from '../application/response-controls.js'
import { Jobs } from '../application/jobs.js'
import type { JobInput } from '../domain/jobs.js'
import { HistoryExport } from '../infrastructure/history-export.js'
import { ProCommands } from './pro-commands.js'
import { Conversations } from '../application/conversations.js'
import type {
  Document,
  Image,
  LanguageModel,
  ReplyOptions
} from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import { downloadTelegramImage } from '../infrastructure/images.js'
import type { Message as TelegramMessage } from 'telegraf/types'
import { downloadTelegramAudio } from '../infrastructure/telegram-audio.js'

export interface BotDependencies {
  config: Config
  provider?: ProviderWorkbench
  model: LanguageModel
  speech?: Speech
  store?: StateStore
  downloadDocument?: typeof downloadTelegramDocument
  downloadImage?: typeof downloadTelegramImage
  downloadAudio?: typeof downloadTelegramAudio
  extractText?: typeof extractDocumentText
  readArticle?: typeof readArticle
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

export interface ManagedBot extends Telegraf {
  tickJobs(): Promise<void>
  stopJobs(): void
  liveStatus(owner: string): ReturnType<LiveSessions['status']>
  openLive(
    owner: string,
    offer: string,
    mode: string
  ): ReturnType<LiveSessions['open']>
  closeLive(owner: string, id: string): Promise<void>
}

export function createBot({
  config,
  model,
  provider,
  speech,
  store,
  downloadDocument = downloadTelegramDocument,
  downloadImage = downloadTelegramImage,
  downloadAudio = downloadTelegramAudio,
  extractText = extractDocumentText,
  readArticle: article = readArticle,
  reportError = () => console.error('Telegram update failed')
}: BotDependencies): ManagedBot {
  const bot = new Telegraf(config.telegramToken, {
    handlerTimeout: config.imageTimeoutMs + config.requestTimeoutMs * 4 + 30000
  }) as ManagedBot
  const profiles = new Profiles(config, store)
  const workspaces = new Workspaces(config, store)
  const usage = new UsageLedger(config, workspaces, store)
  const workbench = new Workbench(config, workspaces, provider, store)
  const live = new LiveSessions(
    config,
    provider,
    workbench.journal,
    usage,
    workspaces
  )
  const conversations = new Conversations(
    new WorkbenchModel(model, workbench),
    config,
    Date.now,
    store
  )
  const providerCommands = new WorkbenchCommands(
    workbench,
    workspaces,
    conversations,
    config
  )
  const controls = new ResponseControls()
  const productivity = new Productivity(store)
  const workflow = new Workflow(store)
  const experience = new Experience(store)
  const daily = new Daily(store)
  const importer = store ? new ArchiveImport(config, store) : undefined
  const library = new Library(extractText, store)
  const advanced = new ProductivityCommands(
    productivity,
    library,
    profiles,
    workspaces,
    conversations,
    config.chatModel,
    Date.now,
    (prompt, request) =>
      request?.workbench
        ? config.estimateChat + workbench.estimate(request.workbench)
        : config.confirmExpensiveRequests &&
            /^\/(image|edit)(?:@\w+)?(?:\s|$)/i.test(prompt)
          ? config.estimateChat + config.estimateImage
          : undefined
  )
  const exporter = new HistoryExport(config.maxExportBytes)
  const sessionLocks = new Set<string>()
  let background = 0
  const active = new Set<string>()
  const albums = new Map<string, { id: string; messages: TelegramMessage[] }>()
  const keyFor = (user: number, chat: number) => `${chat}:${user}`
  const ownerFor = (ctx: Context) => keyFor(ctx.from!.id, ctx.chat!.id)
  const sessionFor = (ctx: Context) =>
    `${ownerFor(ctx)}:${profiles.get(ownerFor(ctx)).active}`

  const languageFor = (owner: string) => experience.get(owner).language
  const uiReply = (
    ctx: Context,
    text: string,
    extra?: Parameters<Context['reply']>[1]
  ) => {
    const language = languageFor(ownerFor(ctx))
    const markup =
      extra?.reply_markup && 'inline_keyboard' in extra.reply_markup
        ? { reply_markup: translateKeyboard(extra.reply_markup, language) }
        : {}
    return ctx.reply(ctx.state.rawUI ? text : translate(text, language), {
      ...extra,
      ...markup
    })
  }
  const answerPreference = (owner: string, thread: string) => {
    const language = workspaces.thread(owner, thread).answerLanguage
    return language && language !== 'auto'
      ? `Answer language preference: ${language}. Use this language for prose and structured text values; preserve requested field names and quoted source text.`
      : ''
  }
  const frozenInput = (
    owner: string,
    thread: string,
    prompt: string,
    images: Image[] = [],
    documents: Document[] = []
  ): JobInput => {
    const history = conversations.history(`${owner}:${thread}`)
    const project = workspaces.project(owner, thread)
    const files = [
      ...history.flatMap(message => message.documents ?? []),
      ...(project?.documents ?? []),
      ...documents
    ]
    const uniqueFiles = files
      .filter(
        (file, index) =>
          !files
            .slice(index + 1)
            .some(next => next.name === file.name && next.data === file.data)
      )
      .slice(-10)
    const photos = [
      ...history.flatMap(message => message.images ?? []),
      ...images
    ]
    const uniqueImages = photos
      .filter(
        (image, index) =>
          !photos.slice(index + 1).some(next => next.data === image.data)
      )
      .slice(-10)
    return {
      prompt,
      project: project?.id ?? null,
      documents: uniqueFiles,
      images: uniqueImages,
      memories: [...profiles.get(owner).memories, ...(project?.notes ?? [])],
      instructions: workspaces.instructions(owner, thread)
    }
  }
  const jobs = new Jobs(
    config,
    {
      allowed: owner => {
        const parts = owner.split(':')
        return (
          parts.length === 2 &&
          parts[0] === parts[1] &&
          config.allowedUsers.has(Number(parts[1]))
        )
      },
      available: (owner, thread) =>
        !active.has(owner) &&
        !sessionLocks.has(`${owner}:${thread}`) &&
        active.size + background < config.maxConcurrentRequests,
      input: (owner, thread, prompt) => frozenInput(owner, thread, prompt),
      execute: async (owner, job, signal) => {
        if (
          !profiles.get(owner).threads.some(thread => thread.id === job.thread)
        )
          throw new UserError('The source conversation no longer exists.')
        const session = `${owner}:${job.thread}`
        if (
          job.kind === 'summary' &&
          !conversations.history(session).length &&
          !job.input.documents.length &&
          !job.input.images.length
        )
          throw new UserError(
            'No retained conversation or reference content is available to summarize.'
          )
        sessionLocks.add(session)
        background++
        let reservation: ReturnType<UsageLedger['reserve']> | undefined
        const options: ReplyOptions = {
          signal,
          ...(workspaces.thread(owner, job.thread).model
            ? { chatModel: workspaces.thread(owner, job.thread).model! }
            : {}),
          documents: job.input.documents,
          ...(job.kind === 'batch' ? { contextHistory: [], summary: '' } : {}),
          memories: [
            ...profiles.get(owner).memories,
            ...(workspaces
              .get(owner)
              .projects.find(project => project.id === job.input.project)
              ?.notes ?? [])
          ],
          instructions: [
            job.input.instructions,
            workflow.terms(owner, job.input.project ?? null),
            answerPreference(owner, job.thread)
          ]
            .filter(Boolean)
            .join('\n\n'),
          search: job.kind === 'research',
          enableImages: false,
          enableSearch: job.kind === 'research',
          ...(workspaces.thread(owner, job.thread).retentionSeconds !== null
            ? {
                retentionSeconds: workspaces.thread(owner, job.thread)
                  .retentionSeconds!
              }
            : {}),
          onStart: () => {
            reservation = usage.reserve(
              owner,
              job.kind === 'research' ? 'search' : 'chat',
              true,
              job.input.project
            )
            Object.assign(options, reservation.options)
          }
        }
        try {
          const prompt =
            job.kind === 'compare'
              ? `Compare the reference versions in a table of location, before, after, impact and evidence. Mark uncertainty. ${job.input.prompt}`
              : job.kind === 'summary'
                ? `Summarize the retained conversation and references, including decisions, outstanding work and uncertainties. ${job.input.prompt}`
                : job.input.prompt
          const answer = await conversations.respond(
            session,
            prompt,
            job.input.images,
            options
          )
          reservation!.finish(
            answer.toolsUsed ?? {
              images: answer.images.length,
              searches: answer.sources?.length ? 1 : 0
            }
          )
          return answer
        } catch (error) {
          reservation?.fail()
          throw error
        } finally {
          sessionLocks.delete(session)
          background--
        }
      },
      deliver: async (owner, job, manual) => {
        if (
          !manual &&
          experience.shouldQueue(owner, workspaces.get(owner).timezone)
        ) {
          experience.enqueue(owner, {
            kind: 'job',
            target: job.id,
            thread: job.thread,
            title: `Job ${job.id}`
          })
          return 'queued'
        }

        const chat = Number(owner.split(':')[0])
        for (const chunk of splitReply(
          `${translate(`Job ${job.id} · conversation ${job.thread}`, languageFor(owner))}\n${job.result!.text}`
        ))
          await bot.telegram.sendMessage(chat, chunk)
        for (const chunk of splitReply(formatSources(job.result!.sources)))
          await bot.telegram.sendMessage(chat, chunk)
        for (const image of job.result!.images)
          await bot.telegram.sendDocument(
            chat,
            Input.fromBuffer(Buffer.from(image.data, 'base64'), 'image.png')
          )
        if (manual) {
          const notice = experience
            .get(owner)
            .notices.find(item => item.kind === 'job' && item.target === job.id)
          if (notice) experience.removeNotice(owner, notice.id)
          jobs.delivered(owner, job.id)
        }
      }
    },
    store
  )
  jobs.recover()
  const flowCommands = new WorkflowCommands(
    workflow,
    jobs,
    workspaces,
    conversations,
    config,
    importer
  )
  const deliverDigest = async (
    owner: string,
    notices: Notice[]
  ): Promise<void> => {
    const receipts = new Map<string, 'sent' | 'suppressed'>()
    const lines: string[] = [],
      buttons: { text: string; callback_data: string }[][] = []
    for (const notice of notices) {
      if (notice.kind === 'job') {
        const job = jobs.get(owner).jobs.find(item => item.id === notice.target)
        if (
          !job?.result ||
          job.delivery === 'sent' ||
          job.delivery === 'suppressed'
        ) {
          receipts.set(
            notice.id,
            job?.delivery === 'sent' ? 'sent' : 'suppressed'
          )
          continue
        }
        lines.push(
          `${translate(`Job ${job.id} · conversation ${job.thread}`, languageFor(owner))}\n${job.result.text.slice(0, 500)}`
        )
        buttons.push([
          {
            text: translate('Open result', languageFor(owner)),
            callback_data: `notice:result:${job.id}`
          }
        ])
      } else {
        const task = workflow
          .get(owner)
          .tasks.find(item => item.id === notice.target)
        if (
          !task ||
          task.status === 'done' ||
          task.dueAt === null ||
          task.dueAt > Date.now() ||
          task.delivery === 'sent' ||
          task.delivery === 'suppressed'
        ) {
          receipts.set(
            notice.id,
            task?.delivery === 'sent' ? 'sent' : 'suppressed'
          )
          continue
        }
        lines.push(
          `${translate(`Task due · conversation ${task.thread}`, languageFor(owner))}\n${task.title}`
        )
        buttons.push([
          {
            text: translate('Done', languageFor(owner)),
            callback_data: `task:done:${task.id}`
          }
        ])
      }
    }
    if (lines.length)
      for (const chunk of splitReply(
        `${translate(`Notification digest · ${lines.length}`, languageFor(owner))}\n\n${lines.join('\n\n')}`
      ))
        await bot.telegram.sendMessage(Number(owner.split(':')[0]), chunk, {
          reply_markup: { inline_keyboard: buttons }
        })
    for (const notice of notices)
      if (notice.kind === 'job')
        jobs.delivered(owner, notice.target, receipts.get(notice.id) ?? 'sent')
      else
        workflow.delivered(
          owner,
          notice.target,
          receipts.get(notice.id) ?? 'sent'
        )
  }
  const dailyCommands = new DailyCommands(
    daily,
    profiles,
    workspaces,
    conversations,
    workflow,
    jobs,
    productivity,
    experience
  )
  const experienceCommands = new ExperienceCommands(
    experience,
    jobs,
    workflow,
    workspaces,
    usage,
    conversations
  )
  bot.tickJobs = async () => {
    await workbench.tick()
    live.recover()
    await jobs.tick()
    await workflow.tick(
      owner => {
        const parts = owner.split(':')
        return (
          parts.length === 2 &&
          parts[0] === parts[1] &&
          config.allowedUsers.has(Number(parts[1]))
        )
      },
      async (owner, task) => {
        if (experience.shouldQueue(owner, workspaces.get(owner).timezone)) {
          experience.enqueue(owner, {
            kind: 'task',
            target: task.id,
            thread: task.thread,
            title: task.title
          })
          return 'queued'
        }
        await bot.telegram.sendMessage(
          Number(owner.split(':')[0]),
          `${translate(`Task due · conversation ${task.thread}`, languageFor(owner))}\n${task.title}`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: translate('Done', languageFor(owner)),
                    callback_data: `task:done:${task.id}`
                  }
                ]
              ]
            }
          }
        )
      }
    )
    await experience.tick(
      owner => {
        const parts = owner.split(':')
        return (
          parts.length === 2 &&
          parts[0] === parts[1] &&
          config.allowedUsers.has(Number(parts[1]))
        )
      },
      owner => workspaces.get(owner).timezone,
      deliverDigest
    )
    await daily.tick(
      owner => {
        const parts = owner.split(':')
        return (
          parts.length === 2 &&
          parts[0] === parts[1] &&
          config.allowedUsers.has(Number(parts[1]))
        )
      },
      owner => workspaces.get(owner).timezone,
      owner => experience.isQuiet(owner, workspaces.get(owner).timezone),
      async owner => {
        const view = dailyCommands.today(owner)
        for (const chunk of splitReply(view.text))
          await bot.telegram.sendMessage(Number(owner.split(':')[0]), chunk, {
            reply_markup: translateKeyboard(view.keyboard, languageFor(owner))
          })
      }
    )
  }
  bot.liveStatus = owner => live.status(owner, profiles.get(owner).active)
  bot.openLive = (owner, offer, mode) => {
    if (
      active.has(owner) ||
      active.size + background + live.count >= config.maxConcurrentRequests
    )
      return Promise.reject(
        new UserError(
          'The assistant is busy. Wait for the current request to finish.'
        )
      )
    return live.open(owner, profiles.get(owner).active, offer, mode)
  }
  bot.closeLive = (owner, id) => live.close(owner, id)
  bot.stopJobs = () => {
    jobs.stop()
    void live.stop().catch(reportError)
  }
  const pro = new ProCommands(
    profiles,
    conversations,
    workspaces,
    usage,
    controls,
    jobs,
    exporter,
    store
  )

  bot.use(async (ctx, next) => {
    // Never expose group conversations or spend API credits for unknown users.
    if (
      ctx.chat?.type !== 'private' ||
      !ctx.from ||
      !config.allowedUsers.has(ctx.from.id)
    )
      return
    const key = keyFor(ctx.from.id, ctx.chat.id)
    const acknowledge = ctx.answerCbQuery.bind(ctx)
    ctx.answerCbQuery = (text, extra) =>
      acknowledge(
        text === undefined ? undefined : translate(text, languageFor(key)),
        extra
      )
    const msg = ctx.message
    const callback =
      ctx.callbackQuery && 'data' in ctx.callbackQuery
        ? ctx.callbackQuery.data
        : ''
    // Forward collection is synchronous local work and accepts rapid batches even
    // while a paid foreground request is running. Forwarded commands stay content.
    if (
      msg &&
      'forward_origin' in msg &&
      productivity.get(key).collecting[profiles.get(key).active]
    ) {
      const thread = profiles.get(key).active
      const content =
        'text' in msg ? msg.text : 'caption' in msg ? (msg.caption ?? '') : ''
      productivity.collect(key, thread, msg.message_id, content)
      await uiReply(
        ctx,
        'Forwarded text/caption collected; media contents were not downloaded. Use /collect summarize when ready.'
      )
      return
    }
    if (
      (msg && 'text' in msg && /^\/stop(?:@\w+)?$/.test(msg.text.trim())) ||
      callback.startsWith('request:stop:')
    ) {
      const stopped = controls.stop(
        key,
        callback ? callback.slice(13) : undefined
      )
      if (callback)
        await ctx.answerCbQuery(
          stopped ? 'Stopping request.' : 'No matching active request.'
        )
      else
        await uiReply(
          ctx,
          stopped
            ? 'Stopping request. Already-started provider work may still be billed.'
            : 'No active request.'
        )
      return
    }
    const group =
      msg && 'media_group_id' in msg ? msg.media_group_id : undefined
    const pending = albums.get(key)
    if (group && pending?.id === group) {
      if (pending.messages.length < 10) pending.messages.push(msg!)
      return
    }
    if (
      active.has(key) ||
      active.size + background + live.count >= config.maxConcurrentRequests
    ) {
      await uiReply(ctx, 'Busy. Please wait for the current request to finish.')
      return
    }
    active.add(key)
    ctx.state.request = controls.begin(key, profiles.get(key).active)
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
      controls.end(key)
    }
  })

  const help = [
    '/pro — provider workbench. /analyze — Python data analysis. /knowledge — cloud semantic library. /connections and /connect — reviewed external actions. /meeting — recording protocol. /live — live voice. /cloud_cleanup — remote resource status.',
    '/today — daily dashboard. /morning — optional local morning overview. /scenarios, /favorite, /run — quick workflows. /notes — reviewed voice tasks. /read — article reader. /continue — project context review. /onboarding — guided setup.',
    '/quiet, /digest and /notifications — delivery controls. /bookmarks and /bookmark — saved passages. /sources — cited evidence cards. /project_budget and /project_usage — project estimates. /output — validated CSV/JSON. /queue, /priority and /defer — queued work. /language — UI and answer preferences.',
    'Start here: /guide opens a task-oriented command menu. /tasks, /batch, /glossary, /recap and /import extend your workflow. Images and background work show configured cost estimates before confirmation by default.',
    'Send text, voice, photos or documents (PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, JSON). Captions are instructions; reply to a file/photo to select it. Reference albums are supported.',
    '/settings — button-based model/project/mode/voice/limit controls. /model ID overrides this conversation model.',
    '/turns, /branch N | title, /revise N | request — preserved dialogue branches. /templates, /template and /run — reusable prompts.',
    '/library add|list|find|remove and /ask — project-scoped text/PDF retrieval. /collect on|off|show|clear|summarize — forwarded text batches.',
    '/context on|off or /context request — inspect/exclude context before generation. /feedback — view answer ratings.',
    '/search query — search the web with sources; fresh-fact questions can search automatically.',
    '/image description — generate; /edit instructions — edit images in context. Results arrive as original PNG files.',
    '/new [name] — create and switch conversation; /chats — list; /switch id; /rename name; /delete id.',
    '/reset — clear current history and attachments. /start displays help.',
    '/usage, /budget, /limits — local cost estimates and daily controls. /stop cancels the active request.',
    '/projects and /project — reference workspaces. /mode and /instructions — conversation behavior. /find, /export and /data — retained history and data export.',
    '/compare — compare reference documents. /quality, /size, /versions and /revert — image workflow controls. /retention — conversation expiry.',
    '/job, /jobs, /cancel and /result — background research/comparison/summary. /remind, /summary, /schedules, /unschedule and /timezone — schedules. /erase — content deletion.',
    '/remember note (or “remember: …”) — save a user note across conversations; /memory — view; /forget number | all (or exact note). Nothing is remembered automatically.',
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
    const reservation = usage.reserve(
      ownerFor(ctx),
      'voice',
      true,
      workspaces.thread(ownerFor(ctx), profiles.get(ownerFor(ctx)).active)
        .project
    )
    let audio: Uint8Array
    try {
      audio = await speech.synthesize(
        text,
        controls.current(ownerFor(ctx))?.signal
      )
      reservation.finish()
    } catch (error) {
      reservation.fail()
      throw error
    }
    if (!audio.length || audio.length > config.maxSpeechBytes)
      throw new Error('Invalid voice output')
    await ctx.replyWithVoice(
      Input.fromBuffer(Buffer.from(audio), 'reply.ogg'),
      { caption: 'AI-generated voice' }
    )
  }
  const manage = async (ctx: Context, text: string): Promise<boolean> => {
    const naturalRemember = text.match(
      /^remember(?:\s*[:：]\s*|\s+)([\s\S]+)$/i
    )
    const naturalForget = text.match(/^forget(?:\s*[:：]\s*|\s+)([\s\S]+)$/i)
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
        if (!daily.get(owner).onboarded)
          await dailyCommands.onboarding(dailyContext(ctx))
        else {
          const view = dailyCommands.today(owner)
          await experienceContext(ctx).text(
            `${view.text}\n\n/guide opens all workflows; /settings changes preferences.`,
            view.keyboard,
            true
          )
        }
        break
      case 'help':
        for (const chunk of splitReply(help)) await uiReply(ctx, chunk)
        await flowCommands.guide(workflowContext(ctx))
        break
      case 'reset':
        jobs.cancelThread(owner, profiles.get(owner).active)
        controls.clear(owner, false)
        productivity.deleteThread(owner, profiles.get(owner).active)
        workflow.deleteThread(owner, profiles.get(owner).active)
        experience.deleteThread(owner, profiles.get(owner).active)
        daily.deleteThread(owner, profiles.get(owner).active)
        workbench.deleteThread(owner, profiles.get(owner).active)
        conversations.reset(sessionFor(ctx))
        await uiReply(
          ctx,
          'Conversation cleared, including photos and documents. Saved notes and other conversations are preserved.'
        )
        break
      case 'new': {
        const profile = profiles.create(owner, argument)
        await uiReply(
          ctx,
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
          await uiReply(ctx, chunk)
        break
      }
      case 'switch':
        profiles.switch(owner, argument)
        await uiReply(ctx, `Switched to conversation ${argument}.`)
        break
      case 'rename':
        profiles.rename(owner, argument)
        await uiReply(ctx, 'Conversation renamed.')
        break
      case 'delete':
        profiles.delete(owner, argument)
        jobs.cancelThread(owner, argument)
        workspaces.deleteThread(owner, argument)
        productivity.deleteThread(owner, argument)
        workflow.deleteThread(owner, argument)
        experience.deleteThread(owner, argument)
        daily.deleteThread(owner, argument)
        workbench.deleteThread(owner, argument)
        conversations.reset(`${owner}:${argument}`)
        await uiReply(ctx, 'Conversation and its history deleted.')
        break
      case 'remember':
        profiles.remember(owner, argument)
        await uiReply(ctx, 'Saved. Use /memory to view or /forget to remove.')
        break
      case 'memory': {
        const notes = profiles.get(owner).memories
        for (const chunk of splitReply(
          notes.length
            ? notes.map((note, index) => `${index + 1}. ${note}`).join('\n')
            : 'No saved notes.'
        ))
          await uiReply(ctx, chunk)
        break
      }
      case 'forget':
        profiles.forget(owner, argument)
        await uiReply(
          ctx,
          'Saved memory removed. Previous conversation content is unchanged; /reset clears it.'
        )
        break
      case 'voice':
        profiles.voice(owner, argument)
        await uiReply(ctx, `Voice replies: ${argument}. Voice is AI-generated.`)
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
    if (isImage)
      return {
        image: await downloadImage(
          url,
          maxBytes,
          remaining,
          undefined,
          controls.current(ownerFor(ctx))?.signal
        )
      }
    return {
      document: await downloadDocument(
        url,
        'file_name' in file ? file.file_name : 'document',
        maxBytes,
        remaining,
        undefined,
        controls.current(ownerFor(ctx))?.signal
      )
    }
  }
  const quoted = (ctx: Context): string => {
    const message = ctx.message
    const reply =
      message && 'reply_to_message' in message
        ? message.reply_to_message
        : undefined
    if (!reply || !('text' in reply)) return ''
    if (reply.from?.id !== ctx.botInfo.id) return ''
    const fragment =
      message && 'quote' in message && message.quote
        ? message.quote.text
        : undefined
    return workflow.quoted(
      ownerFor(ctx),
      profiles.get(ownerFor(ctx)).active,
      reply.message_id,
      conversations
        .history(sessionFor(ctx))
        .flatMap(item => (item.id ? [item.id] : [])),
      fragment
    )
  }
  const workflowContext = (ctx: Context): WorkflowContext => {
    const owner = ownerFor(ctx),
      thread = profiles.get(owner).active
    return {
      owner,
      thread,
      text: async (value, keyboard) => {
        for (const chunk of splitReply(value))
          await uiReply(ctx, chunk, keyboard ? { reply_markup: keyboard } : {})
      },
      file: async (bytes, name) => {
        await ctx.replyWithDocument(Input.fromBuffer(Buffer.from(bytes), name))
      },
      document: async () => {
        const msg = ctx.message
        return msg && 'reply_to_message' in msg && msg.reply_to_message
          ? (await readAttachment(ctx, msg.reply_to_message)).document
          : undefined
      },
      quote: () => {
        const specific = quoted(ctx)
        if (specific) return specific
        const msg = ctx.message,
          reply =
            msg && 'reply_to_message' in msg ? msg.reply_to_message : undefined
        if (!reply || !('text' in reply))
          throw new UserError('Reply to a text message with /task fromreply.')
        return `Quoted message:\n${reply.text}`
      },
      input: prompt => frozenInput(owner, thread, prompt),
      imported: () => {
        profiles.forgetOwner(owner)
        workspaces.refresh(owner)
        productivity.refresh(owner)
        library.refresh(owner)
        workflow.refresh(owner)
        experience.refresh(owner)
        daily.refresh(owner)
        workbench.refresh(owner)
        conversations.refresh()
        controls.clear(owner, false)
      }
    }
  }
  const productivityContext = (ctx: Context): ProductivityContext => {
    const owner = ownerFor(ctx),
      thread = profiles.get(owner).active
    return {
      owner,
      thread,
      text: async (value, keyboard) => {
        for (const chunk of splitReply(value))
          await uiReply(ctx, chunk, keyboard ? { reply_markup: keyboard } : {})
      },
      repliedDocument: async () => {
        const msg = ctx.message
        return msg && 'reply_to_message' in msg && msg.reply_to_message
          ? (await readAttachment(ctx, msg.reply_to_message)).document
          : undefined
      },
      prepare: prompt => {
        const selected = profiles.get(owner).active
        const input = frozenInput(owner, selected, prompt)
        // History already carries retained attachments; current/project references are explicit.
        return {
          prompt,
          images: [],
          documents: workspaces.project(owner, selected)?.documents ?? [],
          memories: input.memories,
          instructions: [
            input.instructions,
            workflow.terms(owner, workspaces.thread(owner, selected).project),
            answerPreference(owner, selected)
          ]
            .filter(Boolean)
            .join('\n\n'),
          summary: conversations.recap(`${owner}:${selected}`),
          history: conversations.history(`${owner}:${selected}`),
          references: quoted(ctx),
          analysisOnly: false
        }
      }
    }
  }
  const experienceContext = (ctx: Context): ExperienceContext => {
    const base = workflowContext(ctx)
    return {
      owner: base.owner,
      thread: base.thread,
      quote: () => base.quote(),
      prepare: prompt => productivityContext(ctx).prepare(prompt),
      flush: () =>
        experience.flush(
          base.owner,
          workspaces.get(base.owner).timezone,
          items => deliverDigest(base.owner, items),
          true
        ),
      text: async (value, keyboard, raw) => {
        for (const chunk of splitReply(value))
          if (raw)
            await ctx.reply(
              chunk,
              keyboard
                ? {
                    reply_markup: translateKeyboard(
                      keyboard,
                      languageFor(base.owner)
                    )
                  }
                : {}
            )
          else
            await uiReply(
              ctx,
              chunk,
              keyboard ? { reply_markup: keyboard } : {}
            )
      }
    }
  }
  const dailyContext = (ctx: Context): DailyContext => {
    const base = experienceContext(ctx)
    return {
      owner: base.owner,
      thread: base.thread,
      text: (value, keyboard, raw) => base.text(value, keyboard, raw),
      prepare: prompt => productivityContext(ctx).prepare(prompt),
      review: request => advanced.review(productivityContext(ctx), request),
      article: url => article(url, controls.current(base.owner)!.signal)
    }
  }
  const providerContext = (
    ctx: Context,
    currentDocuments: Document[] = []
  ): WorkbenchContext => {
    const base = experienceContext(ctx),
      owner = base.owner
    return {
      owner,
      thread: base.thread,
      signal: controls.current(owner)!.signal,
      text: (value, keyboard, raw) => base.text(value, keyboard, raw),
      prepare: prompt => {
        const request = productivityContext(ctx).prepare(prompt)
        request.documents.push(...currentDocuments)
        return request
      },
      file: (bytes, name) =>
        ctx
          .replyWithDocument(Input.fromBuffer(Buffer.from(bytes), name))
          .then(() => undefined),
      document: () =>
        currentDocuments.length
          ? Promise.resolve(currentDocuments[0])
          : workflowContext(ctx).document(),
      recording: () => {
        const message = ctx.message,
          source =
            message && 'reply_to_message' in message
              ? message.reply_to_message
              : undefined
        return recordingMeta(source ?? message)
      },
      liveButton: (url, text) =>
        uiReply(ctx, text, {
          reply_markup: {
            inline_keyboard: [[{ text: 'Open live voice', web_app: { url } }]]
          }
        }).then(() => undefined),
      transcribe: async (file, diarize) => {
        const { url, remaining } = await fileLink(
          ctx,
          file.file,
          config.requestTimeoutMs
        )
        const bytes = await downloadTelegramFile(
          url,
          config.workbench.meetingBytes,
          remaining,
          fetch,
          'Recording',
          controls.current(owner)!.signal
        )
        const audio = meetingAudio(bytes, file.name)
        const seconds = file.seconds ?? config.workbench.meetingSeconds
        const reservation = usage.reserve(
          owner,
          'transcription',
          false,
          workspaces.thread(owner, profiles.get(owner).active).project,
          Math.ceil(seconds / 60) * config.workbench.estimateMeetingMinute
        )
        try {
          const result = await workbench
            .port()
            .meeting(
              bytes,
              audio.name,
              audio.mime,
              diarize,
              controls.current(owner)!.signal
            )
          reservation.finish()
          return result
        } catch (error) {
          reservation.fail()
          throw error
        }
      }
    }
  }
  const respond = async (
    ctx: Context,
    text: string,
    images: Image[] = [],
    documents: Document[] = [],
    voiceInput = false,
    prepared?: PreparedRequest
  ): Promise<void> => {
    ctx.state.rawUI =
      /^\/(memory|templates|template\s+show|collect\s+show|context\s+show|library\s+find|find)(?:\s|$)/.test(
        text
      )
    if (
      !prepared &&
      /^\/(pro|analyze|knowledge|connections|connect|meeting|live|cloud_cleanup)(?:@\w+)?(?:\s|$)/i.test(
        text
      )
    ) {
      const result = await providerCommands.handle(
        providerContext(ctx, documents),
        text
      )
      if (result === true) return
      if (result !== false) {
        prepared = result
        text = result.prompt
        images = result.images
        documents = result.documents
      }
    }
    if (!prepared) {
      const context = dailyContext(ctx)
      const result =
        !text.startsWith('/') && !/^https:\/\//i.test(text.trim())
          ? dailyCommands.pending(
              context,
              text || 'Process the attached content.'
            )
          : null
      if (result) {
        result.images = images
        result.documents = [...result.documents, ...documents]
        prepared = result
        text = result.prompt
        documents = result.documents
      } else if (!images.length && !documents.length) {
        const handled = await dailyCommands.handle(context, text)
        if (handled === true) return
        if (handled !== false) {
          prepared = handled
          text = handled.prompt
          images = handled.images
          documents = handled.documents
        }
      }
    }
    if (!prepared && !images.length && !documents.length) {
      const experienceResult = await experienceCommands.handle(
        experienceContext(ctx),
        text
      )
      if (experienceResult === true) return
      if (experienceResult !== false) {
        prepared = experienceResult
        text = prepared.prompt
        images = prepared.images
        documents = prepared.documents
      }
      if (!prepared && (await flowCommands.handle(workflowContext(ctx), text)))
        return
      if (!prepared && (await manage(ctx, text))) return
      const selected = profiles.get(ownerFor(ctx)).active
      const result = prepared
        ? false
        : await advanced.handle(productivityContext(ctx), text)
      if (profiles.get(ownerFor(ctx)).active !== selected) {
        if (controls.current(ownerFor(ctx))!.signal.aborted)
          throw new UserError('Request stopped.')
        controls.end(ownerFor(ctx))
        ctx.state.request = controls.begin(
          ownerFor(ctx),
          profiles.get(ownerFor(ctx)).active
        )
      }
      if (result === true) return
      if (result !== false) {
        prepared = result
        text = result.prompt
        images = result.images
        documents = result.documents
      }
    }
    const owner = ownerFor(ctx)
    const thread = profiles.get(owner).active
    const message = ctx.message
    const repliedMessage =
      message && 'reply_to_message' in message
        ? message.reply_to_message
        : undefined
    const commandContext = {
      owner,
      thread,
      extras: {
        data: () => ({
          productivity: productivity.get(owner),
          library: library.get(owner),
          workflow: workflow.get(owner),
          experience: experience.get(owner),
          daily: daily.get(owner),
          workbench: workbench.get(owner),
          providerCleanup: workbench.journal.entries(owner)
        }),
        erase: () => {
          productivity.erase(owner)
          library.erase(owner)
          workflow.erase(owner)
          experience.erase(owner)
          daily.erase(owner)
          workbench.erase(owner)
        },
        deleteProject: (id: string) => {
          library.deleteProject(owner, id)
          workflow.deleteProject(owner, id)
          if (workbench.get(owner).projects[id]) workbench.clear(owner, id)
        }
      },
      text: async (value: string) => {
        for (const chunk of splitReply(value)) await uiReply(ctx, chunk)
      },
      file: async (bytes: Uint8Array, name: string) => {
        await ctx.replyWithDocument(Input.fromBuffer(Buffer.from(bytes), name))
      },
      repliedDocument: async () =>
        repliedMessage
          ? (await readAttachment(ctx, repliedMessage)).document
          : undefined,
      input: (prompt: string) =>
        frozenInput(owner, thread, prompt, images, documents)
    }
    if (!prepared && /^\/erase(?:@\w+)?\s+confirm$/.test(text.trim()))
      for (const entry of workbench.journal
        .entries(owner)
        .filter(item => item.kind === 'call'))
        await live.close(owner, entry.id).catch(() => undefined)
    const handled = prepared ? false : await pro.handle(commandContext, text)
    if (handled === true) return
    const analysisOnly = prepared?.analysisOnly ?? handled !== false
    if (handled !== false) {
      text = handled.prompt
      images = handled.images
      documents = handled.documents
    }
    const command = prepared?.structured
      ? null
      : text.match(/^\/(image|edit|search)(?:@\w+)?(?:\s+|$)/i)
    const action =
      command?.[1]?.toLowerCase() === 'image'
        ? 'generate'
        : command?.[1]?.toLowerCase() === 'edit'
          ? 'edit'
          : 'auto'
    const prompt = command ? text.slice(command[0].length).trim() : text
    if (command && !prompt)
      throw new UserError(`Usage: /${command[1]} description`)
    if (!command && text.startsWith('/') && !prepared?.structured) {
      await uiReply(ctx, 'Unknown command. Use /help.')
      return
    }
    const msg = ctx.message
    if (
      !prepared &&
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
    const settings = workspaces.thread(owner, thread)
    if (
      !prepared &&
      settings.imageVersion &&
      !images.length &&
      action === 'edit'
    ) {
      const version = conversations
        .versions(sessionFor(ctx))
        .find(item => item.id === settings.imageVersion)
      if (!version)
        throw new UserError(
          'Selected image source has expired. Use /versions or attach the image again.'
        )
      images.push(version.image)
    }
    const project = workspaces.project(owner, thread)
    const combined = [
      ...(prepared ? [] : (project?.documents ?? [])),
      ...documents
    ]
    documents = combined.filter(
      (file, index) =>
        !combined
          .slice(index + 1)
          .some(next => next.name === file.name && next.data === file.data)
    )
    const session = sessionFor(ctx)
    const expected = ctx.state.responseRevision as
      { value: string | undefined } | undefined
    if (
      expected &&
      conversations.history(session).at(-1)?.id !== expected.value
    )
      throw new UserError(
        'This response control is stale. The conversation changed while processing it.'
      )
    if (sessionLocks.has(session))
      throw new UserError(
        'This conversation has a background request running. Switch conversations or cancel its job.'
      )
    const quoteReference = quoted(ctx)
    if (
      (prepared?.workbench ||
        settings.reviewContext ||
        (config.confirmExpensiveRequests && action !== 'auto')) &&
      !ctx.state.contextApproved
    ) {
      await advanced.review(
        productivityContext(ctx),
        prepared ?? {
          prompt: text,
          images,
          documents,
          memories: [
            ...profiles.get(owner).memories,
            ...(project?.notes ?? [])
          ],
          instructions: [
            workspaces.instructions(owner, thread),
            workflow.terms(owner, project?.id ?? null),
            answerPreference(owner, thread)
          ]
            .filter(Boolean)
            .join('\n\n'),
          summary: conversations.recap(session),
          history: conversations.history(session),
          references: quoteReference,
          analysisOnly
        }
      )
      return
    }
    if (prepared?.workbench)
      workbench.preflight(owner, thread, prepared.workbench, documents)
    sessionLocks.add(session)
    const current = controls.current(owner)!
    const signalProgress = () =>
      ctx
        .sendChatAction(action === 'auto' ? 'typing' : 'upload_photo')
        .catch(() => undefined)
    await signalProgress()
    const progress = setInterval(() => {
      void signalProgress()
    }, 4000)
    progress.unref()
    let reservation: ReturnType<UsageLedger['reserve']> | undefined
    let preview: number | undefined
    let partial = ''
    let lastUpdate = 0
    try {
      if (config.streamResponses) {
        const message = await uiReply(ctx, 'Working…', {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Stop', callback_data: `request:stop:${current.token}` }]
            ]
          }
        })
        preview = message.message_id
      }
      const options: ReplyOptions = {
        action,
        signal: current.signal,
        ...(command?.[1]?.toLowerCase() === 'search' ? { search: true } : {}),
        memories: prepared?.memories ?? [
          ...profiles.get(owner).memories,
          ...(project?.notes ?? [])
        ],
        documents,
        instructions:
          prepared?.instructions ??
          [
            workspaces.instructions(owner, thread),
            workflow.terms(owner, project?.id ?? null),
            answerPreference(owner, thread)
          ]
            .filter(Boolean)
            .join('\n\n'),
        ...(prepared
          ? {
              contextHistory: prepared.history,
              references: prepared.references,
              summary: prepared.summary ?? '',
              ...(prepared.evidence ? { evidence: prepared.evidence } : {}),
              ...(prepared.workbench
                ? {
                    workbench: prepared.workbench,
                    scope: {
                      owner,
                      thread,
                      project: prepared.workbench.project
                    }
                  }
                : {}),
              ...(prepared.structured
                ? { structured: prepared.structured }
                : {})
            }
          : {}),
        ...(!prepared && quoteReference ? { references: quoteReference } : {}),
        ...(settings.model ? { chatModel: settings.model } : {}),
        imageQuality: settings.quality,
        imageSize: settings.size,
        ...(settings.retentionSeconds !== null
          ? { retentionSeconds: settings.retentionSeconds }
          : {}),
        ...(preview !== undefined &&
        !prepared?.structured &&
        !prepared?.workbench
          ? {
              onText: async (delta: string) => {
                partial += delta
                if (Date.now() - lastUpdate < 1000) return
                lastUpdate = Date.now()
                await ctx.telegram
                  .editMessageText(
                    ctx.chat!.id,
                    preview,
                    undefined,
                    splitReply(partial)[0] || 'Working…'
                  )
                  .catch(() => undefined)
              }
            }
          : {}),
        onStart: () => {
          reservation = usage.reserve(
            owner,
            analysisOnly
              ? 'chat'
              : action === 'generate'
                ? 'image'
                : action === 'edit'
                  ? 'image'
                  : command?.[1]?.toLowerCase() === 'search'
                    ? 'search'
                    : 'auto',
            !config.confirmExpensiveRequests || action !== 'auto',
            settings.project,
            prepared?.workbench ? workbench.estimate(prepared.workbench) : 0
          )
          Object.assign(options, reservation.options)
        }
      }
      const answer = await conversations.respond(
        session,
        prompt ||
          (documents.length
            ? 'Summarize these documents and describe what questions you can answer about them.'
            : 'Describe this image and offer ways to work with it.'),
        images,
        options
      )
      reservation!.finish(
        answer.toolsUsed ?? {
          images: answer.images.length,
          searches: answer.sources?.length ? 1 : 0
        }
      )
      const token = controls.complete(
        owner,
        thread,
        conversations.history(session).at(-1)?.id
      )
      const revision = conversations.history(session).at(-1)?.id
      const rememberDelivery = (message: number, text: string) => {
        if (revision) workflow.quote(owner, message, thread, revision, text)
      }
      if (answer.approval) {
        await providerCommands.approval(providerContext(ctx), answer.approval)
        if (preview !== undefined)
          await ctx.telegram
            .editMessageText(
              ctx.chat!.id,
              preview,
              undefined,
              'External actions are ready for review below.'
            )
            .catch(() => undefined)
        return
      }
      if (prepared?.reviewTasks && answer.artifact) {
        await dailyCommands.taskReview(
          dailyContext(ctx),
          Buffer.from(answer.artifact.data, 'base64').toString('utf8')
        )
        if (preview !== undefined)
          await ctx.telegram
            .editMessageText(
              ctx.chat!.id,
              preview,
              undefined,
              translate(
                'Task proposals are ready for review below.',
                languageFor(owner)
              )
            )
            .catch(() => undefined)
        return
      }
      const rawMarkup = controls.buttons(token, answer.images.length > 0)
      if (revision) {
        rawMarkup.inline_keyboard.push(
          ...dailyCommands.answerButtons(
            revision,
            images.length > 0 || answer.images.length > 0,
            documents.length > 0,
            documents.length > 1
          )
        )
        rawMarkup.inline_keyboard.push([
          {
            text: 'Save answer',
            callback_data: `bookmark:answer:${referenceId(revision)}`
          }
        ])
        for (const [index, card] of (answer.evidence ?? []).entries())
          rawMarkup.inline_keyboard.push([
            {
              text: `[${card.label}] ${card.title.slice(0, 45)}`,
              callback_data: `card:${referenceId(revision)}:${index}`
            }
          ])
      }
      const markup = translateKeyboard(rawMarkup, languageFor(owner))
      const chunks = splitReply(
        answer.artifact
          ? translate(answer.text, languageFor(owner))
          : answer.text
      )
      if (preview !== undefined) {
        const first = chunks.shift() || 'Image ready.'
        await ctx.telegram
          .editMessageText(ctx.chat!.id, preview, undefined, first, {
            reply_markup: markup
          })
          .then(() => rememberDelivery(preview!, first))
          .catch(async () => {
            const delivered = await ctx.reply(first, { reply_markup: markup })
            rememberDelivery(delivered.message_id, first)
          })
      }
      for (const chunk of chunks) {
        const delivered = await ctx.reply(chunk, { reply_markup: markup })
        rememberDelivery(delivered.message_id, chunk)
      }
      for (const chunk of splitReply(formatSources(answer.sources)))
        await ctx.reply(chunk)
      for (const image of answer.images)
        await ctx.replyWithDocument(
          Input.fromBuffer(Buffer.from(image.data, 'base64'), 'image.png'),
          { reply_markup: markup }
        )
      if (answer.artifact)
        await ctx.replyWithDocument(
          Input.fromBuffer(
            Buffer.from(answer.artifact.data, 'base64'),
            answer.artifact.name
          )
        )
      for (const file of answer.files ?? [])
        await ctx.replyWithDocument(
          Input.fromBuffer(Buffer.from(file.data, 'base64'), file.name)
        )
      if (answer.images.length)
        workspaces.configure(owner, thread, { imageVersion: null })
      const voice = profiles.get(ownerFor(ctx)).voice
      if (
        !answer.artifact &&
        answer.text &&
        (voice === 'on' || (voice === 'auto' && voiceInput))
      ) {
        try {
          await speak(ctx, answer.text)
        } catch (error) {
          if (!(error instanceof UserError)) reportError()
          await uiReply(
            ctx,
            error instanceof UserError
              ? error.message
              : 'Voice output failed. The text answer above is available; use /speak to retry.'
          )
        }
      }
    } catch (error) {
      reservation?.fail()
      if (preview !== undefined)
        await ctx.telegram
          .editMessageText(
            ctx.chat!.id,
            preview,
            undefined,
            current.signal.aborted
              ? 'Stopped.'
              : 'Unable to complete this response.'
          )
          .catch(() => undefined)
      throw error
    } finally {
      sessionLocks.delete(session)
      clearInterval(progress)
    }
  }
  bot.on('callback_query', async ctx => {
    if (!('data' in ctx.callbackQuery)) {
      await ctx.answerCbQuery('Unsupported control.')
      return
    }
    if (ctx.callbackQuery.data.startsWith('provider:')) {
      const result = await providerCommands.callback(
        providerContext(ctx),
        ctx.callbackQuery.data
      )
      await ctx.answerCbQuery()
      if (result !== true && result !== false) {
        ctx.state.contextApproved = true
        await respond(
          ctx,
          result.prompt,
          result.images,
          result.documents,
          false,
          result
        )
      }
      return
    }
    if (
      ctx.callbackQuery.data.startsWith('daily:') ||
      ctx.callbackQuery.data.startsWith('act:')
    ) {
      const result = ctx.callbackQuery.data.startsWith('act:')
        ? dailyCommands.action(dailyContext(ctx), ctx.callbackQuery.data)
        : await dailyCommands.callback(
            dailyContext(ctx),
            ctx.callbackQuery.data
          )
      await ctx.answerCbQuery()
      if (result !== true && result !== false) {
        await respond(
          ctx,
          result.prompt,
          result.images,
          result.documents,
          false,
          result
        )
      }
      return
    }
    if (
      await experienceCommands.callback(
        experienceContext(ctx),
        ctx.callbackQuery.data
      )
    ) {
      await ctx.answerCbQuery()
      return
    }
    if (
      await flowCommands.callback(workflowContext(ctx), ctx.callbackQuery.data)
    ) {
      await ctx.answerCbQuery()
      return
    }
    if (
      ctx.callbackQuery.data.startsWith('menu:') ||
      ctx.callbackQuery.data.startsWith('context:')
    ) {
      await ctx.answerCbQuery()
      const capturedRevision = conversations.history(sessionFor(ctx)).at(-1)?.id
      const result = await advanced.callback(
        productivityContext(ctx),
        ctx.callbackQuery.data
      )
      if (result !== true && result !== false) {
        ctx.state.contextApproved = true
        ctx.state.responseRevision = { value: capturedRevision }
        await respond(
          ctx,
          result.prompt,
          result.images,
          result.documents,
          false,
          result
        )
      }
      return
    }
    const [scope, action, ...rest] = ctx.callbackQuery.data.split(':')
    const owner = ownerFor(ctx)
    const thread = profiles.get(owner).active
    if (scope === 'setting') {
      const value = rest.shift()!
      controls.validate(
        owner,
        thread,
        rest.join(':'),
        conversations.history(sessionFor(ctx)).at(-1)?.id
      )
      if (action === 'quality')
        workspaces.configure(owner, thread, { quality: value as 'high' })
      else if (action === 'size')
        workspaces.configure(owner, thread, { size: value as 'auto' })
      else throw new UserError('Unknown image setting.')
      await ctx.answerCbQuery('Image setting updated.')
      return
    }
    if (scope === 'feedback') {
      const revision = conversations.history(sessionFor(ctx)).at(-1)?.id
      controls.validate(owner, thread, rest.join(':'), revision)
      if (!revision) throw new UserError('This answer is no longer retained.')
      productivity.feedback(owner, thread, revision, 'down', action!)
      await ctx.answerCbQuery('Feedback saved.')
      return
    }
    if (scope !== 'response') {
      await ctx.answerCbQuery('Unknown control.')
      return
    }
    await ctx.answerCbQuery()
    const revision = conversations.history(sessionFor(ctx)).at(-1)?.id
    controls.validate(owner, thread, rest.join(':'), revision)
    ctx.state.responseRevision = { value: revision }
    if (action === 'up' || action === 'down') {
      if (!revision) throw new UserError('This answer is no longer retained.')
      if (action === 'down') {
        await uiReply(ctx, 'What should improve?', {
          reply_markup: {
            inline_keyboard: [
              'incorrect',
              'too_long',
              'lost_context',
              'other'
            ].map(reason => [
              {
                text: reason.replace('_', ' '),
                callback_data: `feedback:${reason}:${rest.join(':')}`
              }
            ])
          }
        })
      } else {
        productivity.feedback(owner, thread, revision, 'up', 'helpful')
        await uiReply(ctx, 'Feedback saved. No provider call was made.')
      }
      return
    }
    if (action === 'speak') {
      await speak(ctx, conversations.lastReply(sessionFor(ctx)) || '')
      return
    }
    const history = conversations.history(sessionFor(ctx))
    if (action === 'retry') {
      const request = history.findLast(message => message.role === 'user')
      if (!request)
        throw new UserError('Original request is no longer retained.')
      await respond(ctx, request.content, request.images, request.documents)
      return
    }
    if (action === 'shorter' || action === 'more') {
      await respond(
        ctx,
        action === 'shorter'
          ? 'Rewrite your last answer more concisely, preserving the important facts and sources.'
          : 'Expand your last answer with useful detail, examples and explicit uncertainty.'
      )
      return
    }
    if (action === 'variation' || action === 'previous') {
      const versions = conversations.versions(sessionFor(ctx))
      const selected = workspaces.thread(owner, thread).imageVersion
      const index = selected
        ? versions.findIndex(version => version.id === selected)
        : versions.length - 1
      const version = versions[action === 'previous' ? index - 1 : index]
      if (!version)
        throw new UserError(
          'No retained image version is available for this action.'
        )
      if (action === 'previous') {
        workspaces.configure(owner, thread, { imageVersion: version.id })
        await uiReply(ctx, `Selected source ${version.id} for the next edit.`)
      } else
        await respond(
          ctx,
          '/image Create a new variation of this reference image while preserving its subject.',
          [version.image]
        )
      return
    }
    throw new UserError('Unknown response action.')
  })
  bot.on(message('text'), async ctx => {
    await respond(ctx, ctx.message.text)
  })
  bot.on([message('photo'), message('document')], async ctx => {
    if (
      'caption' in ctx.message &&
      /^\/meeting(?:@\w+)?(?:\s|$)/i.test(ctx.message.caption ?? '')
    ) {
      await respond(ctx, ctx.message.caption)
      return
    }
    if (recordingMeta(ctx.message)) {
      await uiReply(
        ctx,
        'Recording received. Reply to it with /meeting or /meeting speakers to review transcription and protocol processing.'
      )
      return
    }
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
  bot.on(message('audio'), async ctx => {
    if (/^\/meeting(?:@\w+)?(?:\s|$)/i.test(ctx.message.caption ?? ''))
      await respond(ctx, ctx.message.caption!)
    else
      await uiReply(
        ctx,
        'Recording received. Reply to it with /meeting or /meeting speakers to review transcription and protocol processing.'
      )
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
    const transcription = usage.reserve(
      ownerFor(ctx),
      'transcription',
      true,
      workspaces.thread(ownerFor(ctx), profiles.get(ownerFor(ctx)).active)
        .project
    )
    let text: string
    try {
      text = await model.transcribe(
        audio,
        controls.current(ownerFor(ctx))?.signal,
        workflow
          .terms(
            ownerFor(ctx),
            workspaces.thread(ownerFor(ctx), profiles.get(ownerFor(ctx)).active)
              .project
          )
          .slice(0, 800)
      )
      transcription.finish()
    } catch (error) {
      transcription.fail()
      throw error
    }
    if (!text.trim() || text.length > config.maxInputCharacters)
      throw new UserError(
        'Transcription is empty or too long. Send a shorter voice message.'
      )
    for (const chunk of splitReply(`Transcript: ${text}`))
      await uiReply(ctx, chunk)
    const prepared = daily.get(ownerFor(ctx)).notes
      ? dailyCommands.taskRequest(dailyContext(ctx), text)
      : undefined
    await respond(
      ctx,
      prepared ? prepared.prompt : text,
      [],
      [],
      true,
      prepared
    )
  })
  bot.catch(async (error, ctx) => {
    // SDK/network errors can contain credentials, URLs, prompts, and transcripts.
    const stopped = (ctx.state.request as { signal: AbortSignal } | undefined)
      ?.signal.aborted
    if (!stopped && !(error instanceof UserError)) reportError()
    await uiReply(
      ctx,
      stopped
        ? 'Request stopped. Already-started work may still be billed.'
        : error instanceof UserError
          ? error.message
          : 'Unable to process your message. Please try again.'
    ).catch(() => {
      reportError()
    })
  })
  return bot
}
