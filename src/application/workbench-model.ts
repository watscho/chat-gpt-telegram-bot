import type {
  LanguageModel,
  Message,
  ModelReply,
  ReplyOptions
} from '../domain/conversation.js'
import type { Workbench } from './workbench.js'
export class WorkbenchModel implements LanguageModel {
  constructor(
    private readonly model: LanguageModel,
    private readonly workbench: Pick<Workbench, 'run'>
  ) {}
  reply(
    messages: readonly Message[],
    options: ReplyOptions = {}
  ): Promise<string | ModelReply> {
    return options.workbench
      ? this.workbench.run(messages, options)
      : this.model.reply(messages, options)
  }
  transcribe(
    audio: Uint8Array,
    signal?: AbortSignal,
    prompt?: string
  ): Promise<string> {
    return this.model.transcribe(audio, signal, prompt)
  }
}
