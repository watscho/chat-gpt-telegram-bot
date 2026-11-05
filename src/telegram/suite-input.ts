import type { Message } from 'telegraf/types'
import type { VideoReference } from '../domain/suite.js'
export function suiteMessage(
  message: Message | undefined,
  replyOnly = false
): Message | undefined {
  return message && 'reply_to_message' in message
    ? message.reply_to_message
    : replyOnly
      ? undefined
      : message
}
export function suiteVideo(
  message: Message | undefined
): VideoReference | undefined {
  if (!message) return undefined
  const file =
    'video' in message
      ? message.video
      : 'document' in message &&
          (/^video\//.test(message.document.mime_type ?? '') ||
            /\.(mp4|mov|webm)$/i.test(message.document.file_name ?? ''))
        ? message.document
        : undefined
  if (!file) return undefined
  return {
    file: file.file_id,
    name: file.file_name ?? 'recording.mp4',
    bytes: file.file_size ?? null,
    seconds:
      'duration' in file && typeof file.duration === 'number'
        ? file.duration
        : null,
    start: 0,
    audio: false
  }
}
