import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Suite, suiteName, suiteStrings } from '../suite.js'
import { suiteSetup, suiteSource } from '../../__tests__/suite.js'
import { MemoryStateStore, config } from '../../__tests__/helpers.js'
const owner = '42:42',
  scope = { thread: '1', project: null, sourceRevision: undefined }
const record = () => ({
  kind: 'decision' as const,
  title: 'Launch decision',
  thread: '1',
  project: null,
  fields: {},
  rows: [
    {
      decision: 'Small launch',
      source: 'source1',
      quote: 'We chose the smaller launch.'
    }
  ],
  sources: [suiteSource]
})
void test('Suite persists isolated records, bounded revision history and atomically consumes scoped previews', () => {
  const { suite, store, settings } = suiteSetup()
  assert.equal(suite.get(owner).records.length, 0)
  const pending = suite.stage(owner, scope, 'record', {
    record: record(),
    existing: null,
    expectedRevision: null
  })
  assert.throws(() => suite.pending('43:43', scope, pending.token, 1))
  for (const wrong of [
    { ...scope, thread: '2' },
    { ...scope, project: '1' },
    { ...scope, sourceRevision: 'changed' }
  ])
    assert.throws(() => suite.pending(owner, wrong, pending.token, 1))
  assert.throws(() => suite.pending(owner, scope, 'wrong', 1))
  assert.throws(() => suite.pending(owner, scope, pending.token, 2))
  const saved = suite.confirmRecord(owner, scope, pending.token, 1)
  assert.equal(saved.revision, 1)
  assert.throws(() => suite.confirmRecord(owner, scope, pending.token, 1))
  assert.equal(
    new Suite(settings, store).record(owner, saved.id).title,
    'Launch decision'
  )
  assert.throws(() => suite.record(owner, saved.id, 'form'))
  for (let i = 0; i < 12; i++) suite.putRecord(owner, record(), saved.id)
  assert.equal(suite.record(owner, saved.id).history.length, 10)
  const stale = suite.stage(owner, scope, 'record', {
    record: record(),
    existing: saved.id,
    expectedRevision: 1
  })
  assert.throws(
    () => suite.confirmRecord(owner, scope, stale.token, 1),
    /changed/
  )
  const current = suite.record(owner, saved.id),
    fresh = suite.stage(owner, scope, 'record', {
      record: record(),
      existing: saved.id,
      expectedRevision: current.revision
    })
  assert.equal(
    suite.confirmRecord(owner, scope, fresh.token, 1).revision,
    current.revision + 1
  )
  suite.refresh(owner)
  assert.equal(suite.record(owner, saved.id).id, saved.id)
  suite.removeRecord(owner, saved.id)
  assert.throws(() => suite.record(owner, saved.id))
  suite.erase(owner)
  assert.equal(suite.get(owner).pending, null)
})
void test('Suite expires pending reviews and sessions, validates local fields and preserves independent records on thread deletion', () => {
  let now = 1
  const suite = new Suite(config(), new MemoryStateStore(), () => now),
    pending = suite.stage(owner, scope, 'zip', { entries: [] })
  assert.throws(
    () => suite.confirmRecord(owner, scope, pending.token, 1),
    /record preview/
  )
  assert.throws(() =>
    suite.takePending(owner, scope, pending.token, 1, 'share')
  )
  const changed = suite.replacePending(owner, scope, pending.token, 1, {
    entries: ['a']
  })
  assert.equal(changed.revision, 2)
  suite.takePending(owner, scope, changed.token, 2, 'zip')
  suite.stage(owner, scope, 'share', {})
  const form = suite.putRecord(owner, {
    ...record(),
    kind: 'form',
    rows: [{ field: 'email', value: null }]
  })
  assert.throws(() => suite.answerField(owner, form.id, 'email', ' '))
  assert.throws(() =>
    suite.answerField(owner, form.id, 'email', 'x'.repeat(2001))
  )
  assert.throws(() => suite.answerField(owner, form.id, 'missing', 'a'))
  assert.equal(
    suite.answerField(owner, form.id, 'email', 'a@example.com').rows[0]!
      .confirmed,
    'yes'
  )
  assert.throws(() => suite.listen(owner, '2', 'form', form.id))
  suite.listen(owner, '1', 'form', form.id)
  assert.equal(suite.listener(owner, '2'), null)
  assert.equal(suite.listener(owner, '1')?.kind, 'form')
  now += 600001
  assert.equal(suite.get(owner).pending, null)
  assert.equal(suite.listener(owner, '1'), null)
  const course = suite.putRecord(owner, { ...record(), kind: 'course' }),
    rehearsal = suite.putRecord(owner, { ...record(), kind: 'rehearsal' })
  suite.listen(owner, '1', 'learn', course.id)
  suite.clearListener(owner)
  suite.listen(owner, '1', 'rehearse', rehearsal.id)
  suite.stage(owner, scope, 'zip', {})
  suite.deleteThread(owner, '2')
  assert.ok(suite.get(owner).pending)
  suite.deleteThread(owner, '1')
  assert.equal(suite.get(owner).listening, null)
  assert.ok(suite.record(owner, form.id))
  suite.listen(owner, '1', 'form', form.id)
  suite.removeRecord(owner, form.id)
  assert.equal(suite.get(owner).listening, null)
})
void test('Suite brands and quality criteria are explicit and project scoped with strict editable values', () => {
  const { suite } = suiteSetup(),
    template = suite.template(owner, 'default')
  assert.throws(() => suite.template(owner, 'missing'))
  const saved = suite.saveTemplate(owner, {
    ...template,
    name: 'Company',
    accent: 'abcdef'
  })
  assert.equal(saved.accent, 'ABCDEF')
  assert.equal(suite.saveTemplate(owner, saved).revision, 2)
  for (const patch of [
    { brand: '' },
    { brand: 'x'.repeat(101) },
    { accent: 'red' },
    { font: '<script>' },
    { footer: 'x'.repeat(201) },
    { headings: [''] },
    { headings: Array(13).fill('Heading') as string[] },
    { headings: ['x'.repeat(101)] }
  ])
    assert.throws(() => suite.saveTemplate(owner, { ...saved, ...patch }))
  suite.removeTemplate(owner, saved.name)
  const global = suite.criterion(
      owner,
      null,
      'Clarity',
      'Define technical terms'
    ),
    project = suite.criterion(owner, '1', 'Tone', 'Be concise')
  assert.equal(suite.criteria(owner, '2').length, 1)
  assert.match(suite.qualityText(owner, '1'), /Clarity/)
  for (const [label, check] of [
    ['', 'a'],
    ['x'.repeat(101), 'a'],
    ['a', ''],
    ['a', 'x'.repeat(401)]
  ])
    assert.throws(() => suite.criterion(owner, null, label!, check!))
  suite.removeCriterion(owner, global.id)
  suite.removeCriterion(owner, project.id)
  assert.throws(() => suite.removeCriterion(owner, global.id))
})
void test('Suite rejects malformed records and capacity overflow without corrupting the saved state', () => {
  const { suite, settings } = suiteSetup()
  for (const patch of [
    { title: '' },
    { title: 'x'.repeat(101) },
    { kind: 'invalid' },
    { rows: Array(101).fill({}) },
    { sources: Array(21).fill(suiteSource) },
    { sources: [{ ...suiteSource, text: '' }] },
    { sources: [{ ...suiteSource, text: 'x'.repeat(12001) }] },
    { sources: [{ ...suiteSource, title: 'x'.repeat(201) }] },
    { fields: { 'bad key': 'x' } },
    { rows: [{ value: 3 }] }
  ])
    assert.throws(() =>
      suite.putRecord(owner, { ...record(), ...patch } as ReturnType<
        typeof record
      >)
    )
  assert.throws(() => suite.putRecord(owner, record(), 'missing'))
  const saved = suite.putRecord(owner, record())
  assert.throws(() =>
    suite.putRecord(owner, { ...record(), kind: 'trip' }, saved.id)
  )
  for (const source of [
    { ...suiteSource, id: '' },
    { ...suiteSource, title: 'x'.repeat(201) },
    { ...suiteSource, text: '' },
    { ...suiteSource, text: 'x'.repeat(12001) }
  ])
    assert.throws(() => suite.select(owner, source))
  suite.select(owner, suiteSource)
  suite.select(owner, suiteSource)
  assert.equal(suite.get(owner).selected.length, 1)
  suite.clearSelected(owner)
  settings.maxJobBytes = 1
  assert.throws(() => suite.stage(owner, scope, 'share', {}), /capacity/)
  assert.equal(suite.get(owner).pending, null)
  for (const value of ['', '../bad', '0name', 'x'.repeat(33)])
    assert.throws(() => suiteName(value))
  assert.equal(suiteName(' name '), 'name')
  for (const value of [
    { constructor: 'x' },
    { prototype: 'x' },
    JSON.parse('{"__proto__":"x"}') as Record<string, string>,
    { key: 'x'.repeat(6001) },
    Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, 'x'])),
    { key: 3 }
  ])
    assert.throws(() => suiteStrings(value as Record<string, string>))
})
void test('Suite recipes retain bounded versions, substitute exact variables and never silently invent missing bindings', () => {
  const { suite } = suiteSetup(),
    step = {
      kind: 'compose' as const,
      title: 'Draft {{topic}}',
      prompt: 'Write about {{topic}}',
      connection: null
    }
  suite.saveRecipe(owner, 'draft', 'Explain {{topic}}', [step])
  const rendered = suite.renderRecipe(owner, 'draft', { topic: '$&' })
  assert.equal(rendered.steps[0]!.prompt, 'Write about $&')
  for (const variables of [{}, { topic: 'a', extra: 'b' }])
    assert.throws(() => suite.renderRecipe(owner, 'draft', variables))
  for (let i = 0; i < 7; i++)
    suite.saveRecipe(owner, 'draft', 'Explain {{topic}}', [step])
  assert.equal(suite.recipe(owner, 'draft').history.length, 5)
  suite.saveRecipe(owner, 'plain', 'Explain', [
    { ...step, title: 'Draft', prompt: 'Write' }
  ])
  assert.equal(suite.renderRecipe(owner, 'plain', {}).goal, 'Explain')
  assert.throws(
    () => suite.renderRecipe(owner, 'plain', { extra: 'x' }),
    /none/
  )
  for (const steps of [
    [],
    Array(11).fill(step),
    [{ ...step, kind: 'invalid' }],
    [{ ...step, title: '' }],
    [{ ...step, title: 'x'.repeat(101) }],
    [{ ...step, prompt: '' }],
    [{ ...step, prompt: 'x'.repeat(2001) }],
    [{ ...step, kind: 'connection', connection: 'missing' }]
  ])
    assert.throws(() =>
      suite.saveRecipe(owner, 'bad', 'Goal', steps as (typeof step)[])
    )
  assert.throws(() => suite.saveRecipe(owner, 'bad', '', [step]))
  suite.saveRecipe(owner, 'mail', 'Goal', [
    { ...step, kind: 'connection', connection: 'mail' }
  ])
  suite.removeRecipe(owner, 'draft')
  assert.throws(() => suite.recipe(owner, 'draft'))
})
