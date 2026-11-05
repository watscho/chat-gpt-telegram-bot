import { UserError } from '../domain/conversation.js'
export function meetingAudio(
  bytes: Uint8Array,
  name: string
): { name: string; mime: string } {
  const buffer = Buffer.from(bytes),
    extension = name.split('.').at(-1)!.toLowerCase()
  const ascii = (start: number, end: number) =>
    buffer.subarray(start, end).toString('ascii')
  const type =
    ascii(0, 4) === 'OggS'
      ? 'ogg'
      : ascii(0, 3) === 'ID3' ||
          (buffer[0] === 255 && (buffer[1]! & 224) === 224)
        ? 'mp3'
        : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE'
          ? 'wav'
          : ascii(4, 8) === 'ftyp'
            ? 'mp4'
            : buffer.subarray(0, 4).toString('hex') === '1a45dfa3'
              ? 'webm'
              : ''
  if (!type || !(type === extension || (type === 'mp4' && extension === 'm4a')))
    throw new UserError(
      'Recording signature does not match MP3, M4A/MP4, WAV, OGG or WebM audio.'
    )
  const mime: Record<string, string> = {
    ogg: 'audio/ogg',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'audio/mp4',
    webm: 'audio/webm'
  }
  return { name: name.split(/[\\/]/).at(-1)!.slice(-150), mime: mime[type]! }
}
