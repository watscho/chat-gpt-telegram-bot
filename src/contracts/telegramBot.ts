import { ChatCompletionRequestMessage } from 'openai'
import { Context } from 'telegraf'
import type { Update } from 'telegraf/types'

export interface MyContext<U extends Update = Update> extends Context<U> {
  session: {
    messages: ChatCompletionRequestMessage[]
  }
}
