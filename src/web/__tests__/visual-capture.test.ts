import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureVisual } from '../visual-capture.js'
void test('explicit visual capture returns one bounded JPEG and stops all acquired tracks on success and every failure', async () => {
  let stops = 0,
    paused = 0,
    width = 1920,
    height = 1080,
    context = true,
    result = 'data:image/jpeg;base64,QQ==',
    drawn: unknown[] = []
  const stream = {
      getTracks: () => [
        {
          stop() {
            stops++
          }
        }
      ]
    },
    video = {
      muted: false,
      srcObject: null,
      play: () => Promise.resolve(),
      pause() {
        paused++
      },
      get videoWidth() {
        return width
      },
      get videoHeight() {
        return height
      }
    },
    canvas = {
      width: 0,
      height: 0,
      getContext: () =>
        context
          ? {
              drawImage: (...args: unknown[]) => {
                drawn = args
              }
            }
          : null,
      toDataURL: () => result
    }
  const document = {
      createElement: (tag: string) => (tag === 'video' ? video : canvas)
    } as unknown as Document,
    devices = {
      getUserMedia: () => Promise.resolve(stream),
      getDisplayMedia: () => Promise.resolve(stream)
    } as unknown as MediaDevices
  assert.match(await captureVisual('camera', devices, document), /jpeg/)
  assert.equal(stops, 1)
  assert.equal(canvas.width, 1280)
  assert.equal(canvas.height, 720)
  assert.equal(paused, 1)
  assert.ok(drawn.length)
  width = 320
  height = 240
  await captureVisual('screen', devices, document)
  assert.equal(canvas.width, 320)
  assert.equal(stops, 2)
  width = 0
  await assert.rejects(captureVisual('camera', devices, document), /No visual/)
  width = 320
  height = 0
  await assert.rejects(captureVisual('camera', devices, document))
  height = 240
  context = false
  await assert.rejects(
    captureVisual('camera', devices, document),
    /unsupported/
  )
  context = true
  result = 'data:image/png;base64,QQ=='
  await assert.rejects(captureVisual('camera', devices, document), /size/)
  result = 'data:image/jpeg;base64,' + 'x'.repeat(1500001)
  await assert.rejects(captureVisual('camera', devices, document))
  assert.equal(stops, 7)
  const denied = {
    ...devices,
    getUserMedia: () => Promise.reject(new Error('Permission denied'))
  }
  await assert.rejects(captureVisual('camera', denied, document), /Permission/)
  assert.equal(stops, 7)
})
