import { mock } from 'node:test'
export interface FakeZipEntry {
  isDirectory: boolean
  isFile: boolean
  isSymlink: boolean
  flags: number
  method: number
  size: number
  compressedSize: number
  content(options: { maxSize: number; verify: boolean }): Promise<Uint8Array>
}
export const zipDouble = {
  entries: [] as [string, FakeZipEntry][],
  invalid: false,
  output: [Buffer.from('PK unit archive')],
  created: [] as { name: string; bytes: Buffer; options: unknown }[]
}
export function zipEntry(
  text = 'A',
  patch: Partial<FakeZipEntry> = {}
): FakeZipEntry {
  return {
    isDirectory: false,
    isFile: true,
    isSymlink: false,
    flags: 0,
    method: 8,
    size: Buffer.byteLength(text),
    compressedSize: Buffer.byteLength(text),
    content: options => {
      if (!options.verify || options.maxSize < Buffer.byteLength(text))
        return Promise.reject(new Error('Invalid bounded request'))
      return Promise.resolve(Buffer.from(text))
    },
    ...patch
  }
}
export function mockZip() {
  mock.module('node:zlib', {
    namedExports: {
      ZipBuffer: class {
        constructor(_data: Buffer) {
          void _data
          if (zipDouble.invalid) throw new Error('invalid zip')
        }
        get size() {
          return zipDouble.entries.length
        }
        [Symbol.iterator]() {
          return zipDouble.entries[Symbol.iterator]()
        }
      },
      ZipEntry: {
        create: (name: string, bytes: Buffer, options: unknown) => {
          zipDouble.created.push({ name, bytes, options })
          return Promise.resolve({ name, bytes })
        }
      },
      createZipArchive: function* (_entries: unknown[]) {
        void _entries
        yield* zipDouble.output
      }
    }
  })
}

// Envelope-only bytes for mocked codec contracts; no actual archive is decoded.
export function zipBytes(count = zipDouble.entries.length): Buffer {
  const data = Buffer.alloc(22)
  data.writeUInt32LE(0x06054b50, 0)
  data.writeUInt16LE(count, 8)
  data.writeUInt16LE(count, 10)
  return data
}
