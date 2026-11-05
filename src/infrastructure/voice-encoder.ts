import { spawn } from 'node:child_process'

// PCM is streamed through fixed FFmpeg arguments. No shell, URLs or disk files.
export async function encodeVoice(
  pcm: Uint8Array,
  executable: string,
  maxBytes: number,
  timeoutMs: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-protocol_whitelist',
        'pipe',
        '-f',
        's16le',
        '-ar',
        '24000',
        '-ac',
        '1',
        '-i',
        'pipe:0',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-f',
        'ogg',
        'pipe:1'
      ],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        signal: AbortSignal.timeout(timeoutMs)
      }
    )
    const chunks: Buffer[] = []
    let size = 0
    child.on('error', () =>
      reject(new Error('Voice encoder unavailable or timed out'))
    )
    child.stdin.on('error', () => {
      /* close/error determines success */
    })
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        child.kill('SIGKILL')
        reject(new Error('Encoded voice exceeds configured size limit'))
      } else chunks.push(chunk)
    })
    child.on('close', code => {
      const output = Buffer.concat(chunks)
      if (code !== 0 || !output.subarray(0, 4).equals(Buffer.from('OggS')))
        reject(new Error('Voice encoding failed'))
      else resolve(output)
    })
    child.stdin.end(pcm)
  })
}
