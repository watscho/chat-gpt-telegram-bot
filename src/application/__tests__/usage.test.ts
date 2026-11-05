import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config, MemoryStateStore } from '../../__tests__/helpers.js'
import { Workspaces } from '../workspaces.js'
import { UsageLedger } from '../usage.js'

void test('quota reservations are atomic locally, reconciled once and durable across ledger recreation', () => {
  const settings = {
    ...config(),
    estimateChat: 10,
    estimateImage: 20,
    estimateSearch: 5,
    estimateVoice: 8,
    estimateTranscription: 7
  }
  const store = new MemoryStateStore()
  const ws = new Workspaces(settings, store)
  let now = 0
  let ledger = new UsageLedger(settings, ws, store, () => now)
  const pending = ledger.reserve('a', 'auto')
  assert.equal(ledger.get('a').estimatedMicroUsd, 85)
  assert.equal(ledger.get('b').requests, 0)
  pending.finish({ images: 1, searches: 1 })
  assert.equal(ledger.get('a').estimatedMicroUsd, 35)
  pending.finish({ images: 0, searches: 0 })
  pending.fail()
  assert.equal(ledger.get('a').estimatedMicroUsd, 35)
  const failed = ledger.reserve('a', 'image')
  failed.fail()
  failed.fail()
  failed.finish()
  assert.equal(ledger.get('a').failed, 1)
  ledger.reserve('a', 'voice').finish()
  ledger.reserve('a', 'transcription').finish()
  ledger.reserve('a', 'chat').finish({ images: -1, searches: 99 })
  ledger = new UsageLedger(settings, ws, store, () => now)
  assert.equal(ledger.get('a').transcriptions, 1)
  assert.match(ledger.report('a'), /operator-configured/)
  const old = ledger.reserve('a', 'search')
  const oldFailure = ledger.reserve('b', 'chat')
  now = 86400000
  old.finish({ images: 0, searches: 0 })
  oldFailure.fail()
  assert.equal(ledger.get('a').requests, 0)
  assert.equal(ledger.get('b').failed, 0)
})
void test('daily monetary, request and feature caps block paid work while auto chat can disable unaffordable tools', () => {
  const settings = {
    ...config(),
    estimateChat: 10,
    estimateImage: 20,
    estimateSearch: 5,
    dailyBudgetMicroUsd: 100,
    estimateVoice: 8,
    dailyImages: 1,
    dailySearches: 2,
    dailyVoice: 1
  }
  const ws = new Workspaces(settings)
  const ledger = new UsageLedger(settings, ws)
  let reserved = ledger.reserve('a', 'auto')
  assert.equal(reserved.options.maxToolCalls, 1)
  reserved.finish({ images: 1, searches: 0 })
  assert.throws(() => ledger.reserve('a', 'image'), /feature limit/)
  reserved = ledger.reserve('a', 'auto')
  assert.equal(reserved.options.enableImages, false)
  reserved.finish({ images: 0, searches: 2 })
  assert.throws(() => ledger.reserve('a', 'search'), /feature limit/)
  const chat = ledger.reserve('a', 'auto')
  assert.equal(chat.options.enableSearch, false)
  chat.finish({ images: 0, searches: 0 })
  ledger.reserve('b', 'voice').finish()
  assert.throws(() => ledger.reserve('b', 'voice'), /limit/)
  ws.limits('c', 'budget', 12)
  const low = ledger.reserve('c', 'auto')
  assert.equal(low.options.enableImages, false)
  assert.equal(low.options.enableSearch, false)
  low.finish({ images: 0, searches: 0 })
  assert.throws(() => ledger.reserve('c', 'chat'), /budget/)
  const single = new UsageLedger({ ...settings, dailyRequests: 1 }, ws)
  single.reserve('x', 'chat').finish()
  assert.throws(() => single.reserve('x', 'chat'), /limit/)
  const poor = new UsageLedger(
    { ...settings, dailyBudgetMicroUsd: 5 },
    new Workspaces({ ...settings, dailyBudgetMicroUsd: 5 })
  )
  assert.throws(() => poor.reserve('x', 'chat'), /budget/)
  ws.limits('d', 'imageLimit', 0)
  ws.limits('d', 'searchLimit', 0)
  ws.limits('d', 'voiceLimit', 0)
  assert.throws(() => ledger.reserve('d', 'voice'), /limit/)
  const disabled = ledger.reserve('d', 'auto')
  assert.equal(disabled.options.enableImages, false)
  assert.equal(disabled.options.enableSearch, false)
})

void test('project estimates share the owner reservation write, refund unused tools and preserve UTC-day isolation', () => {
  const settings = config(),
    store = new MemoryStateStore(),
    ws = new Workspaces(settings, store)
  let now = 0
  const ledger = new UsageLedger(settings, ws, store, () => now),
    project = ws.create('a', 'Work')
  assert.throws(() => ledger.reserve('a', 'chat', true, 'missing'))
  assert.throws(() => ledger.projectReport('a', 'missing'))
  assert.match(ledger.projectReport('a', project.id), /Requests: 0/)
  for (const value of [-1, NaN, settings.dailyBudgetMicroUsd + 1])
    assert.throws(() => ws.projectBudget('a', project.id, value))
  assert.throws(() => ws.projectBudget('a', 'missing', 1))
  ws.projectBudget('a', project.id, settings.estimateChat)
  const chat = ledger.reserve('a', 'chat', true, project.id)
  chat.finish()
  assert.equal(ledger.get('a').projects![project.id]!.requests, 1)
  assert.throws(() => ledger.reserve('a', 'chat', true, project.id), /budget/)
  ws.projectBudget('a', project.id, settings.dailyBudgetMicroUsd)
  const tools = ledger.reserve('a', 'auto', true, project.id)
  tools.finish({ images: 0, searches: 0 })
  assert.equal(
    ledger.get('a').projects![project.id]!.estimatedMicroUsd,
    settings.estimateChat * 2
  )
  const failure = ledger.reserve('a', 'voice', true, project.id)
  failure.fail()
  assert.equal(ledger.get('a').projects![project.id]!.failed, 1)
  assert.match(ledger.projectReport('a', project.id), /failed: 1/)
  const pending = ledger.reserve('a', 'chat', true, project.id)
  now = 86400000
  pending.fail()
  assert.equal(ledger.get('a').requests, 0)
  const late = ledger.reserve('a', 'auto', true, project.id)
  now += 86400000
  late.finish({ images: 0, searches: 0 })
  assert.equal(ledger.get('a').requests, 0)
})
