import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '../config.js'
import { UserError } from '../domain/conversation.js'
import type { VideoEvidence, VideoReference } from '../domain/suite.js'
import { imageFromBytes } from './images.js'
export class VideoExtractor {
  private active = false
  constructor(private readonly config: Config) {}
  private run(
    executable: string,
    args: string[],
    maxBytes: number,
    signal: AbortSignal
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      execFile(
        executable,
        args,
        {
          encoding: 'buffer',
          maxBuffer: maxBytes,
          timeout: this.config.requestTimeoutMs,
          killSignal: 'SIGKILL',
          signal,
          windowsHide: true
        },
        (error, stdout) => {
          if (error)
            reject(
              new UserError(
                'Media processing failed, timed out or exceeded its output bound. Check FFmpeg/ffprobe setup and the selected clip.'
              )
            )
          else if (stdout.length > maxBytes)
            reject(new UserError('Media output exceeds its byte limit.'))
          else resolve(stdout)
        }
      )
    })
  }
  async extract(
    bytes: Uint8Array,
    reference: VideoReference,
    signal: AbortSignal
  ): Promise<VideoEvidence> {
    if (this.active)
      throw new UserError(
        'A media extraction is already running. Try again later.'
      )
    const input = Buffer.from(bytes),
      movie = input.toString('ascii', 4, 8) === 'ftyp',
      webm = input.length >= 4 && input.readUInt32BE(0) === 0x1a45dfa3
    if (
      !input.length ||
      input.length > this.config.suite.videoBytes ||
      (!movie && !webm) ||
      !Number.isFinite(reference.start) ||
      reference.start < 0
    )
      throw new UserError(
        'Use a bounded MP4/MOV or WebM file and a nonnegative clip start.'
      )
    this.active = true
    let directory: string | undefined
    const abort = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.config.imageTimeoutMs)
    ])
    try {
      directory = await mkdtemp(join(tmpdir(), 'telegram-video-'))
      const path = join(directory, movie ? 'input.mp4' : 'input.webm')
      await writeFile(path, input, { flag: 'wx', mode: 0o600 })
      const policy = [
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        movie ? 'mov' : 'matroska,webm',
        '-f',
        movie ? 'mov' : 'matroska',
        ...(movie ? ['-enable_drefs', '0', '-use_absolute_path', '0'] : [])
      ]
      const raw = await this.run(
        this.config.suite.ffprobePath,
        [
          '-v',
          'error',
          ...policy,
          '-show_entries',
          'format=duration:stream=codec_type,width,height',
          '-of',
          'json',
          path
        ],
        65536,
        abort
      )
      let metadata: unknown
      try {
        metadata = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(raw)
        )
      } catch {
        throw new UserError('Video metadata is invalid.')
      }
      if (
        !metadata ||
        typeof metadata !== 'object' ||
        !('format' in metadata) ||
        !metadata.format ||
        typeof metadata.format !== 'object' ||
        !('duration' in metadata.format) ||
        !('streams' in metadata) ||
        !Array.isArray(metadata.streams) ||
        metadata.streams.length > 20
      )
        throw new UserError('Video metadata is missing or unsupported.')
      const duration = Number(metadata.format.duration)
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        reference.start >= duration
      )
        throw new UserError(
          'Clip start must be inside a video with a finite duration.'
        )
      const video = metadata.streams.find(
        (stream: unknown) =>
          stream &&
          typeof stream === 'object' &&
          'codec_type' in stream &&
          stream.codec_type === 'video'
      ) as Record<string, unknown> | undefined
      const width = Number(video?.width),
        height = Number(video?.height)
      if (
        !video ||
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width > 8192 ||
        height > 8192 ||
        width * height > 16777216
      )
        throw new UserError(
          'Video frame dimensions are invalid or exceed the decode limit.'
        )
      const seconds = Math.min(
          this.config.suite.videoSeconds,
          duration - reference.start
        ),
        count = Math.min(
          this.config.suite.videoFrames,
          Math.max(1, Math.ceil(seconds / 2))
        ),
        frames: VideoEvidence['frames'] = []
      let total = 0
      for (let index = 0; index < count; index++) {
        const time = reference.start + (index * seconds) / count
        const frame = await this.run(
          this.config.ffmpegPath,
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            ...policy,
            '-threads',
            '1',
            '-ss',
            String(time),
            '-max_pixels',
            '16777216',
            '-i',
            path,
            '-map',
            '0:v:0',
            '-map_metadata',
            '-1',
            '-an',
            '-sn',
            '-dn',
            '-frames:v',
            '1',
            '-vf',
            'scale=768:768:force_original_aspect_ratio=decrease',
            '-q:v',
            '5',
            '-f',
            'image2pipe',
            '-vcodec',
            'mjpeg',
            'pipe:1'
          ],
          1000000,
          abort
        )
        const image = imageFromBytes(frame, 1000000)
        if (image.mime !== 'image/jpeg')
          throw new UserError(
            'Video frame encoder returned an unsupported image.'
          )
        total += frame.length
        if (total > Math.min(5000000, Math.floor(this.config.maxJobBytes / 8)))
          throw new UserError(
            'Sampled video evidence exceeds the retained frame budget.'
          )
        frames.push({ time, image })
      }
      const hasAudio =
        reference.audio &&
        metadata.streams.some(
          (stream: unknown) =>
            stream &&
            typeof stream === 'object' &&
            'codec_type' in stream &&
            stream.codec_type === 'audio'
        )
      const audio = hasAudio
        ? await this.run(
            this.config.ffmpegPath,
            [
              '-nostdin',
              '-hide_banner',
              '-loglevel',
              'error',
              ...policy,
              '-threads',
              '1',
              '-ss',
              String(reference.start),
              '-i',
              path,
              '-t',
              String(seconds),
              '-map',
              '0:a:0',
              '-map_metadata',
              '-1',
              '-vn',
              '-sn',
              '-dn',
              '-ac',
              '1',
              '-ar',
              '16000',
              '-c:a',
              'pcm_s16le',
              '-f',
              'wav',
              'pipe:1'
            ],
            Math.ceil(seconds * 32000) + 65536,
            abort
          )
        : null
      if (audio && audio.toString('ascii', 0, 4) !== 'RIFF')
        throw new UserError(
          'Video audio extraction returned an unsupported container.'
        )
      return { duration, start: reference.start, seconds, frames, audio }
    } finally {
      this.active = false
      if (directory) await rm(directory, { recursive: true, force: true })
    }
  }
}
