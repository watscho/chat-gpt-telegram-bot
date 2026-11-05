import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  routineSetup,
  routineOwner as owner,
  routineScope as scope,
  routineSource
} from '../../__tests__/routines.js'
import { routineSchemas, routineSteps } from '../routine-executor.js'
import type { RoutineKind } from '../../domain/routine.js'
import type { MissionStep } from '../../domain/studio.js'
import { studioInput } from '../../__tests__/studio.js'
function setup(
  kind: RoutineKind,
  params: Record<string, string> = {},
  connection?: string
) {
  const s = routineSetup(),
    mission = s.studio.plan(
      owner,
      '1',
      'workflow',
      {
        ...studioInput(),
        memories: [],
        images: kind === 'receipt' ? [{ mime: 'image/png', data: 'QQ==' }] : [],
        sources: [routineSource]
      },
      [],
      routineSteps(kind, s.settings.chatModel, params, connection)
    )
  const compose = mission.steps.find(
      step => step.routine?.phase === 'compose'
    )!,
    step = mission.steps.at(-1)!,
    signal = new AbortController().signal
  const rows = (values: Record<string, string | null>[], artifact = false) => {
    const text = JSON.stringify(values)
    compose.state = 'done'
    compose.output = {
      text,
      images: [],
      ...(artifact
        ? {
            artifact: {
              name: 'result.json',
              rows: values.length,
              mime: 'application/json',
              data: Buffer.from(text).toString('base64')
            }
          }
        : {})
    }
  }
  const execute = () => s.routineExecutor.execute(owner, mission, step, signal)
  return { ...s, mission, compose, step, rows, execute, signal }
}
void test('routine executor delegates unchanged missions and guards cancellation, typed schema, stage and explicit materials', async () => {
  const s = setup('cards')
  assert.match(
    (
      await s.routineExecutor.execute(
        owner,
        s.mission,
        { ...s.step, routine: undefined } as unknown as MissionStep,
        s.signal
      )
    ).text,
    /Delegated/
  )
  await assert.rejects(
    s.routineExecutor.execute(owner, s.mission, s.step, AbortSignal.abort()),
    /cancelled/
  )
  const original = structuredClone(s.step.routine!)
  for (const change of [
    { kind: 'bad' },
    { fields: ['wrong'] },
    { phase: 'wrong' },
    {
      params: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i, 'x']))
    },
    { params: { x: 'x'.repeat(20001) } }
  ]) {
    Object.assign(s.step.routine!, change)
    await assert.rejects(s.execute(), /schema/)
    s.step.routine = structuredClone(original)
  }
  s.step.kind = 'compose'
  await assert.rejects(s.execute(), /local stage/)
  s.step.kind = 'local'
  await assert.rejects(s.execute(), /typed model/)
  s.compose.kind = 'local'
  await assert.rejects(
    s.routineExecutor.execute(owner, s.mission, s.compose, s.signal),
    /compose stage/
  )
  const receipt = setup('receipt')
  receipt.mission.input.images = []
  await assert.rejects(receipt.execute(), /explicit receipt/)
  const paid = setup('cards')
  await paid.routineExecutor.execute(
    owner,
    paid.mission,
    paid.compose,
    paid.signal
  )
  assert.equal(paid.model.calls.length, 1)
  delete paid.mission.input.sources
  paid.compose.routine!.model = null
  await paid.routineExecutor.execute(
    owner,
    paid.mission,
    paid.compose,
    paid.signal
  )
})
void test('calendar local validation requires reviewed service receipt and explicit offset timestamps or exact empty sentinel', async () => {
  const s = setup(
    'calendar',
    {
      start: String(Date.parse('2027-01-15T08:00Z')),
      end: String(Date.parse('2027-01-15T18:00Z'))
    },
    'mail'
  )
  s.calendar.connection(owner, 'mail')
  s.rows([{ event: null, title: null, start: null, end: null, state: 'none' }])
  await assert.rejects(s.execute(), /receipt/)
  const read = s.mission.steps[0]!
  read.state = 'done'
  read.receipt = { at: s.now(), text: 'No events' }
  assert.match((await s.execute()).text, /calendar preview/)
  assert.equal(s.data.get(owner).calendar, null)
  s.rows(
    [
      {
        event: '1',
        title: 'Meeting',
        start: '2027-01-15T09:00:00Z',
        end: '2027-01-15T10:00:00+00:00',
        state: 'busy'
      }
    ],
    true
  )
  await s.execute()
  for (const field of ['state', 'title', 'start', 'end']) {
    const row = {
      event: '1',
      title: 'Meeting',
      start: '2027-01-15T09:00:00Z',
      end: '2027-01-15T10:00:00Z',
      state: 'busy'
    }
    row[field as keyof typeof row] = ''
    s.rows([row])
    await assert.rejects(s.execute())
  }
  s.rows([
    {
      event: '1',
      title: 'Meeting',
      start: '2027-01-15T09:00',
      end: '2027-01-15T10:00:00Z',
      state: 'busy'
    }
  ])
  await assert.rejects(s.execute(), /offset/)
  s.rows([
    {
      event: '1',
      title: 'Meeting',
      start: '2027-01-15T09:00:00Z',
      end: '2027-01-15T10:00',
      state: 'busy'
    }
  ])
  await assert.rejects(s.execute(), /offset/)
})
void test('receipt and recall extraction stage proposals only and reject missing fields and invented source quotes', async () => {
  const receipt = setup('receipt'),
    row = {
      merchant: 'Shop',
      date: '2027-01-15',
      currency: 'USD',
      minor: '100',
      category: 'Food',
      evidence: 'Total $1.00'
    }
  receipt.rows([row])
  assert.match((await receipt.execute()).text, /receipt preview/)
  assert.equal(receipt.data.get(owner).expenses.length, 0)
  for (const field of routineSchemas.receipt.fields) {
    receipt.rows([{ ...row, [field]: null }])
    await assert.rejects(receipt.execute(), /Receipt fields/)
  }
  const cards = setup('cards'),
    card = {
      front: 'Question',
      back: 'Answer',
      source: routineSource.id,
      quote: 'persisted before an external effect'
    }
  cards.rows([card])
  assert.match((await cards.execute()).text, /cards preview/)
  for (const [field, value] of [
    ['front', null],
    ['back', null],
    ['source', 'missing'],
    ['quote', null],
    ['quote', 'invented']
  ]) {
    cards.rows([{ ...card, [field!]: value! }])
    await assert.rejects(cards.execute(), /exact quote/)
  }
  delete cards.mission.input.sources
  cards.rows([card])
  await assert.rejects(cards.execute())
  const pending = receipt.finance.manual(
    owner,
    scope,
    'Shop',
    '2027-01-15',
    'USD',
    '1.00',
    'Food'
  )
  receipt.finance.confirm(owner, scope, pending.token, 1)
})
void test('reply extraction binds revision and quote to completed service evidence before status acceptance', async () => {
  const s = setup('waiting', {}, 'mail'),
    item = s.waiting.add(
      owner,
      'Alice',
      'Request',
      routineSource,
      s.now() - 1000,
      s.now() + 1000
    )
  s.step.routine!.params = { id: item.id, revision: '1' }
  s.rows([
    { status: 'replied', quote: 'Received', date: '2027-01-15T08:00:00Z' }
  ])
  await assert.rejects(s.execute(), /completed approved/)
  s.mission.steps[0]!.state = 'done'
  s.mission.steps[0]!.output = { text: 'Received', images: [] }
  assert.match((await s.execute()).text, /waiting preview/)
  s.rows([
    { status: 'replied', quote: 'Received', date: '2027-01-15T08:00:00' }
  ])
  await assert.rejects(s.execute(), /completed approved/)
  s.rows([{ status: 'waiting', quote: null, date: null }])
  await s.execute()
  s.rows([{ status: null, quote: null, date: null }])
  await assert.rejects(s.execute())
  s.rows([
    { status: 'waiting', quote: null, date: null },
    { status: 'waiting', quote: null, date: null }
  ])
  await assert.rejects(s.execute())
})
void test('reading briefs retain only selected item attribution and reject duplicate, unknown or omitted results', async () => {
  const s = setup('brief'),
    source = s.reading.add(owner, 'rss', 'https://example.com/feed', 1)
  await s.reading.check(owner, source.id)
  const item = s.data.get(owner).reading[0]!
  s.step.routine!.params = { items: item.id }
  s.rows([
    {
      item: item.id,
      summary: 'Summary',
      why: 'Useful',
      uncertainty: 'Unverified'
    }
  ])
  const result = await s.execute()
  assert.match(result.text, /https:\/\/example.com\/article/)
  assert.equal(result.files![0]!.name, 'reading-brief.md')
  s.rows([{ item: item.id, summary: null, why: null, uncertainty: null }])
  await s.execute()
  for (const rows of [
    [{ item: null }],
    [{ item: 'wrong' }],
    [{ item: item.id }, { item: item.id }]
  ]) {
    s.rows(
      rows.map(row => ({ ...row, summary: 'S', why: 'W', uncertainty: 'U' }))
    )
    await assert.rejects(s.execute(), /unselected or duplicate/)
  }
  s.step.routine!.params.items = item.id + ',missing'
  s.rows([{ item: item.id, summary: 'S', why: 'W', uncertainty: 'U' }])
  await assert.rejects(s.execute(), /omitted/)
})
void test('large sourced daily previews retain full JSON even when the inline message is shortened', async () => {
  const s = setup('cards')
  s.rows(
    Array.from({ length: 20 }, (_, i) => ({
      front: 'Question ' + i,
      back: 'Answer '.repeat(150),
      source: routineSource.id,
      quote: 'A durable claim'
    }))
  )
  const result = await s.execute()
  assert.match(result.text, /Preview shortened/)
  assert.equal(
    (
      JSON.parse(
        Buffer.from(result.files![0]!.data, 'base64').toString()
      ) as unknown[]
    ).length,
    20
  )
})
