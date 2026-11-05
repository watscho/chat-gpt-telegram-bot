import { randomUUID } from 'node:crypto'
import { UserError } from '../domain/conversation.js'

export class ResponseControls {
  private readonly active = new Map<
    string,
    { token: string; thread: string; controller: AbortController }
  >()
  private readonly answers = new Map<
    string,
    { token: string; thread: string; revision: string | undefined }
  >()
  begin(owner: string, thread: string): { token: string; signal: AbortSignal } {
    if (this.active.has(owner))
      throw new UserError('A request is already running.')
    const request = {
      token: randomUUID(),
      thread,
      controller: new AbortController()
    }
    this.active.set(owner, request)
    return { token: request.token, signal: request.controller.signal }
  }
  current(owner: string): { token: string; signal: AbortSignal } | undefined {
    const request = this.active.get(owner)
    return request
      ? { token: request.token, signal: request.controller.signal }
      : undefined
  }
  stop(owner: string, token?: string): boolean {
    const request = this.active.get(owner)
    if (!request || (token !== undefined && token !== request.token))
      return false
    request.controller.abort()
    return true
  }
  complete(owner: string, thread: string, revision?: string): string {
    const request = this.active.get(owner)
    if (
      !request ||
      request.thread !== thread ||
      request.controller.signal.aborted
    )
      throw new UserError('Request stopped or conversation changed.')
    this.answers.set(owner, { token: request.token, thread, revision })
    return request.token
  }
  validate(
    owner: string,
    thread: string,
    token: string,
    revision?: string
  ): void {
    const answer = this.answers.get(owner)
    if (
      !answer ||
      answer.token !== token ||
      answer.thread !== thread ||
      answer.revision !== revision
    )
      throw new UserError(
        'This response control is stale. Select the original conversation and use its latest answer.'
      )
  }
  end(owner: string): void {
    this.active.delete(owner)
  }
  clear(owner: string, abort = true): void {
    if (abort) this.stop(owner)
    this.answers.delete(owner)
  }
  buttons(
    token: string,
    images = false
  ): {
    inline_keyboard: { text: string; callback_data: string }[][]
  } {
    return {
      inline_keyboard: [
        [
          { text: 'Helpful', callback_data: `response:up:${token}` },
          { text: 'Needs improvement', callback_data: `response:down:${token}` }
        ],
        [
          { text: 'Retry', callback_data: `response:retry:${token}` },
          { text: 'Shorter', callback_data: `response:shorter:${token}` }
        ],
        [
          { text: 'More detail', callback_data: `response:more:${token}` },
          { text: 'Read aloud', callback_data: `response:speak:${token}` }
        ],
        [
          { text: 'Variation', callback_data: `response:variation:${token}` },
          {
            text: 'Previous image',
            callback_data: `response:previous:${token}`
          }
        ],
        ...(images
          ? [
              [
                {
                  text: 'Square',
                  callback_data: `setting:size:1024x1024:${token}`
                },
                {
                  text: 'Landscape',
                  callback_data: `setting:size:1536x1024:${token}`
                },
                {
                  text: 'Portrait',
                  callback_data: `setting:size:1024x1536:${token}`
                }
              ],
              [
                {
                  text: 'High quality',
                  callback_data: `setting:quality:high:${token}`
                },
                {
                  text: 'Medium quality',
                  callback_data: `setting:quality:medium:${token}`
                }
              ]
            ]
          : [])
      ]
    }
  }
}
