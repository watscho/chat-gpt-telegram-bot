import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ResponseControls } from '../response-controls.js'

void test('response controls are owner-scoped, cancelable and reject stale or cross-thread actions', () => {
  const controls = new ResponseControls()
  assert.equal(controls.current('a'), undefined)
  assert.equal(controls.stop('a'), false)
  const first = controls.begin('a', '1')
  assert.equal(controls.current('a')?.token, first.token)
  assert.throws(() => controls.begin('a', '1'), /already running/)
  assert.equal(controls.stop('a', 'wrong'), false)
  assert.equal(controls.stop('b', first.token), false)
  assert.throws(() => controls.complete('b', '1'))
  assert.throws(() => controls.complete('a', '2'))
  controls.complete('a', '1')
  controls.validate('a', '1', first.token)
  for (const [owner, thread, token] of [
    ['b', '1', first.token],
    ['a', '2', first.token],
    ['a', '1', 'stale']
  ])
    assert.throws(() => controls.validate(owner!, thread!, token!), /stale/)
  for (const images of [false, true]) {
    const keyboard = controls.buttons(first.token, images)
    for (const button of keyboard.inline_keyboard.flat())
      assert.ok(Buffer.byteLength(button.callback_data) <= 64)
  }
  assert.equal(controls.stop('a', first.token), true)
  assert.equal(first.signal.aborted, true)
  assert.throws(() => controls.complete('a', '1'), /stopped/)
  controls.end('a')
  const second = controls.begin('a', '1')
  assert.notEqual(second.token, first.token)
  controls.complete('a', '1')
  assert.throws(() => controls.validate('a', '1', first.token), /stale/)
  controls.clear('a')
  assert.equal(second.signal.aborted, true)
  assert.throws(() => controls.validate('a', '1', second.token), /stale/)
  controls.end('a')
  controls.buttons('token')
})

void test('response revisions invalidate controls when a background job changes the same conversation', () => {
  const controls = new ResponseControls()
  const request = controls.begin('owner', '1')
  controls.complete('owner', '1', 'answer-v1')
  controls.validate('owner', '1', request.token, 'answer-v1')
  assert.throws(
    () => controls.validate('owner', '1', request.token, 'answer-v2'),
    /stale/
  )
  controls.clear('owner', false)
  assert.equal(request.signal.aborted, false)
})
