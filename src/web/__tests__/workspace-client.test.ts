import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mountWorkspace } from '../workspace-client.js'
import { workspacePage, workspaceStyles } from '../workspace-page.js'
import { workspaceDOM, type WorkspaceElement } from './workspace-helpers.js'
import { settle } from './helpers.js'
import { studioSetup, studioFile } from '../../__tests__/studio.js'
void test('workspace document escapes its base path and supplies responsive accessible working controls', () => {
  const page = workspacePage('/<&"/')
  assert.match(page, /&lt;&amp;&quot;/)
  assert.match(page, /aria-live="polite"/)
  assert.match(page, /workspace-client.js/)
  assert.match(workspaceStyles, /prefers-reduced-motion/)
  assert.match(workspaceStyles, /grid-template-columns/)
})
void test('workspace UI uses plain text, owner-authenticated requests, explicit reviews and retained version edits', async t => {
  const s = studioSetup(),
    done = await s.finish(s.plan()),
    project = s.ws.create('42:42', 'Work')
  s.ws.updateProject('42:42', project.id, 'attach', studioFile)
  s.workflow.addTask(
    '42:42',
    '1',
    'Review <script>literal</script>',
    Date.now() + 60000
  )
  s.studio.capture('42:42', {
    source: '1',
    thread: '1',
    project: null,
    text: 'Inbox <script>literal</script>',
    documents: [studioFile],
    images: [],
    recording: null
  })
  s.workflow.addTask('42:42', '1', 'No deadline', null)
  const captured = s.studio.get('42:42').inbox[0]!
  s.studio.capture('42:42', {
    ...captured,
    source: 'recording',
    text: '',
    recording: {
      file: 'audio',
      name: 'meeting.ogg',
      mime: 'audio/ogg',
      bytes: null,
      seconds: null
    }
  })
  s.studio.capture('42:42', {
    ...captured,
    source: 'image',
    text: '',
    documents: [],
    images: [{ data: 'YQ==', mime: 'image/png' }]
  })
  s.jobs.enqueue('42:42', '1', 'summary', {
    prompt: 'Summarize',
    documents: [],
    images: [],
    instructions: '',
    memories: []
  })
  let ok = true,
    body: unknown,
    selected: string | undefined,
    downloaded = false
  const requests: Record<string, unknown>[] = []
  t.mock.method(
    globalThis,
    'fetch',
    (url: string | URL | Request, init?: RequestInit) => {
      const address = new URL(url instanceof Request ? url.url : String(url))
      assert.equal(
        (init!.headers as Record<string, string>)['X-Telegram-Init-Data'],
        'signed'
      )
      if (address.pathname.endsWith('/file')) {
        downloaded = true
        return Promise.resolve(new Response('file', { status: ok ? 200 : 404 }))
      }
      if (init?.body) {
        const action = JSON.parse(
          typeof init.body === 'string' ? init.body : '{}'
        ) as Record<string, unknown>
        requests.push(action)
        if (action.action === 'inspect') selected = String(action.id)
        body = s.view.action('42:42', action)
      } else {
        selected = address.searchParams.get('mission') ?? undefined
        body = s.view.snapshot('42:42', selected)
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: ok ? 200 : 400 })
      )
    }
  )
  t.mock.method(URL, 'createObjectURL', () => 'blob:download')
  t.mock.method(URL, 'revokeObjectURL', () => {})
  const d = workspaceDOM(),
    app = mountWorkspace(d.document, d.window)
  await settle()
  assert.equal(d.nodes.status!.textContent, 'Updated')
  assert.match(d.nodes.usage!.textContent, /requests today/)
  const missionButton = d.nodes.list!.children[0]!.children.find(
    node => node.textContent === 'Open'
  )!
  missionButton.events.click!()
  await settle()
  assert.equal(d.nodes.detail!.hidden, false)
  assert.match(d.nodes.result!.value, /Report based/)
  d.nodes.result!.value = 'Edited <script>literal</script>'
  d.nodes.result!.events.input!()
  await app.refresh()
  assert.equal(d.nodes.result!.value, 'Edited <script>literal</script>')
  d.find('actions', 'Save text version').click()
  await settle()
  assert.equal(
    s.studio.result('42:42', done.id).reply.text,
    'Edited <script>literal</script>'
  )
  d.nodes.result!.value = 'Unsaved'
  d.nodes.result!.events.input!()
  d.confirm(false)
  d.find('actions', 'Restore selected version').click()
  await settle()
  assert.equal(d.nodes.result!.value, 'Unsaved')
  d.confirm(true)
  d.find('actions', 'Restore selected version').click()
  await settle()
  const fileButton = d.nodes.files!.children.find(node =>
    node.textContent.startsWith('Download')
  )!
  fileButton.events.click!()
  await settle()
  assert.equal(downloaded, true)
  ok = false
  fileButton.events.click!()
  await settle()
  assert.equal(d.nodes.error!.hidden, false)
  ok = true
  for (const name of ['Inbox', 'Tasks', 'Files', 'Jobs', 'Missions']) {
    d.find('nav', name).click()
    assert.equal(d.nodes.title!.textContent, name)
    if (name === 'Inbox') {
      const row = d.nodes.list!.children[0]!
      assert.match(row.children[0]!.textContent, /<script>literal/)
      const select = row.children.find(
        node => (node as WorkspaceElement).tag === 'select'
      )!
      select.value = project.id
      select.events.change!()
      await settle()
      d.confirm(false)
      row.children.find(node => node.textContent === 'Delete')!.events.click!()
      d.confirm(true)
      d.nodes.list!.children[0]!.children.find(
        node => node.textContent === 'Delete'
      )!.events.click!()
      await settle()
    }
    if (name === 'Tasks') {
      d.nodes.list!.children[0]!.children.find(
        node => node.textContent === 'Mark done'
      )!.events.click!()
      await settle()
      d.nodes.list!.children[0]!.children.find(
        node => node.textContent === 'Reopen'
      )!.events.click!()
      await settle()
    }
    if (name === 'Files') {
      d.nodes.list!.children[0]!.children.find(
        node => node.textContent === 'Download'
      )!.events.click!()
      await settle()
    }
  }
  d.nodes.project!.value = project.id
  d.nodes.project!.events.change!()
  await settle()
  s.profiles.create('42:42', 'Other')
  d.nodes.thread!.value = '1'
  d.nodes.thread!.events.change!()
  await settle()
  const draft = s.plan('research')
  await app.refresh()
  d.nodes
    .list!.children.find(node => node.children[0]!.textContent === draft.title)!
    .children.find(node => node.textContent === 'Open')!.events.click!()
  await settle()
  // Inspect the draft explicitly when titles happen to match the completed mission.
  selected = draft.id
  s.view.action('42:42', { action: 'inspect', id: draft.id })
  const d2 = workspaceDOM()
  const second = mountWorkspace(d2.document, d2.window)
  await settle()
  // Open the final row: it is the newly planned mission.
  d2.nodes
    .list!.children.at(-1)!
    .children.find(node => node.textContent === 'Open')!.events.click!()
  await settle()
  d2.confirm(false)
  d2.find('actions', 'Approve plan and estimate').click()
  d2.confirm(true)
  d2.find('actions', 'Approve plan and estimate').click()
  d2.find('actions', 'Approve plan and estimate').click()
  await settle()
  d2.find('actions', 'Pause').click()
  await settle()
  d2.find('actions', 'Resume').click()
  await settle()
  d2.confirm(false)
  d2.find('actions', 'Cancel').click()
  d2.confirm(true)
  d2.find('actions', 'Cancel').click()
  await settle()
  assert.equal(s.studio.mission('42:42', draft.id).state, 'cancelled')
  ok = false
  d2.nodes.project!.events.change!()
  await settle()
  assert.equal(d2.nodes.error!.hidden, false)
  ok = true
  d2.nodes.refresh!.events.click!()
  await settle()
  d2.events.pagehide!()
  await second.refresh()
  assert.ok(requests.some(request => request.action === 'start'))
  d.events.pagehide!()
})
void test('workspace handles missing Telegram access, malformed responses, empty sections and stale async completions', async t => {
  const s = studioSetup()
  let value: unknown = s.view.snapshot('42:42'),
    ok = true,
    release!: () => void,
    pending = false
  t.mock.method(globalThis, 'fetch', () => {
    if (pending)
      return new Promise<Response>(resolve => {
        release = () => resolve(new Response(JSON.stringify(value)))
      })
    return Promise.resolve(
      new Response(JSON.stringify(value), { status: ok ? 200 : 403 })
    )
  })
  for (const window of [
    { addEventListener() {}, confirm: () => false },
    { Telegram: {}, addEventListener() {}, confirm: () => false }
  ]) {
    const d = workspaceDOM()
    mountWorkspace(d.document, window)
    assert.match(d.nodes.status!.textContent, /Telegram/)
  }
  const d = workspaceDOM(),
    app = mountWorkspace(d.document, d.window)
  await settle()
  assert.match(d.nodes.list!.children[0]!.children[0]!.textContent, /Nothing/)
  d.find('nav', 'Inbox').click()
  d.find('nav', 'Tasks').click()
  d.nodes.result!.events.input!()
  for (const invalid of [
    null,
    [],
    { missions: [] },
    { projects: [] },
    { missions: 1, projects: [] },
    { missions: [], projects: 1 }
  ]) {
    value = invalid
    await app.refresh()
    assert.equal(d.nodes.error!.hidden, false)
  }
  value = s.view.snapshot('42:42')
  ok = false
  await app.refresh()
  ok = true
  pending = true
  const late = app.refresh()
  d.events.pagehide!()
  release()
  await late
  assert.equal(d.nodes.status!.textContent, 'Loading…')
  const e = workspaceDOM()
  mountWorkspace(e.document, e.window)
  e.events.pagehide!()
  release()
  await settle()
  assert.throws(
    () =>
      mountWorkspace({ ...d.document, getElementById: () => null }, d.window),
    /incomplete/
  )
})
void test('workspace presents editable paused service drafts and exact pending action arguments without executing approvals', async t => {
  const s = studioSetup(),
    mission = s.plan('chain'),
    owner = '42:42'
  s.studio.start(owner, mission.id, 1)
  await s.studio.tick()
  t.mock.method(
    globalThis,
    'fetch',
    (url: string | URL | Request, init?: RequestInit) => {
      const address = new URL(url instanceof Request ? url.url : String(url)),
        body = init?.body
          ? (JSON.parse(
              typeof init.body === 'string' ? init.body : '{}'
            ) as Record<string, unknown>)
          : undefined
      return Promise.resolve(
        new Response(
          JSON.stringify(
            body
              ? s.view.action(owner, body)
              : s.view.snapshot(
                  owner,
                  address.searchParams.get('mission') ?? undefined
                )
          )
        )
      )
    }
  )
  const d = workspaceDOM(),
    app = mountWorkspace(d.document, d.window)
  await settle()
  d.nodes.list!.children[0]!.children.find(node => node.textContent === 'Open')!
    .events.click!()
  await settle()
  assert.match(d.nodes.review!.textContent, /paused/)
  d.find('actions', 'Save text version').click()
  await settle()
  d.find('actions', 'Restore selected version').click()
  await settle()
  d.nodes.result!.value = 'First edit'
  d.nodes.result!.events.input!()
  d.nodes.result!.value = 'Final reviewed draft'
  d.nodes.result!.events.input!()
  d.find('actions', 'Save text version').click()
  await settle()
  d.find('actions', 'Resume').click()
  await settle()
  s.ports.execute = () =>
    Promise.resolve({
      text: 'Review actions',
      images: [],
      approval: {
        connection: 'mail',
        continuation: 'secret-continuation',
        calls: [
          { id: 'a1', name: 'send', arguments: '{"to":"draft@example.com"}' }
        ]
      }
    })
  await s.studio.tick()
  await app.refresh()
  assert.match(d.nodes.review!.textContent, /send\n.*draft@example.com/)
  assert.ok(!d.nodes.review!.textContent.includes('secret-continuation'))
  assert.ok(
    !d.nodes.actions!.children.some(node =>
      node.textContent.startsWith('Approve')
    )
  )
  d.events.pagehide!()
})
void test('workspace refresh races and repeated actions cannot replace a newer review or render after page closure', async t => {
  const s = studioSetup(),
    done = await s.finish(s.plan()),
    pending: {
      resolve: (response: Response) => void
      reject: (reason: Error) => void
    }[] = []
  let deferred = false
  t.mock.method(globalThis, 'fetch', () =>
    deferred
      ? new Promise<Response>((resolve, reject) => {
          pending.push({ resolve, reject })
        })
      : Promise.resolve(new Response(JSON.stringify(s.view.snapshot('42:42'))))
  )
  const d = workspaceDOM(),
    app = mountWorkspace(d.document, d.window)
  await settle()
  deferred = true
  const old = app.refresh()
  d.nodes.list!.children[0]!.children.find(node => node.textContent === 'Open')!
    .events.click!()
  d.nodes.list!.children[0]!.children.find(node => node.textContent === 'Open')!
    .events.click!()
  assert.equal(pending.length, 2)
  pending[1]!.resolve(
    new Response(JSON.stringify(s.view.snapshot('42:42', done.id)))
  )
  await settle()
  pending[0]!.resolve(new Response(JSON.stringify(s.view.snapshot('42:42'))))
  await old
  assert.equal(d.nodes.detail!.hidden, false)
  d.nodes.project!.events.change!()
  const newer = app.refresh()
  pending[3]!.resolve(new Response(JSON.stringify(s.view.snapshot('42:42'))))
  await newer
  assert.equal(d.nodes.detail!.hidden, false)
  d.events.pagehide!()
  pending[2]!.resolve(new Response(JSON.stringify(s.view.snapshot('42:42'))))
  await settle()
  const e = workspaceDOM()
  mountWorkspace(e.document, e.window)
  e.events.pagehide!()
  pending[4]!.reject(new Error('Late transport failure'))
  await settle()
  assert.equal(e.nodes.error!.hidden, false)
})
