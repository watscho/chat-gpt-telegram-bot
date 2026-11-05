import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deskPNG } from '../../__tests__/desk.js'
import { pngSize, regionMask } from '../region-mask.js'
void test('region masks retain original dimensions and encode transparent selected pixels with bounded pure byte operations', () => {
  const image = deskPNG(),
    mask = regionMask(image, { x: 0, y: 0, width: 1, height: 1 }),
    bytes = Buffer.from(mask.data, 'base64')
  assert.deepEqual(pngSize(mask), { width: 2, height: 2 })
  assert.equal(mask.mime, 'image/png')
  assert.equal(bytes.toString('ascii', 37, 41), 'IDAT')
  const raw = bytes.subarray(48, 66)
  assert.equal(raw[0], 0)
  assert.equal(raw[4], 0)
  assert.equal(raw[8], 255)
  assert.equal(raw[13], 255)
  const large = regionMask(deskPNG(128, 129), {
    x: 0,
    y: 0,
    width: 1,
    height: 1
  })
  assert.ok(Buffer.from(large.data, 'base64').length > 65535)
  for (const image of [
    { mime: 'image/jpeg' as const, data: 'QQ==' },
    { mime: 'image/png' as const, data: 'QQ==' },
    { ...deskPNG(), data: Buffer.alloc(33).toString('base64') },
    deskPNG(0, 1),
    deskPNG(1, 0),
    deskPNG(5000, 5000)
  ])
    assert.throws(() => pngSize(image))
  const bad = Buffer.from(deskPNG().data, 'base64')
  bad.write('WRNG', 12)
  assert.throws(() =>
    pngSize({ mime: 'image/png', data: bad.toString('base64') })
  )
  assert.throws(
    () => regionMask(deskPNG(2001, 2000), { x: 0, y: 0, width: 1, height: 1 }),
    /four million/
  )
})
