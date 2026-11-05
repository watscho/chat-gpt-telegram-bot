import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compact, recapText } from '../recap.js'
void test('local extractive recaps preserve bounded categories without inventing verified claims', () => {
  assert.equal(recapText(), '')
  const summary = compact(undefined, [
    {
      role: 'user',
      content:
        'We agreed to use version A. Must remain private. What is still pending?\n\nOther useful context.'
    }
  ])
  assert.match(summary.decisions[0]!, /agreed/)
  assert.match(summary.constraints[0]!, /private/)
  assert.match(summary.questions[0]!, /pending/)
  assert.match(recapText(summary), /not verified facts/)
  const updated = compact(summary, [
    {
      role: 'user',
      content: 'We agreed to use version A. a. b. c. d. ' + 'x'.repeat(400)
    }
  ])
  assert.equal(updated.decisions.length, 1)
  assert.equal(updated.context.length, 3)
  assert.ok(updated.context.at(-1)!.length <= 306)
  assert.match(recapText(compact(undefined, [])), /\(none\)/)
})
