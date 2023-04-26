import { Telegraf, session } from 'telegraf'
import { code } from 'telegraf/format'
import { message } from 'telegraf/filters'
import { ChatCompletionRequestMessageRoleEnum } from 'openai'

import { INITIAL_SESSION } from '@/constants'
import { MyContext } from '@/contracts/telegramBot'
import { OggDownloader } from './oggDownloader'
import { OggConverter } from './oggConverter'
import { OpenAI } from './openAi'

export class TelegramBot {
  private bot: Telegraf<MyContext>

  public constructor() {
    this.bot = new Telegraf<MyContext>(process.env.TELEGRAM_API_KEY)

    this.useSession()
  }

  public runBot() {
    this.bot.launch()
  }

  public commandStart() {
    this.bot.command('start', async ctx => {
      ctx.session = INITIAL_SESSION

      await ctx.reply(code('The session has been reset.'))
    })
  }

  public onMessageVoice() {
    this.bot.on(message('voice'), async ctx => {
      try {
        ctx.session ??= INITIAL_SESSION

        await ctx.reply(code('...'))

        const url = await ctx.telegram.getFileLink(ctx.message.voice.file_id)
        const userId = String(ctx.message.from.id)

        const oggDownloader = new OggDownloader(url.href)

        const oggPath = await oggDownloader.download(userId)

        if (!oggPath) {
          oggDownloader.delete()
          throw new Error('Something went wrong please try again.')
        }

        const oggConverter = new OggConverter(oggPath)

        const mp3Path = await oggConverter.toMp3(userId)
        oggDownloader.delete()

        if (!mp3Path) {
          oggConverter.delete()
          throw new Error('Something went wrong please try again.')
        }

        const openAi = new OpenAI(mp3Path)

        const { text } = await openAi.transcription()

        await ctx.reply(code(`Request: ${text}`))

        oggConverter.delete()

        ctx.session.messages.push({
          role: openAi.roles.User as ChatCompletionRequestMessageRoleEnum,
          content: text
        })

        const response = await openAi.chat(ctx.session.messages)

        if (!response) {
          throw new Error('Something went wrong please try again.')
        }

        ctx.session.messages.push({
          role: openAi.roles.Assistant as ChatCompletionRequestMessageRoleEnum,
          content: response.content
        })

        await ctx.reply(response.content)
      } catch (error) {
        if (error instanceof Error) {
          return await ctx.reply(error.message)
        }
      }
    })
  }

  public onMessageText() {
    this.bot.on(message('text'), async ctx => {
      try {
        ctx.session ??= INITIAL_SESSION

        await ctx.reply(code('...'))

        const openAi = new OpenAI()

        ctx.session.messages.push({
          role: openAi.roles.User as ChatCompletionRequestMessageRoleEnum,
          content: ctx.message.text
        })

        const response = await openAi.chat(ctx.session.messages)

        if (!response) {
          throw new Error('Something went wrong please try again.')
        }

        ctx.session.messages.push({
          role: openAi.roles.Assistant as ChatCompletionRequestMessageRoleEnum,
          content: response.content
        })

        await ctx.reply(response.content)
      } catch (error) {
        if (error instanceof Error) {
          return await ctx.reply(error.message)
        }
      }
    })
  }

  private useSession() {
    this.bot.use(session())
  }
}
