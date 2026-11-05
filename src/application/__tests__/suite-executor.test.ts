import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suiteSetup, suiteSource } from '../../__tests__/suite.js'
import {
  compileWorkflow,
  offerTotal,
  suiteCatalog,
  workflowRows,
  workflowSpec
} from '../suite-workflows.js'
import { studioEstimate } from '../studio.js'
import { SuiteExecutor } from '../suite-executor.js'
import type { WorkflowId } from '../../domain/suite.js'
const owner = '42:42',
  signal = new AbortController().signal

void test('workflow compiler exposes all fifteen typed model contracts, local stages and an explicitly different reviewer', () => {
  const { settings } = suiteSetup()
  for (const id of Object.keys(suiteCatalog) as WorkflowId[]) {
    const spec = workflowSpec(id, { model: 'gpt-6-astra' }),
      steps = compileWorkflow(settings, spec, settings.chatModel)
    assert.ok(steps.every(step => step.workflow?.id === id))
    assert.equal(studioEstimate(settings, 'local'), 0)
    assert.ok(studioEstimate(settings, steps[0]!.kind, steps[0]!.workflow) >= 0)
  }
  assert.throws(() => workflowSpec('constructor'))
  assert.throws(() =>
    compileWorkflow(
      settings,
      { ...workflowSpec('brand'), fields: [] },
      settings.chatModel
    )
  )
  for (const model of ['', settings.chatModel, 'not-allowed'])
    assert.throws(() =>
      compileWorkflow(
        settings,
        workflowSpec('referee', { model }),
        settings.chatModel
      )
    )
  for (const text of [
    'bad',
    'null',
    '{}',
    '[]',
    '[null]',
    '[2]',
    '[[]]',
    '[{"a":"ok","extra":null}]',
    '[{"b":null}]',
    '[{"a":1}]',
    JSON.stringify([{ a: 'x'.repeat(6001) }]),
    JSON.stringify(Array(101).fill({ a: null }))
  ])
    assert.throws(() => workflowRows(text, ['a']))
  assert.deepEqual(workflowRows('{"rows":[{"a":null}]}', ['a']), [{ a: null }])
  assert.deepEqual(workflowRows('[{"a":"value"}]', ['a']), [{ a: 'value' }])
  assert.equal(
    offerTotal({
      currency: 'USD',
      base: '100',
      shipping: '10',
      tax: '20',
      discount: '5'
    }),
    'USD 125 minor units (no currency conversion)'
  )
  for (const row of [
    {},
    { currency: null },
    { currency: 'USD', base: null },
    { currency: 'USD', base: 'bad' }
  ])
    assert.match(offerTotal(row), /Unknown/)
  assert.throws(() =>
    offerTotal({
      currency: 'USD',
      base: '1',
      shipping: '0',
      tax: '0',
      discount: '2'
    })
  )
})
void test('Suite executor routes typed model stages through existing quotas and preserves the explicit evidence boundary', async () => {
  const s = suiteSetup(),
    mission = s.plan('brief'),
    step = mission.steps[0]!
  s.model.answer = {
    text: 'Structured result',
    images: [],
    artifact: {
      rows: 1,
      name: 'result.json',
      mime: 'application/json',
      data: Buffer.from(JSON.stringify({ rows: s.rows('brief') })).toString(
        'base64'
      )
    }
  }
  await s.suiteExecutor.execute(owner, mission, step, signal)
  assert.deepEqual(
    s.model.options[0]!.structured?.fields,
    suiteCatalog.brief.fields
  )
  assert.match(s.model.options[0]!.references!, /source1/)
  assert.equal(s.usage.get(owner).requests, 1)
  const plain = s.plan('brief')
  delete plain.steps[0]!.workflow
  await s.suiteExecutor.execute(owner, plain, plain.steps[0]!, signal)
  assert.equal(s.model.options[1]!.structured, undefined)
  const referee = s.plan('referee')
  await s.suiteExecutor.execute(owner, referee, referee.steps[0]!, signal)
  assert.equal(s.model.options[2]!.structured, undefined)
  await s.suiteExecutor.execute(owner, referee, referee.steps[1]!, signal)
  assert.equal(s.model.options[3]!.chatModel, 'gpt-6-astra')
  assert.equal(s.model.options[3]!.enableSearch, false)
  s.settings.suite.reviewModels = []
  await assert.rejects(
    s.suiteExecutor.execute(owner, referee, referee.steps[1]!, signal),
    /allowlisted/
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    s.suiteExecutor.execute(owner, mission, step, controller.signal),
    /cancelled/
  )
  step.estimate++
  await assert.rejects(
    s.suiteExecutor.execute(owner, mission, step, signal),
    /configuration changed/
  )
})
void test('local Suite stages render actual port artifacts without making another model call and require reviewed record acceptance', async () => {
  for (const id of [
    'brand',
    'screen',
    'purchase',
    'repurpose',
    'travel',
    'learn',
    'rehearse',
    'decision',
    'form',
    'commitment'
  ] as WorkflowId[]) {
    const s = suiteSetup(),
      mission = s.plan(id),
      last = mission.steps.at(-1)!
    mission.input.images = [{ mime: 'image/png', data: 'QQ==' }]
    mission.steps[0]!.output = {
      text: JSON.stringify({ rows: s.rows(id) }),
      images: []
    }
    mission.steps[0]!.state = 'done'
    const result = await s.suiteExecutor.execute(owner, mission, last, signal)
    assert.equal(s.model.calls.length, 0)
    if (['brand', 'screen', 'repurpose'].includes(id))
      assert.ok(result.files?.length)
    else if (id === 'purchase') assert.match(result.text, /minor units/)
    else {
      const pending = s.suite.get(owner).pending!
      assert.equal(s.suite.get(owner).records.length, 0)
      assert.match(result.text, /Record preview/)
      const record = s.suite.confirmRecord(
        owner,
        { thread: '1', project: null, sourceRevision: undefined },
        pending.token,
        pending.revision
      )
      assert.equal(record.rows.length, 1)
    }
  }
})
void test('local workflow failures retain paid results and reject stale brands, invented quotes, malformed forms and unknown stages', async () => {
  const s = suiteSetup(),
    mission = s.plan('brand'),
    local = mission.steps[1]!
  await assert.rejects(
    s.suiteExecutor.execute(owner, mission, local, signal),
    /completed/
  )
  mission.steps[0]!.output = { text: 'invalid JSON', images: [] }
  await assert.rejects(
    s.suiteExecutor.execute(owner, mission, local, signal),
    /invalid JSON/
  )
  mission.steps[0]!.output = {
    text: JSON.stringify(s.rows('brand')),
    images: []
  }
  s.suite.saveTemplate(owner, {
    ...s.suite.template(owner, 'default'),
    brand: 'Changed'
  })
  // Saving the first explicit default has revision one; the next edit invalidates the frozen plan.
  s.suite.saveTemplate(owner, s.suite.template(owner, 'default'))
  await assert.rejects(
    s.suiteExecutor.execute(owner, mission, local, signal),
    /template changed/
  )
  for (const id of ['decision', 'commitment'] as const) {
    const plan = s.plan(id),
      stage = plan.steps.at(-1)!
    for (const row of [
      { ...s.rows(id)[0], quote: 'Invented' },
      { ...s.rows(id)[0], source: 'missing' },
      { ...s.rows(id)[0], quote: null }
    ]) {
      plan.steps[0]!.output = { text: JSON.stringify([row]), images: [] }
      await assert.rejects(
        s.suiteExecutor.execute(owner, plan, stage, signal),
        /exact quote/
      )
    }
    plan.input.sources = []
    await assert.rejects(
      s.suiteExecutor.execute(owner, plan, stage, signal),
      /exact quote/
    )
  }
  const form = s.plan('form'),
    formStage = form.steps[1]!
  for (const rows of [
    [{ ...s.rows('form')[0], field: 'bad field' }],
    [s.rows('form')[0], s.rows('form')[0]],
    [{ ...s.rows('form')[0], field: null }]
  ]) {
    form.steps[0]!.output = { text: JSON.stringify(rows), images: [] }
    await assert.rejects(
      s.suiteExecutor.execute(owner, form, formStage, signal),
      /field names/
    )
  }
  const screen = s.plan('screen')
  screen.steps[0]!.output = {
    text: JSON.stringify(s.rows('screen')),
    images: []
  }
  await assert.rejects(
    s.suiteExecutor.execute(owner, screen, screen.steps[1]!, signal),
    /screenshot/
  )
  const pack = s.plan('repurpose')
  for (const rows of [
    [{ format: 'unknown', title: null, text: null }],
    [{ format: null, title: null, text: null }],
    [s.rows('repurpose')[0], s.rows('repurpose')[0]]
  ]) {
    pack.steps[0]!.output = { text: JSON.stringify(rows), images: [] }
    await assert.rejects(
      s.suiteExecutor.execute(owner, pack, pack.steps[1]!, signal),
      /formats/
    )
  }
  form.steps[0]!.output = { text: JSON.stringify(s.rows('form')), images: [] }
  formStage.workflow!.phase = 'unknown'
  await assert.rejects(
    s.suiteExecutor.execute(owner, form, formStage, signal),
    /Unknown local/
  )
  formStage.workflow!.phase = 'record'
  formStage.workflow!.id = 'brief'
  formStage.workflow!.fields = suiteCatalog.brief.fields
  form.steps[0]!.output = { text: JSON.stringify(s.rows('brief')), images: [] }
  await assert.rejects(
    s.suiteExecutor.execute(owner, form, formStage, signal),
    /record contract/
  )
})
void test('continuing sessions bind accepted record revisions and retain prior learning mistakes', async () => {
  const s = suiteSetup(),
    record = s.suite.putRecord(owner, {
      kind: 'course',
      title: 'Learning',
      thread: '1',
      project: null,
      fields: {},
      rows: [{ mistake: 'Old error' }],
      sources: [suiteSource]
    }),
    mission = s.plan('learn'),
    stage = mission.steps[1]!
  stage.workflow!.record = record.id
  stage.workflow!.params.recordRevision = '1'
  mission.steps[0]!.output = {
    text: JSON.stringify(s.rows('learn')),
    images: []
  }
  await s.suiteExecutor.execute(owner, mission, stage, signal)
  const pending = s.suite.get(owner).pending!
  assert.equal(
    s.suite.confirmRecord(
      owner,
      { thread: '1', project: null, sourceRevision: undefined },
      pending.token,
      1
    ).rows.length,
    2
  )
  await assert.rejects(
    s.suiteExecutor.execute(owner, mission, stage, signal),
    /record changed/
  )
})
void test('video sampling and transcription are bounded separate stages with cancellation and quota failure accounting', async () => {
  const s = suiteSetup(),
    mission = s.plan('video'),
    media = mission.steps[0]!
  await assert.rejects(
    s.suiteExecutor.execute(owner, mission, media, signal),
    /Choose a video/
  )
  mission.input.video = {
    file: 'telegram-owned-id',
    name: 'recording.mp4',
    bytes: 5,
    seconds: 20,
    start: 0,
    audio: false
  }
  let result = await s.suiteExecutor.execute(owner, mission, media, signal)
  assert.match(result.text, /not requested/)
  assert.equal(result.images.length, 1)
  mission.steps[0]!.state = 'done'
  mission.steps[0]!.output = result
  await s.suiteExecutor.execute(owner, mission, mission.steps[1]!, signal)
  assert.equal(s.model.calls[0]![0]!.images?.length, 1)
  s.assets.video = () =>
    Promise.resolve({
      duration: 90,
      start: 10,
      seconds: 15,
      frames: [],
      audio: Uint8Array.of(1)
    })
  result = await s.suiteExecutor.execute(owner, mission, media, signal)
  assert.match(result.text, /Voice text/)
  assert.equal(s.usage.get(owner).transcriptions, 1)
  s.model.transcribe = () => Promise.reject(new Error('provider failed'))
  await assert.rejects(
    s.suiteExecutor.execute(owner, mission, media, signal),
    /provider failed/
  )
  assert.equal(s.usage.get(owner).failed, 1)
  const rejecting = new SuiteExecutor(
    s.settings,
    s.suite,
    s.executor,
    s.assets,
    s.usage,
    (audio, signal) => s.model.transcribe(audio, signal),
    () => Promise.reject(new Error('download failed')),
    () => undefined
  )
  await assert.rejects(
    rejecting.execute(owner, mission, media, signal),
    /download failed/
  )
})
void test('local nullable fields remain explicit and record acceptance prevents duplicate journal entries', async () => {
  const s = suiteSetup(),
    brand = s.plan('brand')
  delete brand.steps[1]!.workflow!.params.template
  delete brand.input.sources
  brand.steps[0]!.output = {
    text: JSON.stringify([{ heading: null, text: null }]),
    images: []
  }
  await s.suiteExecutor.execute(owner, brand, brand.steps[1]!, signal)
  const pack = s.plan('repurpose')
  delete pack.input.sources
  pack.steps[0]!.output = {
    text: JSON.stringify([{ format: 'email', title: null, text: null }]),
    images: []
  }
  await s.suiteExecutor.execute(owner, pack, pack.steps[1]!, signal)
  const mission = s.plan('decision')
  mission.steps[0]!.output = {
    text: 'Rows are in the artifact',
    images: [],
    artifact: {
      rows: 1,
      name: 'rows.json',
      mime: 'application/json',
      data: Buffer.from(JSON.stringify({ rows: s.rows('decision') })).toString(
        'base64'
      )
    }
  }
  await s.suiteExecutor.execute(owner, mission, mission.steps[1]!, signal)
  const pending = s.suite.get(owner).pending!
  s.suite.confirmRecord(
    owner,
    { thread: '1', project: null, sourceRevision: undefined },
    pending.token,
    1
  )
  await assert.rejects(
    s.suiteExecutor.execute(owner, mission, mission.steps[1]!, signal),
    /already accepted/
  )
  const plain = s.plan('brief')
  delete plain.input.sources
  await s.suiteExecutor.execute(owner, plain, plain.steps[0]!, signal)
  const media = s.plan('video')
  media.steps[0]!.workflow!.phase = 'wrong'
  await assert.rejects(
    s.suiteExecutor.execute(owner, media, media.steps[0]!, signal),
    /Choose a video/
  )
})
void test('Studio rejects malformed workflow steps and routes typed or analysis revisions through fresh reviews', async () => {
  const s = suiteSetup(),
    input = {
      prompt: 'Goal',
      project: null,
      images: [],
      documents: [],
      instructions: '',
      memories: []
    },
    good = {
      kind: 'compose' as const,
      title: 'Draft',
      prompt: 'Write',
      connection: null
    }
  for (const custom of [
    [],
    Array(11).fill(good),
    [{ ...good, kind: 'invalid' }],
    [{ ...good, title: '' }],
    [{ ...good, title: 'x'.repeat(101) }],
    [{ ...good, prompt: '' }],
    [{ ...good, prompt: 'x'.repeat(2001) }],
    [{ ...good, kind: 'local' }],
    [{ ...good, kind: 'connection', connection: 'unknown' }]
  ])
    assert.throws(
      () =>
        s.studio.plan(
          owner,
          '1',
          'workflow',
          input,
          [],
          custom as (typeof good)[]
        ),
      /recipe steps/
    )
  s.studio.plan(
    owner,
    '1',
    'workflow',
    input,
    [],
    [{ ...good, kind: 'connection', connection: 'mail' }]
  )
  const typed = await s.finish(s.plan('brief'))
  assert.equal(
    s.studio.revise(owner, typed.id, typed.revision, 'Improve').steps.at(-1)!
      .workflow!.id,
    'brief'
  )
  const local = await s.finish(s.plan('learn'))
  assert.equal(
    s.studio.revise(owner, local.id, local.revision, 'Improve').steps.at(-1)!
      .workflow,
    undefined
  )
  const analysis = s.studio.plan(
      owner,
      '1',
      'workflow',
      input,
      [],
      [{ ...good, kind: 'analysis' }]
    ),
    done = await s.finish(analysis)
  assert.equal(
    s.studio.revise(owner, done.id, done.revision, 'Improve').steps.at(-1)!
      .kind,
    'analysis'
  )
  const media = s.plan('video')
  await assert.rejects(
    s.executor.execute(owner, media, media.steps[0]!, signal),
    /Suite asset executor/
  )
  const brand = s.plan('brand')
  await assert.rejects(
    s.executor.execute(owner, brand, brand.steps[1]!, signal),
    /Suite asset executor/
  )
})
void test('nullable model selection, absent source lists and unnamed offers remain explicit local contracts', async () => {
  const s = suiteSetup(),
    model = s.plan('brief')
  model.steps[0]!.workflow!.model = null
  await s.suiteExecutor.execute(owner, model, model.steps[0]!, signal)
  assert.equal(s.model.options[0]!.chatModel, s.settings.chatModel)
  const purchase = s.plan('purchase'),
    row = { ...s.rows('purchase')[0]!, offer: null }
  purchase.steps[0]!.output = { text: JSON.stringify([row]), images: [] }
  assert.match(
    (await s.suiteExecutor.execute(owner, purchase, purchase.steps[1]!, signal))
      .text,
    /^Offer:/
  )
  const learn = s.plan('learn')
  delete learn.input.sources
  learn.steps[0]!.output = { text: JSON.stringify(s.rows('learn')), images: [] }
  await s.suiteExecutor.execute(owner, learn, learn.steps[1]!, signal)
  const pending = s.suite.get(owner).pending!,
    saved = s.suite.confirmRecord(
      owner,
      { thread: '1', project: null, sourceRevision: undefined },
      pending.token,
      1
    )
  const next = s.plan('learn')
  next.steps[1]!.workflow!.record = saved.id
  next.steps[1]!.workflow!.params.recordRevision = String(saved.revision)
  next.steps[0]!.output = { text: JSON.stringify(s.rows('learn')), images: [] }
  await s.suiteExecutor.execute(owner, next, next.steps[1]!, signal)
  const update = s.suite.get(owner).pending!
  assert.equal(
    s.suite.confirmRecord(
      owner,
      { thread: '1', project: null, sourceRevision: undefined },
      update.token,
      1
    ).fields.goal,
    saved.fields.goal
  )
})
