import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentFromBytes, downloadTelegramDocument } from '../documents.js'

void test('supported documents use bounded inline payloads; binary signatures and UTF-8 are checked', () => {
  assert.equal(
    documentFromBytes(Buffer.from('%PDF-1.4'), '../test.pdf', 100).name,
    'test.pdf'
  )
  for (const extension of ['docx', 'xlsx', 'pptx']) {
    assert.ok(
      documentFromBytes(
        Buffer.from([80, 75, 3, 4]),
        `test.${extension}`,
        100
      ).mime.includes('openxmlformats')
    )
    assert.throws(
      () => documentFromBytes(Buffer.from('fake'), `test.${extension}`, 100),
      /Invalid Office/
    )
  }
  for (const extension of ['txt', 'md', 'csv', 'json'])
    assert.ok(
      documentFromBytes(Buffer.from('Привет'), `test.${extension}`, 100).data
    )
  for (const [data, name, max] of [
    [Buffer.alloc(0), 'empty.txt', 100],
    [Buffer.from('hello'), 'a.txt', 1],
    [Buffer.from('hello'), 'a.exe', 100],
    [Buffer.from('fake'), 'fake.pdf', 100],
    [Buffer.from([255]), 'bad.txt', 100],
    [Buffer.from([0]), 'binary.txt', 100]
  ] as const)
    assert.throws(() => documentFromBytes(data, name, max))
})

void test('document downloads reject unsupported types before network and bound actual bytes', async () => {
  const url = new URL('https://api.telegram.org/file/bot123/test.pdf')
  const document = await downloadTelegramDocument(
    url,
    'test.pdf',
    100,
    1000,
    (_url, options) => {
      assert.equal(options?.redirect, 'error')
      return Promise.resolve(new Response('%PDF-1.4'))
    }
  )
  assert.equal(document.mime, 'application/pdf')
  await assert.rejects(
    downloadTelegramDocument(url, 'a.exe', 10, 1000, () => {
      throw new Error('must not download')
    }),
    /Supported/
  )
  await assert.rejects(
    downloadTelegramDocument(url, 'a.txt', 1, 1000, () =>
      Promise.resolve(new Response('ab'))
    ),
    /too large/
  )
})
