import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Productivity } from '../productivity.js'
import { MemoryStateStore } from '../../__tests__/helpers.js'
import type { PreparedRequest } from '../../domain/productivity.js'

const request = (): PreparedRequest => ({
  prompt: 'Review',
  images: [{ mime: 'image/png', data: 'YQ==' }],
  documents: [{ name: 'a.txt', mime: 'text/plain', data: 'YQ==' }],
  memories: ['Private preference'],
  instructions: 'Be concise',
  history: [{ id: 'old', role: 'assistant', content: 'Earlier' }],
  references: '[L1] Evidence',
  analysisOnly: true
})
void test('templates persist privately, validate variable contracts and substitute once', () => {
  const store = new MemoryStateStore(),
    data = new Productivity(store)
  for (const [name, body] of [
    ['BAD', 'body'],
    ['ok', ''],
    ['ok', 'x'.repeat(8001)],
    ['ok', '{{Bad}}'],
    ['ok', '{{unfinished'],
    ['ok', 'stray}}']
  ])
    assert.throws(() => data.template('a', name!, body!))
  data.template('a', 'review', 'Review {{code}} for {{focus}}; {{code}}')
  assert.equal(new Productivity(store).get('a').templates.length, 1)
  assert.equal(data.get('b').templates.length, 0)
  assert.throws(() => data.render('b', 'review', {}))
  for (const values of [
    { code: 'x' },
    { code: 'x', focus: ' ' },
    { code: 'x', focus: 'safety', extra: 'x' }
  ])
    assert.throws(() => data.render('a', 'review', values))
  assert.equal(
    data.render('a', 'review', { code: '{{focus}}', focus: 'safety' }),
    'Review {{focus}} for safety; {{focus}}'
  )
  data.template('a', 'review', 'Updated')
  assert.equal(data.render('a', 'review', {}), 'Updated')
  data.template('a', 'long', '{{body}}')
  assert.throws(() => data.render('a', 'long', { body: 'x'.repeat(8001) }))
  for (let i = 0; i < 48; i++) data.template('a', `t${i}`, 'text')
  assert.throws(() => data.template('a', 'overflow', 'text'))
  data.removeTemplate('a', 'long')
  assert.throws(() => data.removeTemplate('a', 'missing'))
})
void test('forward collections are explicit, bounded, deduplicated and conversation scoped', () => {
  const data = new Productivity()
  data.collecting('a', '1', true)
  assert.equal(data.get('a').collecting['1'], true)
  for (const text of ['', 'x'.repeat(8001)])
    assert.throws(() => data.collect('a', '1', 1, text))
  data.collect('a', '1', 1, 'First')
  data.collect('a', '1', 1, 'Duplicate')
  assert.equal(data.get('a').forwards['1']!.length, 1)
  for (let i = 2; i <= 50; i++) data.collect('a', '1', i, 'Entry')
  assert.throws(() => data.collect('a', '1', 51, 'Overflow'))
  assert.equal(data.get('b').forwards['1'], undefined)
  for (let i = 0; i < 7; i++) data.collect('a', '2', i, 'x'.repeat(8000))
  assert.throws(() => data.collect('a', '2', 8, 'x'.repeat(8000)))
  data.clearForwards('a', '1')
  data.clearForwards('a', '3')
  data.collecting('a', '2', false)
  assert.equal(data.get('a').forwards['1'], undefined)
})
void test('context previews expire, reject mismatched revisions and omit all excluded payloads', () => {
  let now = 0
  const store = new MemoryStateStore(),
    data = new Productivity(store, () => now)
  const draft = data.stage('a', '1', 'old', request())
  for (const args of [
    ['b', '1', draft.token, 'old'],
    ['a', '2', draft.token, 'old'],
    ['a', '1', 'wrong', 'old'],
    ['a', '1', draft.token, 'new']
  ])
    assert.throws(() => data.draft(args[0]!, args[1]!, args[2]!, args[3]))
  assert.throws(() => data.toggle('a', '1', draft.token, 'old', 'missing'))
  const included = data.consume('a', '1', draft.token, 'old')
  assert.deepEqual(included, request())
  assert.equal(data.get('a').draft, null)
  const next = data.stage('a', '1', undefined, request())
  for (const part of next.parts)
    data.toggle('a', '1', next.token, undefined, part.id)
  const excluded = data.consume('a', '1', next.token, undefined)
  assert.deepEqual(excluded, {
    prompt: 'Review',
    images: [],
    documents: [],
    memories: [],
    instructions: '',
    history: [],
    references: '',
    analysisOnly: true
  })
  data.stage('a', '1', 'old', {
    ...request(),
    history: [],
    instructions: '',
    references: ''
  })
  now = 600000
  assert.equal(new Productivity(store, () => now).get('a').draft, null)
  const empty = data.stage('a', '1', undefined, {
    ...request(),
    history: [],
    images: [],
    documents: [],
    memories: [],
    instructions: '',
    references: ''
  })
  assert.equal(empty.parts.length, 0)
  data.discard('a')
  assert.throws(
    () =>
      data.stage('a', '1', 'old', {
        ...request(),
        references: 'x'.repeat(20000000)
      }),
    /20 MB/
  )
})
void test('feedback replaces a vote, caps retention and participates in deletion/export', () => {
  const store = new MemoryStateStore(),
    data = new Productivity(store, () => 10)
  for (const args of [
    ['', 'up', 'helpful'],
    ['id', 'bad', 'other'],
    ['id', 'down', 'bad']
  ])
    assert.throws(() =>
      data.feedback('a', '1', args[0]!, args[1] as 'up', args[2]!)
    )
  data.feedback('a', '1', 'answer', 'up', 'helpful')
  data.feedback('a', '1', 'answer', 'down', 'incorrect')
  assert.equal(data.get('a').feedback.length, 1)
  assert.equal(data.get('a').feedback[0]!.reason, 'incorrect')
  for (let i = 0; i < 201; i++)
    data.feedback('a', '2', `v${i}`, 'up', 'helpful')
  assert.equal(data.get('a').feedback.length, 200)
  data.stage('a', '1', 'old', request())
  data.collecting('a', '1', true)
  data.collect('a', '1', 1, 'Forward')
  data.deleteThread('a', 'other')
  assert.ok(data.get('a').draft)
  data.deleteThread('a', '1')
  assert.equal(data.get('a').draft, null)
  assert.equal(data.get('a').collecting['1'], undefined)
  data.deleteThread('a', '2')
  assert.deepEqual(data.get('a').feedback, [])
  data.erase('a')
  assert.equal(new Productivity(store).get('a').draft, null)
  new Productivity().erase('a')
})

