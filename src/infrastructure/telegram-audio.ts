import { downloadTelegramFile } from './telegram-file.js'

export async function downloadTelegramAudio(
  url: URL,
  maxBytes: number,
  timeoutMs: number,
  fetcher: typeof fetch = fetch
): Promise<Uint8Array> {
  return downloadTelegramFile(
    url,
    maxBytes,
    timeoutMs,
    fetcher,
    'Voice message'
  )
}
