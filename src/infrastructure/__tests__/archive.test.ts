import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mockZip, zipDouble, zipEntry, zipBytes } from '../../__tests__/zip.js'
mockZip()
const { archiveName, readArchive, writeArchive, organizeArchive } =
  await import('../archive.js')
void test('archive metadata validation rejects unsafe names, links, encryption and bombs before content access', async () => {
  for (const name of [
    '',
    '/absolute',
    '../escape',
    'a/../b',
    './a',
    'a//b',
    'a\\b',
    'C:a',
    'a\u0000',
    'a\u007f',
    'a'.repeat(241)
  ])
    assert.throws(() => archiveName(name))
  assert.equal(archiveName('Ｄocuments/a.txt'), 'Documents/a.txt')
  await assert.rejects(readArchive(Uint8Array.of(), 10))
  await assert.rejects(readArchive(Uint8Array.of(1, 2), 1))
  zipDouble.entries = [['a', zipEntry()]]
  zipDouble.invalid = true
  await assert.rejects(readArchive(zipBytes(), 100), /Invalid/)
  zipDouble.invalid = false
  zipDouble.entries = []
  await assert.rejects(readArchive(zipBytes(), 100), /entry count/)
  zipDouble.entries = [
    ['a', zipEntry()],
    ['b', zipEntry()]
  ]
  await assert.rejects(readArchive(zipBytes(), 100, 1))
  for (const patch of [
    { isSymlink: true },
    { isFile: false },
    { flags: 1 },
    { method: 93 },
    { size: NaN },
    { size: -1 },
    { size: 101 },
    { compressedSize: NaN },
    { compressedSize: -1 },
    { compressedSize: 101 }
  ]) {
    zipDouble.entries = [['a', zipEntry('A', patch)]]
    await assert.rejects(readArchive(zipBytes(), 100), /duplicate, linked/)
  }
  zipDouble.entries = [
    ['a.txt', zipEntry()],
    ['A.txt', zipEntry()]
  ]
  await assert.rejects(readArchive(zipBytes(), 100), /duplicate/)
  zipDouble.entries = [
    ['a', zipEntry('A', { size: 70 })],
    ['b', zipEntry('B', { size: 70 })]
  ]
  await assert.rejects(readArchive(zipBytes(), 100), /expanded/)
})
void test('archive content verification is bounded and files are organized deterministically by hash without disk extraction', async () => {
  zipDouble.entries = [
    ['folder/', zipEntry('', { isDirectory: true, isFile: false })]
  ]
  await assert.rejects(readArchive(zipBytes(), 100), /no files/)
  zipDouble.entries = [
    [
      'a',
      zipEntry('A', { content: () => Promise.reject(new Error('CRC failed')) })
    ]
  ]
  await assert.rejects(readArchive(zipBytes(), 100), /checksum/)
  zipDouble.entries = [['a', zipEntry('A', { size: 2 })]]
  await assert.rejects(readArchive(zipBytes(), 100), /metadata/)
  zipDouble.entries = [
    ['folder/', zipEntry('', { isDirectory: true, isFile: false })],
    ['folder/a.txt', zipEntry('Same')],
    ['b.pdf', zipEntry('Same')],
    ['c.png', zipEntry('Image')],
    ['d.mp4', zipEntry('Video')],
    ['e.bin', zipEntry('Other')]
  ]
  const archive = await organizeArchive(zipBytes(), 1000)
  assert.equal(archive.items[1]!.duplicateOf, '1')
  assert.deepEqual(
    archive.items.map(item => item.group),
    ['documents', 'documents', 'images', 'media', 'other']
  )
  assert.match(archive.manifest, /sha256/)
  assert.equal(archive.items[0]!.name, 'documents/001-a.txt')
})
void test('archive writer checks total size, unique normalized names and bounded output stream without filesystem effects', async () => {
  const item = { name: 'a.txt', data: Uint8Array.of(65) }
  for (const [items, limit] of [
    [[], 1000],
    [Array(102).fill(item), 100000],
    [[item], 100]
  ] as [(typeof item)[], number][])
    await assert.rejects(writeArchive(items, limit))
  await assert.rejects(
    writeArchive([item, { ...item, name: 'A.txt' }], 1000),
    /unique/
  )
  zipDouble.output = [Buffer.alloc(1001)]
  await assert.rejects(writeArchive([item], 1000), /byte limit/)
  zipDouble.output = [Buffer.from('PK'), Buffer.from('Mock')]
  const archive = await writeArchive([item], 1000)
  assert.equal(Buffer.from(archive).toString(), 'PKMock')
  assert.equal(zipDouble.created.at(-1)!.name, 'a.txt')
  assert.deepEqual(zipDouble.created.at(-1)!.options, {
    method: 'store',
    modified: new Date('2000-01-01T00:00:00Z')
  })
})
void test('classic ZIP envelope caps metadata before native construction and detects duplicate-name collapse', async () => {
  const { archiveCount } = await import('../archive.js')
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.alloc(21),
    Buffer.alloc(22),
    Buffer.concat([zipBytes(1), Buffer.of(1)])
  ])
    assert.throws(() => archiveCount(bytes, 100))
  for (const [offset, value, width] of [
    [4, 1, 2],
    [6, 1, 2],
    [8, 2, 2],
    [10, 0, 2],
    [10, 101, 2],
    [12, 0xffffffff, 4],
    [16, 0xffffffff, 4],
    [12, 1, 4]
  ]) {
    const data = zipBytes(1)
    if (width === 2) data.writeUInt16LE(value!, offset)
    else data.writeUInt32LE(value!, offset)
    assert.throws(() => archiveCount(data, 100))
  }
  const comment = Buffer.concat([zipBytes(1), Buffer.from('comment')])
  comment.writeUInt16LE(7, 20)
  assert.equal(archiveCount(comment, 100), 1)
  const ambiguous = Buffer.concat([zipBytes(1), zipBytes(1)])
  ambiguous.writeUInt16LE(22, 20)
  assert.throws(() => archiveCount(ambiguous, 100), /ambiguous/)
  zipDouble.entries = [['a', zipEntry()]]
  await assert.rejects(readArchive(zipBytes(2), 100), /duplicate names/)
})
