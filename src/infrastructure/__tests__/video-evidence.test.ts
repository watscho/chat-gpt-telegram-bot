import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../../__tests__/helpers.js'
const metadata = () => ({
  format: { duration: '30' },
  streams: [
    { codec_type: 'video', width: 1280, height: 720 },
    { codec_type: 'audio' }
  ]
})
const state = {
  probe: Buffer.from(JSON.stringify(metadata())),
  frame: Buffer.from([255, 216, 255, 192]),
  audio: Buffer.from('RIFF-unit-audio'),
  error: false,
  mkdirError: false,
  writeError: false,
  hold: false,
  resume: undefined as (() => void) | undefined,
  calls: [] as {
    executable: string
    args: string[]
    options: { maxBuffer: number; signal: AbortSignal; timeout: number }
  }[],
  writes: [] as unknown[][],
  removed: [] as string[]
}
mock.module('node:fs/promises', {
  namedExports: {
    mkdtemp: (_prefix: string) => {
      void _prefix
      return state.mkdirError
        ? Promise.reject(new Error('mkdir failure'))
        : Promise.resolve('/unit-private-temp')
    },
    writeFile: (...args: unknown[]) => {
      state.writes.push(args)
      return state.writeError
        ? Promise.reject(new Error('write failure'))
        : Promise.resolve()
    },
    rm: (path: string) => {
      state.removed.push(path)
      return Promise.resolve()
    }
  }
})
mock.module('node:child_process', {
  namedExports: {
    execFile: (
      executable: string,
      args: string[],
      options: { maxBuffer: number; signal: AbortSignal; timeout: number },
      callback: (error: Error | null, stdout: Buffer) => void
    ) => {
      state.calls.push({ executable, args, options })
      const run = () =>
        callback(
          state.error || options.signal.aborted
            ? new Error('private native failure')
            : null,
          executable === 'ffprobe'
            ? state.probe
            : args.includes('mjpeg')
              ? state.frame
              : state.audio
        )
      if (state.hold) state.resume = run
      else run()
    }
  }
})
const { VideoExtractor } = await import('../video-evidence.js')
const input = Buffer.from('0000ftyp00000000'),
  reference = {
    file: 'file-id',
    name: 'video.mp4',
    bytes: null,
    seconds: null,
    start: 0,
    audio: true
  },
  signal = new AbortController().signal
