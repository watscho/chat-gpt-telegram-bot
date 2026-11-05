import type { Image } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import { downloadTelegramFile } from './telegram-file.js'

export function imageFromBytes(bytes: Uint8Array, maxBytes: number): Image {
  if (!bytes.length || bytes.length > maxBytes)
    throw new UserError('Image is empty or exceeds the configured size limit.')
  const b = Buffer.from(bytes)
  const mime = b
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'image/png'
    : b[0] === 255 && b[1] === 216 && b[2] === 255
      ? 'image/jpeg'
      : b.toString('ascii', 0, 4) === 'RIFF' &&
          b.toString('ascii', 8, 12) === 'WEBP'
        ? 'image/webp'
        : undefined
  if (
    mime === 'image/webp' &&
    b.toString('ascii', 12, 16) === 'VP8X' &&
    (b[20] ?? 0) & 2
  )
    throw new UserError(
      'Animated images are not supported. Send a still image.'
    )
  if (!mime)
    throw new UserError(
      'Unsupported image. Send a JPEG, PNG or static WebP file.'
    )
  return { data: b.toString('base64'), mime }
}

export async function downloadTelegramImage(
  url: URL,
  maxBytes: number,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<Image> {
  return imageFromBytes(
    await downloadTelegramFile(
      url,
      maxBytes,
      timeoutMs,
      fetcher,
      'Image',
      signal
    ),
    maxBytes
  )
}
