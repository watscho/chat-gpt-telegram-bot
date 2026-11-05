import { UserError } from '../domain/conversation.js'
export async function oauthResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader)
    throw new UserError('Service authorization returned no response body.')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    if (!response.ok)
      throw new UserError('Service authorization failed. Reconnect explicitly.')
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      length += item.value.length
      if (length > 50000)
        throw new UserError('Service authorization response exceeds 50 KB.')
      chunks.push(item.value)
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks)
      )
    } catch {
      throw new UserError('Service authorization response must be valid UTF-8.')
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
