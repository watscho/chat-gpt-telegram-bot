import { test } from 'node:test'
import assert from 'node:assert/strict'
import { oauthResponse } from '../oauth-response.js'
void test('OAuth responses are bounded before buffering and always release the response reader', async () => {
  assert.equal(
    await oauthResponse(new Response('{"token":"unit"}')),
    '{"token":"unit"}'
  )
  await assert.rejects(oauthResponse(new Response(null)), /no response/)
  await assert.rejects(
    oauthResponse(new Response('bad', { status: 400 })),
    /failed/
  )
  await assert.rejects(oauthResponse(new Response('x'.repeat(50001))), /50 KB/)
  await assert.rejects(oauthResponse(new Response(Uint8Array.of(255))), /UTF-8/)
  let released = false
  const response = {
    ok: true,
    body: {
      getReader: () => ({
        read: () => Promise.resolve({ done: true }),
        cancel: () => Promise.reject(new Error('already closed')),
        releaseLock() {
          released = true
        }
      })
    }
  } as unknown as Response
  assert.equal(await oauthResponse(response), '')
  assert.equal(released, true)
})
