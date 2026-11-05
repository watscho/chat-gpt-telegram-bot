import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageFromBytes, downloadTelegramImage } from '../images.js'

const image = { data: 'iVBORw0KGgo=', mime: 'image/png' as const }

void test('image signatures determine actual MIME; unsupported and oversized files fail', () => {
  for (const [bytes, mime] of [
    [Buffer.from(image.data, 'base64'), 'image/png'],
    [Buffer.from([255, 216, 255, 0]), 'image/jpeg'],
    [Buffer.from('RIFF1234WEBPVP8 '), 'image/webp']
  ] as const)
    assert.equal(imageFromBytes(bytes, 100).mime, mime)
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from('GIF89a'),
    Buffer.from('fake.png')
  ]) {
    assert.throws(() => imageFromBytes(bytes, 100))
  }
  assert.throws(() => imageFromBytes(Buffer.from(image.data, 'base64'), 7))
})

void test('image downloads enforce Telegram origin, streaming bounds and actual signature', async () => {
  const url = new URL('https://api.telegram.org/file/bot123/photo.png')
  assert.deepEqual(
    await downloadTelegramImage(url, 8, 1000, (_url, options) => {
      assert.equal(options?.redirect, 'error')
      assert.ok(options?.signal)
      return Promise.resolve(new Response(Buffer.from(image.data, 'base64')))
    }),
    image
  )
  await assert.rejects(
    downloadTelegramImage(new URL('https://evil.test/photo'), 8, 1000, () => {
      throw new Error('must not fetch')
    }),
    /Invalid Telegram/
  )
  await assert.rejects(
    downloadTelegramImage(url, 2, 1000, () =>
      Promise.resolve(new Response('123'))
    ),
    /Image is too large/
  )
  await assert.rejects(
    downloadTelegramImage(url, 100, 1000, () =>
      Promise.resolve(new Response('fake.png'))
    ),
    /Unsupported/
  )
})

void test('extended WebP animation flags reject animation but allow still images', () => {
  const header = Buffer.from('RIFF1234WEBPVP8X')
  assert.equal(imageFromBytes(header, 100).mime, 'image/webp')
  const bytes = Buffer.concat([header, Buffer.alloc(5)])
  assert.equal(imageFromBytes(bytes, 100).mime, 'image/webp')
  bytes[20] = 2
  assert.throws(() => imageFromBytes(bytes, 100), /Animated/)
})
