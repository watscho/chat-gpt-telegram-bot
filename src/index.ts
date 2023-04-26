import 'dotenv/config'

import { TelegramBot } from './infrastructure'

const bot = new TelegramBot()

bot.commandStart()
bot.onMessageVoice()
bot.onMessageText()

bot.runBot()
