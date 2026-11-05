import { createHash } from 'node:crypto'
import { ZipBuffer, ZipEntry, createZipArchive } from 'node:zlib'
import { UserError } from '../domain/conversation.js'
import type { ArchiveItem } from '../domain/suite.js'
export function archiveName(name: string): string {
  const value = name.normalize('NFKC')
  if (
    !value ||
    value.length > 240 ||
    [...value].some(
      character =>
        character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127 ||
        character === '\\' ||
        character === ':'
    ) ||
    value.startsWith('/') ||
    value.split('/').some(part => part === '..' || part === '.' || part === '')
  )
    throw new UserError('Archive entry has an unsafe or ambiguous name.')
  return value
}
export function archiveCount(bytes: Uint8Array, maxEntries: number): number {
  const data = Buffer.from(bytes)
  let end = -1
  for (
    let offset = data.length - 22;
    offset >= Math.max(0, data.length - 65557);
    offset--
  ) {
    if (
      data.readUInt32LE(offset) !== 0x06054b50 ||
      offset + 22 + data.readUInt16LE(offset + 20) !== data.length
    )
      continue
    if (end !== -1) throw new UserError('Archive has ambiguous end records.')
    end = offset
  }
  if (end < 0)
    throw new UserError(
      'Archive needs an unambiguous classic ZIP end record without trailing data.'
    )
  const count = data.readUInt16LE(end + 10)
  if (
    data.readUInt16LE(end + 4) !== 0 ||
    data.readUInt16LE(end + 6) !== 0 ||
    data.readUInt16LE(end + 8) !== count ||
    !count ||
    count > maxEntries ||
    data.readUInt32LE(end + 12) === 0xffffffff ||
    data.readUInt32LE(end + 16) === 0xffffffff ||
    data.readUInt32LE(end + 16) + data.readUInt32LE(end + 12) !== end
  )
    throw new UserError(
      'Archive entry count exceeds the limit or its directory uses an unsupported ZIP layout.'
    )
  return count
}
export async function readArchive(
  bytes: Uint8Array,
  maxBytes: number,
  maxEntries = 100
): Promise<{ name: string; data: Uint8Array }[]> {
  if (!bytes.length || bytes.length > maxBytes)
    throw new UserError('Archive is empty or exceeds the byte limit.')
  const declared = archiveCount(bytes, maxEntries)
  let zip: ZipBuffer
  try {
    zip = new ZipBuffer(Buffer.from(bytes))
  } catch {
    throw new UserError('Invalid or unsupported ZIP archive.')
  }
  if (zip.size !== declared)
    throw new UserError(
      'Archive directory contains duplicate names or inconsistent counts.'
    )
  const entries = [...zip],
    names = new Set<string>()
  let total = 0
  for (const [raw, entry] of entries) {
    const name = archiveName(entry.isDirectory ? raw.replace(/\/$/, '') : raw),
      key = name.toLowerCase()
    if (
      names.has(key) ||
      entry.isSymlink ||
      (!entry.isFile && !entry.isDirectory) ||
      (entry.flags & 1) !== 0 ||
      ![0, 8].includes(entry.method) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > maxBytes ||
      !Number.isSafeInteger(entry.compressedSize) ||
      entry.compressedSize < 0 ||
      entry.compressedSize > maxBytes
    )
      throw new UserError(
        'Archive has duplicate, linked, encrypted, unsupported or oversized entries.'
      )
    names.add(key)
    total += entry.size
    if (total > maxBytes)
      throw new UserError('Archive expanded content exceeds the byte limit.')
  }
  const output: { name: string; data: Uint8Array }[] = []
  for (const [name, entry] of entries) {
    if (entry.isDirectory) continue
    let data: Uint8Array
    try {
      data = await entry.content({ maxSize: maxBytes, verify: true })
    } catch {
      throw new UserError(
        'Archive content failed bounded decompression or checksum verification.'
      )
    }
    if (data.length !== entry.size)
      throw new UserError('Archive entry size did not match its metadata.')
    output.push({ name: archiveName(name), data: Uint8Array.from(data) })
  }
  if (!output.length) throw new UserError('Archive contains no files.')
  return output
}
export async function writeArchive(
  items: { name: string; data: Uint8Array }[],
  maxBytes: number
): Promise<Uint8Array> {
  if (
    !items.length ||
    items.length > 101 ||
    items.reduce(
      (sum, item) =>
        sum + item.data.length + Buffer.byteLength(item.name) * 2 + 256,
      22
    ) > maxBytes
  )
    throw new UserError('Output archive exceeds the entry or byte limit.')
  const names = new Set<string>(),
    entries: ZipEntry[] = []
  for (const item of items) {
    const name = archiveName(item.name),
      key = name.toLowerCase()
    if (names.has(key))
      throw new UserError('Output archive names must be unique.')
    names.add(key)
    entries.push(
      await ZipEntry.create(name, Buffer.from(item.data), {
        method: 'store',
        modified: new Date('2000-01-01T00:00:00Z')
      })
    )
  }
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of createZipArchive(entries)) {
    const bytes = Buffer.from(chunk as Uint8Array)
    length += bytes.length
    if (length > maxBytes)
      throw new UserError('Output archive exceeds the byte limit.')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}
export async function organizeArchive(
  bytes: Uint8Array,
  maxBytes: number
): Promise<{ items: ArchiveItem[]; manifest: string }> {
  const contents = await readArchive(bytes, maxBytes),
    seen = new Map<string, string>()
  const items = contents.map((item, index) => {
    const hash = createHash('sha256').update(item.data).digest('hex'),
      id = String(index + 1),
      duplicateOf = seen.get(hash) ?? null
    seen.set(hash, duplicateOf ?? id)
    const base = item.name.split('/').at(-1)!,
      extension = base.split('.').at(-1)!.toLowerCase(),
      group = [
        'pdf',
        'docx',
        'pptx',
        'xlsx',
        'txt',
        'md',
        'csv',
        'json'
      ].includes(extension)
        ? 'documents'
        : ['png', 'jpg', 'jpeg', 'webp'].includes(extension)
          ? 'images'
          : ['mp3', 'wav', 'ogg', 'm4a', 'mp4', 'mov', 'webm'].includes(
                extension
              )
            ? 'media'
            : 'other'
    return {
      id,
      name: `${group}/${id.padStart(3, '0')}-${base}`,
      group,
      bytes: item.data,
      hash,
      duplicateOf
    }
  })
  const manifest = JSON.stringify(
    items.map(item => ({
      id: item.id,
      name: item.name,
      bytes: item.bytes.length,
      sha256: item.hash,
      duplicateOf: item.duplicateOf
    })),
    null,
    2
  )
  return { items, manifest }
}
