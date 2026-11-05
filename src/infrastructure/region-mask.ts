import { UserError, type Image } from '../domain/conversation.js'
import type { Rectangle } from '../domain/desk.js'
import { photoRegion } from '../application/desk.js'
/** A lossless PNG mask; no image decoder or external/native rendering process is used. */
function crc(bytes: Uint8Array): number {
  let n = 0xffffffff
  for (const byte of bytes) {
    n ^= byte
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0)
  }
  return (n ^ 0xffffffff) >>> 0
}
function chunk(name: string, data: Uint8Array): Buffer {
  const type = Buffer.from(name),
    body = Buffer.concat([type, data]),
    head = Buffer.alloc(4),
    tail = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  tail.writeUInt32BE(crc(body))
  return Buffer.concat([head, body, tail])
}
export function pngSize(image: Image): { width: number; height: number } {
  const bytes = Buffer.from(image.data, 'base64')
  if (
    image.mime !== 'image/png' ||
    bytes.length < 33 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new UserError(
      'Selected-region edits require an original PNG. Export/convert your image to PNG first.'
    )
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20)
  photoRegion({ x: 0, y: 0, width, height }, width, height)
  return { width, height }
}
export function regionMask(image: Image, region: Rectangle): Image {
  const { width, height } = pngSize(image)
  photoRegion(region, width, height)
  if (width * height > 4000000)
    throw new UserError(
      'Region masks support PNG images up to four million pixels.'
    )
  const raw = Buffer.alloc((width * 4 + 1) * height, 255)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    for (let x = region.x; x < region.x + region.width; x++)
      if (y >= region.y && y < region.y + region.height)
        raw[y * (width * 4 + 1) + x * 4 + 4] = 0
  }
  const blocks: Buffer[] = [Buffer.from([0x78, 0x01])]
  let a = 1,
    b = 0
  for (const byte of raw) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  for (let offset = 0; offset < raw.length; offset += 65535) {
    const data = raw.subarray(offset, offset + 65535),
      head = Buffer.alloc(5)
    head[0] = offset + data.length === raw.length ? 1 : 0
    head.writeUInt16LE(data.length, 1)
    head.writeUInt16LE(65535 - data.length, 3)
    blocks.push(head, data)
  }
  const adler = Buffer.alloc(4)
  adler.writeUInt32BE(((b << 16) | a) >>> 0)
  blocks.push(adler)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return {
    mime: 'image/png',
    data: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', Buffer.concat(blocks)),
      chunk('IEND', Buffer.alloc(0))
    ]).toString('base64')
  }
}
