import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mountWorkspace } from '../workspace-client.js'
import { workspaceDOM, type WorkspaceElement } from './workspace-helpers.js'
import { settle } from './helpers.js'
import { suiteSetup, suiteSource } from '../../__tests__/suite.js'
import { SuiteWorkspace } from '../../application/suite-workspace.js'
import { StudioWorkspace } from '../../application/studio-workspace.js'
void test('Suite Mini App renders scoped records, source selection, watch controls, recipes and authorized shared downloads through DOM doubles', async t => {
  const s = suiteSetup(),
    owner = '42:42',
    suite = new SuiteWorkspace(s.suite, s.watches, s.teams, s.search, true),
    workspace = new StudioWorkspace(
      s.studio,
      s.profiles,
      s.ws,
      s.workflow,
      s.usage,
      s.jobs,
      suite
    )
  const record = s.suite.putRecord(owner, {
    kind: 'form',
    title: '<script>literal</script>',
    thread: '1',
    project: null,
    fields: {},
    rows: [{ field: 'email', value: null }],
    sources: [suiteSource]
  })
  s.suite.saveTemplate(owner, s.suite.template(owner, 'default'))
  s.suite.criterion(owner, null, 'Clarity', 'Use clear wording')
  s.suite.saveRecipe(owner, 'brief', 'Prepare a brief', [
    { kind: 'compose', title: 'Draft', prompt: 'Write', connection: null }
  ])
  const watch = s.watches.add(
    owner,
    '1',
    { kind: 'url', url: 'https://example.com' },
    3600000,
    0
  )
  const watches = s.watches.get(owner)
  watches[0]!.changes = [
    { at: 1, before: 'a', after: 'b', diff: 'Changed text', notified: true }
  ]
  s.store.putRecord('watches', owner, watches)
  s.watches.refresh(owner)
  const team = s.teams.create(owner, 'Shared work')
  s.teams.publish(
    owner,
    team.id,
    team.revision,
    [{ name: 'report.txt', mime: 'text/plain', data: 'QQ==' }],
    ['Reviewed shared note']
  )
  s.teams.task(
    owner,
    team.id,
    s.teams.inspect(owner, team.id).revision,
    'Review report',
    null
  )
  const task = s.teams.inspect(owner, team.id).tasks[0]!
  s.teams.task(
    owner,
    team.id,
    s.teams.inspect(owner, team.id).revision,
    task.title,
    null,
    task.id,
    true
  )
  s.teams.task(
    owner,
    team.id,
    s.teams.inspect(owner, team.id).revision,
    'Open task',
    owner
  )
  const requests: Record<string, unknown>[] = [],
    downloads: string[] = []
  t.mock.method(
    globalThis,
    'fetch',
    (url: URL | RequestInfo, init?: RequestInit) => {
      const address = new URL(url instanceof Request ? url.url : url)
      if (address.pathname.endsWith('/file')) {
        downloads.push(address.search)
        return Promise.resolve(new Response('file'))
      }
      const body = init?.body
        ? (JSON.parse(
            typeof init.body === 'string' ? init.body : '{}'
          ) as Record<string, unknown>)
        : null
      if (body) requests.push(body)
      const result = body
        ? workspace.action(owner, body)
        : workspace.snapshot(owner)
      return Promise.resolve(new Response(JSON.stringify(result)))
    }
  )
  t.mock.method(URL, 'createObjectURL', () => 'blob:unit-file')
  t.mock.method(URL, 'revokeObjectURL', () => {})
  const d = workspaceDOM(),
    app = mountWorkspace(d.document, d.window)
  await settle()
  d.find('nav', 'Suite').click()
  const button = (label: string) => {
    const nodes = d.nodes.list!.children.flatMap(
        node => node.children
      ) as WorkspaceElement[],
      found = nodes.find(node => node.textContent === label)
    if (!found) throw new Error(`Missing Suite control ${label}`)
    return found
  }
  const search = d.nodes
    .list!.children.flatMap(node => node.children)
    .find(node => (node as WorkspaceElement).tag === 'input')!
  search.value = 'report'
  button('Search').click()
  await settle()
  button('Select source').click()
  await settle()
  assert.equal(s.suite.get(owner).selected.length, 1)
  button('Clear selected sources').click()
  await settle()
  assert.equal(s.suite.get(owner).selected.length, 0)
  button('Disable watch').click()
  await settle()
  assert.equal(s.watches.item(owner, watch.id).enabled, false)
  button('Enable watch').click()
  await settle()
  button('Download report.txt').click()
  await settle()
  assert.match(downloads[0]!, /team%3A/)
  d.confirm(false)
  button('Delete record').click()
  await settle()
  assert.ok(s.suite.record(owner, record.id))
  d.confirm(true)
  button('Delete record').click()
  await settle()
  assert.equal(s.suite.get(owner).records.length, 0)
  assert.ok(requests.some(body => body.action === 'suite:delete'))
  await app.refresh()
})