function reset() {
  state.probe = Buffer.from(JSON.stringify(metadata()))
  state.frame = Buffer.from([255, 216, 255, 192])
  state.audio = Buffer.from('RIFF-unit-audio')
  state.error = false
  state.mkdirError = false
  state.writeError = false
  state.hold = false
  state.resume = undefined
  state.calls = []
  state.writes = []
  state.removed = []
}
void test('video adapter uses fixed bounded file-only process arguments, timestamps and private temporary cleanup with mocked OS ports', async () => {
  reset()
  const settings = config(),
    extractor = new VideoExtractor(settings)
  settings.suite.videoFrames = 2
  settings.suite.videoSeconds = 12
  const evidence = await extractor.extract(
    input,
    { ...reference, start: 3 },
    signal
  )
  assert.deepEqual(
    evidence.frames.map(frame => frame.time),
    [3, 9]
  )
  assert.equal(evidence.seconds, 12)
  assert.equal(evidence.duration, 30)
  assert.equal(Buffer.from(evidence.audio!).toString(), 'RIFF-unit-audio')
  assert.deepEqual(state.writes[0]![2], { flag: 'wx', mode: 0o600 })
  assert.deepEqual(state.removed, ['/unit-private-temp'])
  for (const call of state.calls) {
    assert.ok(call.args.includes('file,pipe'))
    assert.ok(call.args.includes('-enable_drefs'))
    assert.ok(call.args.includes('-use_absolute_path'))
    assert.equal(call.options.timeout, settings.requestTimeoutMs)
  }
  assert.ok(
    state.calls[1]!.args.indexOf('-ss') < state.calls[1]!.args.indexOf('-i')
  )
  assert.ok(state.calls.at(-1)!.args.includes('pcm_s16le'))
  state.calls = []
  state.probe = Buffer.from(
    JSON.stringify({ ...metadata(), format: { duration: '0.5' } })
  )
  const webm = await extractor.extract(
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    { ...reference, audio: false },
    signal
  )
  assert.equal(webm.frames.length, 1)
  assert.equal(webm.audio, null)
  assert.ok(state.calls[0]!.args.includes('matroska'))
  assert.equal(state.calls[0]!.args.includes('-enable_drefs'), false)
})
void test('video adapter rejects invalid containers, start times, metadata and dimensions before frame extraction', async () => {
  reset()
  const settings = config(),
    extractor = new VideoExtractor(settings)
  for (const [bytes, start] of [
    [Buffer.alloc(0), 0],
    [Buffer.from('wrong'), 0],
    [input, -1],
    [input, NaN],
    [Buffer.alloc(settings.suite.videoBytes + 1), 0]
  ] as [Buffer, number][])
    await assert.rejects(
      extractor.extract(bytes, { ...reference, start }, signal),
      /bounded MP4/
    )
  for (const value of [
    'bad',
    'null',
    '[]',
    '{}',
    '{"format":null}',
    '{"format":3}',
    '{"format":{}}',
    JSON.stringify({ format: { duration: 20 } }),
    JSON.stringify({ format: { duration: 20 }, streams: {} }),
    JSON.stringify({ format: { duration: 20 }, streams: Array(21).fill({}) })
  ]) {
    state.probe = Buffer.from(value)
    await assert.rejects(
      extractor.extract(input, reference, signal),
      /metadata/
    )
  }
  state.probe = Buffer.from([255])
  await assert.rejects(extractor.extract(input, reference, signal), /metadata/)
  for (const duration of ['NaN', 'Infinity', '0', '-1']) {
    state.probe = Buffer.from(
      JSON.stringify({ ...metadata(), format: { duration } })
    )
    await assert.rejects(
      extractor.extract(input, reference, signal),
      /finite duration/
    )
  }
  state.probe = Buffer.from(JSON.stringify(metadata()))
  await assert.rejects(
    extractor.extract(input, { ...reference, start: 30 }, signal),
    /finite duration/
  )
  for (const video of [
    null,
    1,
    {},
    { codec_type: 'audio' },
    { codec_type: 'video', width: 'bad', height: 100 },
    { codec_type: 'video', width: 100, height: 1.5 },
    { codec_type: 'video', width: 0, height: 1 },
    { codec_type: 'video', width: 1, height: 0 },
    { codec_type: 'video', width: 8193, height: 1 },
    { codec_type: 'video', width: 1, height: 8193 },
    { codec_type: 'video', width: 5000, height: 5000 }
  ]) {
    state.probe = Buffer.from(
      JSON.stringify({ ...metadata(), streams: [video] })
    )
    await assert.rejects(
      extractor.extract(input, reference, signal),
      /dimensions/
    )
  }
})
void test('video adapter bounds process output, retained evidence and audio containers and cleans up failures without automatic retries', async () => {
  reset()
  const settings = config(),
    extractor = new VideoExtractor(settings)
  settings.suite.videoFrames = 1
  state.error = true
  await assert.rejects(
    extractor.extract(input, reference, signal),
    /Media processing failed/
  )
  state.error = false
  state.probe = Buffer.alloc(65537)
  await assert.rejects(
    extractor.extract(input, reference, signal),
    /output exceeds/
  )
  state.probe = Buffer.from(JSON.stringify(metadata()))
  state.frame = Buffer.alloc(1000001)
  await assert.rejects(
    extractor.extract(input, reference, signal),
    /output exceeds/
  )
  state.frame = Buffer.from('invalid')
  await assert.rejects(
    extractor.extract(input, reference, signal),
    /Unsupported image/
  )
  state.frame = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  await assert.rejects(extractor.extract(input, reference, signal), /encoder/)
  state.frame = Buffer.from([255, 216, 255])
  settings.maxJobBytes = 8
  await assert.rejects(
    extractor.extract(input, reference, signal),
    /retained frame/
  )
  settings.maxJobBytes = 20000000
  state.audio = Buffer.from('not-wave')
  await assert.rejects(
    extractor.extract(input, reference, signal),
    /audio extraction/
  )
  state.probe = Buffer.from(
    JSON.stringify({
      ...metadata(),
      streams: [null, 3, {}, { codec_type: 'video', width: 1, height: 1 }]
    })
  )
  assert.equal((await extractor.extract(input, reference, signal)).audio, null)
  state.mkdirError = true
  const before = state.removed.length
  await assert.rejects(
    extractor.extract(input, reference, signal),
    /mkdir failure/
  )
  assert.equal(state.removed.length, before)
  state.mkdirError = false
  state.writeError = true
  await assert.rejects(
    extractor.extract(input, reference, signal),
    /write failure/
  )
  state.writeError = false
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    extractor.extract(input, reference, controller.signal),
    /processing failed/
  )
})
void test('video adapter permits only one concurrent extraction and releases its guard after cancellation', async () => {
  reset()
  const settings = config(),
    extractor = new VideoExtractor(settings)
  state.hold = true
  const pending = extractor.extract(input, reference, signal)
  await assert.rejects(
    extractor.extract(input, reference, signal),
    /already running/
  )
  await Promise.resolve()
  await Promise.resolve()
  state.hold = false
  state.error = true
  state.resume!()
  await assert.rejects(pending, /processing failed/)
  state.error = false
  settings.suite.videoFrames = 1
  await extractor.extract(input, { ...reference, audio: false }, signal)
})
