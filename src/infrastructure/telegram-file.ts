import { UserError } from '../domain/conversation.js'

export async function downloadTelegramFile(
  url: URL,
  maxBytes: number,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
  label = 'File'
): Promise<Uint8Array> {
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'api.telegram.org' ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.startsWith('/file/bot')
  ) {
    throw new Error('Invalid Telegram file URL')
  }
  const response = await fetcher(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('File download failed')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    if (Number(response.headers.get('content-length')) > maxBytes) {
      throw new UserError(`${label} is too large.`)
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new UserError(`${label} is too large.`)
      chunks.push(value)
    }
    if (size === 0) throw new UserError(`${label} is empty.`)
    return Buffer.concat(chunks, size)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
