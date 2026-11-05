import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SuiteWorkspace } from '../suite-workspace.js'
import { StudioWorkspace } from '../studio-workspace.js'
import { suiteSearch } from '../suite-search.js'
import { Library } from '../library.js'
import { Experience } from '../experience.js'
import { Conversations } from '../conversations.js'
import { suiteSetup, suiteSource } from '../../__tests__/suite.js'
import { suiteSettings } from '../suite-settings.js'
import { loadConfig } from '../../config.js'
const owner = '42:42'
void test('Suite settings validate operator models, tool paths and numeric budgets with sanitized config errors', () => {
  const integer = (_key: string, fallback: number, _max: number) => {
    void _key
    void _max
    return fallback
  }
  assert.equal(
    suiteSettings(
      { OPENAI_REVIEW_MODELS: 'a,a,b', FFPROBE_PATH: ' /trusted/ffprobe ' },
      integer
    ).reviewModels.join(),
    'a,b'
  )
  for (const env of [
    { OPENAI_REVIEW_MODELS: '' },
    { OPENAI_REVIEW_MODELS: 'a, bad model' },
    {
      OPENAI_REVIEW_MODELS: Array.from({ length: 11 }, (_, i) => `m${i}`).join()
    },
    { FFPROBE_PATH: 'x'.repeat(513) },
    { FFPROBE_PATH: 'x\ny' },
    { FFPROBE_PATH: 'x\u0000y' }
  ])
    assert.throws(() => suiteSettings(env, integer))
  assert.equal(
    suiteSettings({ FFPROBE_PATH: '' }, integer).ffprobePath,
    'ffprobe'
  )
  assert.throws(
    () =>
      loadConfig({
        TELEGRAM_API_KEY: '123456:test',
        OPENAI_API_KEY: 'private-token',
        ALLOWED_TELEGRAM_USER_IDS: '42',
        OPENAI_REVIEW_MODELS: 'private-token invalid'
      }),
    /configuration/i
  )
})
void test('Suite workspace redacts review tokens and file bytes, scopes source selection and supports only bounded local actions', () => {
  const s = suiteSetup(),
    view = new SuiteWorkspace(s.suite, s.watches, s.teams, s.search, true)
  const record = s.suite.putRecord(owner, {
    kind: 'decision',
    title: 'Decision',
    thread: '1',
    project: null,
    fields: {},
    rows: [{ quote: 'Exact text' }],
    sources: [suiteSource]
  })
  s.suite.saveTemplate(owner, s.suite.template(owner, 'default'))
  s.suite.criterion(owner, null, 'Quality', 'Review evidence')
  s.suite.saveRecipe(owner, 'brief', 'Prepare', [
    { kind: 'compose', title: 'Draft', prompt: 'Write', connection: null }
  ])
  const watch = s.watches.add(
      owner,
      '1',
      { kind: 'url', url: 'https://example.com' },
      3600000,
      0
    ),
    team = s.teams.create(owner, 'Shared')
  s.teams.publish(
    owner,
    team.id,
    team.revision,
    [{ name: 'report.txt', mime: 'text/plain', data: 'QQ==' }],
    ['A note']
  )
  s.suite.stage(
    owner,
    { thread: '1', project: null, sourceRevision: undefined },
    'share',
    { secret: 'review-token-secret' }
  )
  let result = view.snapshot(owner)
  assert.doesNotMatch(JSON.stringify(result), /review-token-secret|QQ==/)
  assert.equal(result.records[0]!.sources[0]!.title, suiteSource.title)
  result = view.action(owner, {
    action: 'suite:search',
    id: '',
    value: 'report'
  })
  const hit = result.hits[0]!
  view.action(owner, { action: 'suite:select', id: hit.id })
  assert.equal(view.snapshot(owner).selected.length, 1)
  view.action(owner, { action: 'suite:clear', id: '' })
  view.action(owner, { action: 'suite:watch', id: watch.id, value: false })
  assert.equal(s.watches.item(owner, watch.id).enabled, false)
  const file = s.teams.inspect(owner, team.id).files[0]!
  assert.equal(view.file(owner, team.id, file.id, file.name).data, 'QQ==')
  assert.throws(() => view.file(owner, team.id, file.id, 'changed'))
  assert.equal(s.teams.export(owner)[0]!.files[0]!.file.data, 'QQ==')
  for (const body of [
    { action: 'suite:search', id: '' },
    { action: 'suite:watch', id: watch.id, value: 'false' },
    { action: 'suite:delete', id: record.id },
    { action: 'suite:unknown', id: '' },
    { action: 'suite:clear', id: '', extra: true },
    { action: 1, id: '' },
    { action: 'suite:clear', id: 1 },
    { action: 'suite:clear', id: 'x'.repeat(121) }
  ])
    assert.throws(() => view.action(owner, body))
  view.action(owner, { action: 'suite:delete', id: record.id, confirm: true })
  assert.equal(view.snapshot(owner).records.length, 0)
  assert.equal(
    new SuiteWorkspace(s.suite, s.watches, s.teams, s.search, false).snapshot(
      owner
    ).teams.length,
    0
  )
  const workspace = new StudioWorkspace(
    s.studio,
    s.profiles,
    s.ws,
    s.workflow,
    s.usage,
    s.jobs,
    view
  )
  assert.equal(
    workspace.action(owner, { action: 'suite:search', id: '', value: 'report' })
      .suite!.hits.length,
    1
  )
  assert.equal(
    workspace.file(owner, `team:${team.id}`, file.id, file.name).name,
    file.name
  )
  assert.throws(
    () => s.view.action(owner, { action: 'suite:clear', id: '' }),
    /unavailable/
  )
  assert.throws(
    () => s.view.file(owner, `team:${team.id}`, file.id, file.name),
    /unavailable/
  )
})
void test('owner-wide search collects retained conversations, notes, projects, library passages, tasks, bookmarks, Inbox, result revisions and records', async () => {
  const s = suiteSetup(),
    conversations = new Conversations(s.model, s.settings, Date.now, s.store),
    library = new Library(
      () => Promise.resolve([{ location: 'page 1', text: 'Alpha evidence' }]),
      s.store
    ),
    experience = new Experience(s.store)
  s.profiles.remember(owner, 'Alpha note')
  await conversations.respond(`${owner}:1`, 'Alpha conversation')
  const project = s.ws.create(owner, 'Alpha project')
  s.ws.updateProject(owner, project.id, 'remember', 'Alpha project note')
  s.ws.updateProject(owner, project.id, 'attach', {
    name: 'alpha.txt',
    mime: 'text/plain',
    data: Buffer.from('Alpha file').toString('base64')
  })
  await library.add(owner, project.id, {
    name: 'alpha.pdf',
    mime: 'application/pdf',
    data: 'QQ=='
  })
  s.workflow.addTask(owner, '1', 'Alpha task', null)
  s.workflow.addTask(owner, '1', 'Alpha dated task', Date.now() + 60000)
  experience.bookmark(owner, 'Alpha bookmark', 'Alpha saved text')
  s.studio.capture(owner, {
    source: '1',
    thread: '1',
    project: null,
    text: 'Alpha Inbox',
    images: [],
    documents: [],
    recording: null
  })
  await s.finish(s.plan('brief'))
  s.suite.putRecord(owner, {
    kind: 'decision',
    title: 'Alpha record',
    thread: '1',
    project: null,
    fields: {},
    rows: [{ decision: 'Alpha decision' }],
    sources: [suiteSource]
  })
  const search = suiteSearch(
      s.profiles,
      s.ws,
      conversations,
      library,
      s.workflow,
      experience,
      s.studio,
      s.suite
    ),
    kinds = new Set(search.search(owner, 'Alpha').map(hit => hit.kind))
  for (const kind of [
    'conversation',
    'note',
    'project',
    'file',
    'library',
    'task',
    'bookmark',
    'inbox',
    'decision'
  ])
    assert.ok(kinds.has(kind), kind)
  assert.equal(search.search('43:43', 'Alpha').length, 0)
})
