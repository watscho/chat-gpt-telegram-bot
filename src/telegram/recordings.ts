import type { Message } from 'telegraf/types'
import type { Recording } from '../domain/workbench.js'
export function recordingMeta(
  message: Message | undefined
): Recording | undefined {
  if (!message) return undefined
  if ('voice' in message)
    return {
      file: message.voice.file_id,
      name: 'voice.ogg',
      mime: message.voice.mime_type ?? 'audio/ogg',
      bytes: message.voice.file_size ?? null,
      seconds: message.voice.duration
    }
  if ('audio' in message)
    return {
      file: message.audio.file_id,
      name: message.audio.file_name ?? 'recording.mp3',
      mime: message.audio.mime_type ?? 'audio/mpeg',
      bytes: message.audio.file_size ?? null,
      seconds: message.audio.duration
    }
  if (
    'document' in message &&
    /\.(mp3|m4a|mp4|wav|ogg|webm)$/i.test(message.document.file_name ?? '')
  )
    return {
      file: message.document.file_id,
      name: message.document.file_name!,
      mime: message.document.mime_type ?? 'application/octet-stream',
      bytes: message.document.file_size ?? null,
      seconds: null
    }
  return undefined
}
