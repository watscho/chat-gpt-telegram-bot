import { test } from 'node:test'
import assert from 'node:assert/strict'
import { studioSetup, studioInput, studioFile } from '../../__tests__/studio.js'
void test('mission executor isolates public research, reserves scoped quota and carries only explicit completed evidence', async () => {
  const s = studioSetup(),
    mission = s.plan('research'),
    signal = new AbortController().signal
  s.model.answer = {
    text: 'Source-backed notes [1]',
    images: [],
    sources: [{ title: 'Primary source', url: 'https://example.com/evidence' }],
    toolsUsed: { images: 0, searches: 1 }
  }
  const first = await s.executor.execute(
    '42:42',
    mission,
    mission.steps[0]!,
    signal
  )
  assert.equal(s.usage.get('42:42').searches, 1)
  assert.deepEqual(s.model.calls[0]![0]!.documents, [])
  assert.deepEqual(s.model.options[0]!.memories, [])
  assert.equal(s.model.options[0]!.search, true)
  mission.steps[0]!.state = 'done'
  mission.steps[0]!.output = { ...first, files: [studioFile] }
  const second = await s.executor.execute(
    '42:42',
    mission,
    mission.steps[1]!,
    signal
  )
  assert.match(s.model.options.at(-1)!.references!, /Primary source/)
  assert.equal(second.files![0]!.name, studioFile.name)
  mission.steps[1]!.state = 'done'
  mission.steps[1]!.output = second
  mission.selected = 'v1'
  mission.versions = [
    {
      id: 'v1',
      parent: null,
      label: 'selected',
      createdAt: 0,
      reply: { text: 'Old selected version', images: [] }
    }
  ]
  const final = await s.executor.execute(
    '42:42',
    mission,
    mission.steps[2]!,
    signal
  )
  assert.equal(final.sources!.length, 1)
  assert.equal(final.files!.length, 1)
  assert.equal(s.model.options.at(-1)!.search, false)
  assert.match(s.model.options.at(-1)!.references!, /Old selected version/)
})
void test('executor uses the real workbench routing for analysis and always returns MCP proposals for separate approval', async () => {
  const s = studioSetup(),
    signal = new AbortController().signal,
    project = s.ws.create('42:42', 'Work')
  s.ws.configure('42:42', '1', { project: project.id })
  const mission = s.plan('autopilot', {
    ...studioInput(),
    project: project.id,
    documents: [studioFile]
  })
  const result = await s.executor.execute(
    '42:42',
    mission,
    mission.steps[0]!,
    signal
  )
  assert.equal(result.files![0]!.name, 'result.csv')
  assert.ok(s.provider.calls.some(call => call.method === 'analysis'))
  const chain = s.plan('chain', { ...studioInput(), project: project.id })
  const proposal = await s.executor.execute(
    '42:42',
    chain,
    chain.steps[1]!,
    signal
  )
  assert.ok(proposal.approval)
  chain.steps[1]!.continuation = proposal.approval.continuation
  const continued = await s.executor.execute(
    '42:42',
    chain,
    chain.steps[1]!,
    signal
  )
  assert.equal(continued.text, 'External result received.')
  assert.ok(
    s.usage.get('42:42').estimatedMicroUsd >=
      s.settings.workbench.estimateAnalysis +
        2 * s.settings.workbench.estimateConnection
  )
})
void test('executor rejects missing scope, cancellation, quota and ungrounded/oversized provider results without paid retries', async () => {
  const s = studioSetup(),
    mission = s.plan(),
    signal = new AbortController().signal
  await assert.rejects(
    s.executor.execute(
      '42:42',
      { ...mission, thread: 'missing' },
      mission.steps[0]!,
      signal
    ),
    /conversation/
  )
  await assert.rejects(
    s.executor.execute(
      '42:42',
      { ...mission, project: 'missing' },
      mission.steps[0]!,
      signal
    ),
    /project selection/
  )
  const stopped = new AbortController()
  stopped.abort()
  await assert.rejects(
    s.executor.execute('42:42', mission, mission.steps[0]!, stopped.signal)
  )
  s.model.answer = 'Normal result'
  const answer = await s.executor.execute(
    '42:42',
    mission,
    mission.steps[0]!,
    signal
  )
  assert.equal(answer.text, 'Normal result')
  for (const text of ['', 'x'.repeat(60001)]) {
    s.model.answer = text
    await assert.rejects(
      s.executor.execute('42:42', mission, mission.steps[0]!, signal)
    )
  }
  s.model.failure = true
  await assert.rejects(
    s.executor.execute('42:42', mission, mission.steps[0]!, signal)
  )
  s.model.failure = false
  s.model.answer = {
    text: 'Unsourced',
    images: [],
    sources: [{ title: 'Unsafe', url: 'javascript:bad' }]
  }
  const research = s.plan('research')
  await assert.rejects(
    s.executor.execute('42:42', research, research.steps[0]!, signal),
    /source links/
  )
  s.ws.limits('42:42', 'budget', 0)
  await assert.rejects(
    s.executor.execute('42:42', mission, mission.steps[0]!, signal),
    /budget/
  )
})
void test('research estimates account for search without usage metadata and chain continuations use the selected edited draft', async () => {
  const s = studioSetup(),
    signal = new AbortController().signal,
    research = s.plan('research')
  s.model.answer = {
    text: 'Evidence',
    images: [],
    sources: [{ title: 'Source', url: 'https://example.com' }]
  }
  await s.executor.execute('42:42', research, research.steps[0]!, signal)
  const mission = s.plan('chain')
  mission.steps[0]!.state = 'done'
  mission.steps[0]!.output = { text: 'Old draft', images: [] }
  mission.selected = 'edited'
  mission.versions = [
    {
      id: 'edited',
      parent: null,
      label: 'User edit',
      createdAt: 0,
      reply: { text: 'Only reviewed recipients', images: [] }
    }
  ]
  s.provider.connection = (_connection, _messages, options) => {
    assert.match(options.references!, /Only reviewed recipients/)
    assert.ok(!options.references!.includes('Old draft'))
    return Promise.resolve({ text: 'Approval pending', images: [] })
  }
  await s.executor.execute('42:42', mission, mission.steps[1]!, signal)
})
void test('mission quotes are revalidated before spending and explicit conversation model preferences apply at execution', async () => {
  const s = studioSetup(),
    mission = s.plan(),
    signal = new AbortController().signal
  mission.steps[0]!.estimate++
  await assert.rejects(
    s.executor.execute('42:42', mission, mission.steps[0]!, signal),
    /estimate changed/
  )
  assert.equal(s.model.calls.length, 0)
  assert.equal(s.usage.get('42:42').requests, 0)
  mission.steps[0]!.estimate--
  s.ws.configure('42:42', '1', { model: 'chosen-model' })
  await s.executor.execute('42:42', mission, mission.steps[0]!, signal)
  assert.equal(s.model.options[0]!.chatModel, 'chosen-model')
})
void test('long retained evidence is explicitly marked as an excerpt before the next model stage', async () => {
  const s = studioSetup(),
    mission = s.plan()
  mission.steps[0]!.state = 'done'
  mission.steps[0]!.output = { text: 'x'.repeat(12001), images: [] }
  await s.executor.execute(
    '42:42',
    mission,
    mission.steps[1]!,
    new AbortController().signal
  )
  assert.match(s.model.options[0]!.references!, /Excerpt truncated/)
})