void test('excluding a file removes its historical copies while retaining independent history text', () => {
  const data = new Productivity(),
    prepared = request()
  prepared.history = [
    {
      role: 'user',
      content: 'File discussion',
      documents: prepared.documents,
      images: prepared.images
    },
    { role: 'assistant', content: 'Prior answer' }
  ]
  const draft = data.stage('a', '1', undefined, prepared)
  assert.equal(draft.parts.filter(item => item.kind === 'document').length, 1)
  for (const part of draft.parts.filter(
    item => item.kind === 'document' || item.kind === 'image'
  ))
    data.toggle('a', '1', draft.token, undefined, part.id)
  const selected = data.consume('a', '1', draft.token, undefined)
  assert.equal(selected.history.length, 2)
  assert.ok(selected.history.every(item => !item.documents && !item.images))
  assert.deepEqual(selected.documents, [])
  assert.deepEqual(selected.images, [])
})

void test('recap and cost preview metadata can be independently inspected and excluded', () => {
  const data = new Productivity()
  data.setEstimate('a', 10)
  const draft = data.stage('a', '1', undefined, {
    ...request(),
    summary: 'Earlier decisions'
  })
  data.setEstimate('a', 600000)
  assert.equal(data.get('a').draft!.estimate, 600000)
  assert.equal(
    data.consume('a', '1', draft.token, undefined).summary,
    'Earlier decisions'
  )
  const next = data.stage('a', '1', undefined, {
    ...request(),
    summary: 'Earlier decisions'
  })
  const part = next.parts.find(item => item.kind === 'summary')!
  data.toggle('a', '1', next.token, undefined, part.id)
  assert.equal(data.consume('a', '1', next.token, undefined).summary, '')
  data.refresh('a')
})
