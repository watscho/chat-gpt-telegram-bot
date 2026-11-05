import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderDesk } from '../desk-panel.js'
import { deskSetup, deskPNG, owner, scope } from '../../__tests__/desk.js'
import { routineSource } from '../../__tests__/routines.js'
import { deskDOM, trigger } from './desk-helpers.js'
import { mountWorkspace } from '../workspace-client.js'
import { StudioWorkspace } from '../../application/studio-workspace.js'
import { settle } from './helpers.js'
void test('Desk UI provides usable primary navigation, forms, assistant permissions and explicit authorization controls', () => {
  const s = deskSetup(),
    dom = deskDOM(),
    root = dom.nodes.list!,
    calls: Record<string, unknown>[] = [],
    inspected: string[] = [],
    downloads: string[] = [],
    drafts = new Map<string, { revision: number; text: string }>()
  let confirm = false,
    redrawn = 0
  const draw = (section: string) => {
    dom.created.length = 0
    root.replaceChildren()
    renderDesk(
      dom.document,
      root as unknown as HTMLElement,
      s.deskView.snapshot(owner),
      section,
      {
        act: body => calls.push(body),
        inspect: id => inspected.push(id),
        download: id => downloads.push(id),
        confirm: () => confirm,
        redraw: () => {
          redrawn++
        },
        drafts
      }
    )
  }
  const click = (label: string) => {
    const node = dom.created.find(
      item => item.tag === 'button' && item.textContent === label
    )
    assert.ok(node, label)
    node.click()
  }
  const submit = (label: string, values: Record<string, string> = {}) => {
    const form = dom.created.find(
      item =>
        item.tag === 'form' &&
        item.children.some(child => child.textContent === label)
    )
    assert.ok(form, label)
    for (const input of dom.created.filter(item => item.tag === 'input'))
      if (input.attributes['aria-label']! in values)
        input.value = values[input.attributes['aria-label']!]!
    trigger(form, 'submit')
  }
  draw('Ask')
  submit('Prepare request')
  draw('Create')
  submit('Create document')
  submit('Review table')
  draw('Assistants')
  submit('Create assistant')
  click('Use normal chat')
  const id = s.data.assistant(owner, 'Editor', 'Instructions', null, [])
  s.data.assistantSources(owner, id, [routineSource])
  s.data.use(owner, '1', id)
  s.data.assistant(owner, 'Other', 'Help', null, [])
  draw('Ask')
  submit('Prepare request')
  draw('Assistants')
  click('Use assistant')
  submit('Prepare assistant request')
  click('Remove')
  assert.ok(!calls.some(item => item.action === 'desk:remove'))
  confirm = true
  click('Remove')
  draw('Connections')
  click('Enable')
  click('Disconnect')
  s.center.disconnect(owner, 'mail')
  draw('Connections')
  s.oauth()
  draw('Connections')
  click('Authorize')
  submit('Create browser recipe')
  const recipe = s.data.browser(
    owner,
    'Browser',
    'mail',
    ['https://example.com'],
    ['send']
  )
  draw('Connections')
  submit('Prepare browser task')
  assert.ok(calls.some(item => item.id === recipe))
  click('Remove')
  const view = s.deskView.snapshot(owner)
  view.mission = 'mission'
  view.authorizationURL = 'https://auth.example.com/authorize'
  dom.created.length = 0
  renderDesk(dom.document, root as unknown as HTMLElement, view, 'Ask', {
    act: body => calls.push(body),
    inspect: id => inspected.push(id),
    download: id => downloads.push(id),
    confirm: () => true,
    redraw() {},
    drafts
  })
  click('Review mission')
  assert.deepEqual(inspected, ['mission'])
  assert.ok(
    dom.created.some(
      item => item.tag === 'a' && item.rel === 'noopener noreferrer'
    )
  )
  assert.equal(redrawn, 0)
})
void test('Desk material editor preserves local drafts, selection coordinates and exact proposal/version actions without executing model text', () => {
  const s = deskSetup(),
    dom = deskDOM(),
    root = dom.nodes.list!,
    doc = s.data.create(owner, scope, 'Literal <script>', 'ts', 'One two'),
    p = s.data.tablePreview(
      owner,
      scope,
      'table',
      'Table',
      ['Name', 'Value'],
      Array.from({ length: 30 }, (_, i) => [
        'Item ' + i,
        i === 0 ? null : String(i)
      ]),
      'Explicit file'
    )
  s.actions.confirm(owner, scope, p.token, 1)
  const photo = s.data.photoAdd(owner, scope, 'Photo', [deskPNG(), deskPNG()]),
    imageID = s.data.photo(owner, photo, scope).images[0]!.id,
    drafts = new Map<string, { revision: number; text: string }>(),
    calls: Record<string, unknown>[] = [],
    downloads: string[] = []
  const draw = () => {
    dom.created.length = 0
    renderDesk(
      dom.document,
      root as unknown as HTMLElement,
      s.deskView.snapshot(owner),
      'My materials',
      {
        act: body => calls.push(body),
        inspect() {},
        download: id => downloads.push(id),
        confirm: () => true,
        redraw() {},
        drafts
      }
    )
  }
  const click = (label: string) =>
    dom.created
      .find(node => node.tag === 'button' && node.textContent === label)!
      .click()
  const submit = (label: string, values: Record<string, string> = {}) => {
    const form = dom.created.find(
      node =>
        node.tag === 'form' &&
        node.children.some(child => child.textContent === label)
    )!
    for (const child of form.children) {
      for (const input of child.children)
        if (input instanceof Object && 'value' in input) {
          const field = input as (typeof dom.created)[number],
            name = field.attributes['aria-label']!
          if (name in values) field.value = values[name]!
        }
    }
    trigger(form, 'submit')
  }
  draw()
  const edit = dom.created.find(node => node.tag === 'textarea')!
  click('Save document')
  edit.value = 'Local draft'
  trigger(edit, 'input')
  click('Save document')
  submit('Propose selected edit', { goal: 'Improve' })
  edit.value = 'One two'
  submit('Propose selected edit', { goal: 'Improve saved passage' })
  click('Restore document version')
  click('Download document')
  assert.equal(drafts.get(doc.id)!.text, 'Local draft')
  click('Discard local draft')
  drafts.set(doc.id, { revision: 0, text: 'Old draft' })
  draw()
  assert.ok(
    dom.created.some(node => node.textContent.includes('older revision'))
  )
  trigger(
    dom.created.find(node => node.tag === 'textarea')!,
    'input'
  )
  click('Save document')
  assert.equal(calls.at(-1)!.revision, 0)
  click('Previous rows')
  click('Next rows')
  click('Next rows')
  submit('Filter and sort', {
    query: 'Item 1',
    column: '1',
    descending: 'true'
  })
  submit('Filter and sort', { column: '99' })
  submit('Filter and sort', { column: '-1', query: '', descending: 'false' })
  submit('Save cell')
  submit('Filter and sort', { query: 'Item 1', column: '-1' })
  submit('Draw bar chart')
  submit('Draw bar chart', { value: '0' })
  click('Restore table version')
  click('Download CSV')
  submit('Prepare region edit', { goal: 'Need selection' })
  const image = dom.created.find(node => node.tag === 'img')!
  trigger(image, 'pointerup', { clientX: 100, clientY: 100 })
  trigger(image, 'pointerdown', { clientX: 20, clientY: 20 })
  trigger(image, 'pointerup', { clientX: 100, clientY: 100 })
  submit('Prepare region edit', { goal: 'Color' })
  assert.match(String(calls.at(-1)!.value), /"width":40/)
  const select = dom.created.filter(node => node.tag === 'select').at(-1)!
  select.value = imageID
  trigger(select, 'change')
  click('Download image')
  click('Remove')
  assert.equal(downloads.length, 3)
  const pending = s.data.editPreview(
    owner,
    scope,
    'edit',
    doc.id,
    1,
    0,
    3,
    'Better'
  )
  draw()
  click('Accept exact proposal')
  click('Cancel proposal')
  assert.ok(
    calls.some(item => item.id === pending.token && item.confirm === true)
  )
  s.actions.voice(
    owner,
    scope,
    'live',
    'call',
    '{"kind":"task","text":"Review"}'
  )
  draw()
  assert.ok(
    !dom.created.some(node => node.textContent === 'Accept exact proposal')
  )
})
void test('workspace uses five primary sections and signed Desk requests while retaining mission review and downloads', async t => {
  const s = deskSetup(),
    dom = deskDOM(),
    workspace = new StudioWorkspace(
      s.studio,
      s.profiles,
      s.ws,
      s.workflow,
      s.usage,
      s.jobs,
      undefined,
      undefined,
      s.deskView
    ),
    bodies: Record<string, unknown>[] = []
  let view = workspace.snapshot(owner)
  t.mock.method(globalThis, 'fetch', (_url: unknown, options?: RequestInit) => {
    if (options?.body)
      bodies.push(JSON.parse(options.body as string) as Record<string, unknown>)
    return Promise.resolve({ ok: true, json: () => Promise.resolve(view) })
  })
  const app = mountWorkspace(dom.document, dom.window)
  await app.refresh()
  assert.equal(dom.nodes.title!.textContent, 'Ask')
  for (const label of [
    'Create',
    'My materials',
    'My day',
    'Assistants',
    'Connections'
  ])
    assert.ok(dom.find('nav', label))
  dom.find('nav', 'Assistants').click()
  dom.created.find(node => node.textContent === 'Use normal chat')!.click()
  await settle()
  assert.equal(bodies.at(-1)!.action, 'desk:assistant-use')
  view = workspace.snapshot(owner)
  view.desk!.mission = 'prepared'
  await app.refresh()
  dom.created
    .filter(node => node.textContent === 'Review mission')
    .at(-1)!
    .click()
  await settle()
  assert.equal(dom.nodes.title!.textContent, 'Missions')
})
void test('mounted Desk editor routes downloads, confirmation, local redraw and save success through signed workspace controls', async t => {
  const s = deskSetup(),
    dom = deskDOM(),
    doc = s.data.create(owner, scope, 'Draft', 'text', 'Original'),
    workspace = new StudioWorkspace(
      s.studio,
      s.profiles,
      s.ws,
      s.workflow,
      s.usage,
      s.jobs,
      undefined,
      undefined,
      s.deskView
    ),
    bodies: Record<string, unknown>[] = []
  let downloads = 0
  t.mock.method(URL, 'createObjectURL', () => {
    downloads++
    return 'blob:unit'
  })
  t.mock.method(URL, 'revokeObjectURL', () => {})
  t.mock.method(globalThis, 'fetch', (url: unknown, options?: RequestInit) => {
    if (String(url).includes('/file'))
      return Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['Document']))
      })
    const body = options?.body
      ? (JSON.parse(options.body as string) as Record<string, unknown>)
      : undefined
    if (body) bodies.push(body)
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(workspace.snapshot(owner))
    })
  })
  const app = mountWorkspace(dom.document, dom.window)
  await app.refresh()
  dom.find('nav', 'My materials').click()
  let edit = dom.created.filter(node => node.tag === 'textarea').at(-1)!
  edit.value = 'Unsaved'
  trigger(edit, 'input')
  dom.created
    .filter(node => node.textContent === 'Discard local draft')
    .at(-1)!
    .click()
  edit = dom.created.filter(node => node.tag === 'textarea').at(-1)!
  assert.equal(edit.value, 'Original')
  edit.value = 'Saved'
  trigger(edit, 'input')
  dom.created
    .filter(node => node.textContent === 'Save document')
    .at(-1)!
    .click()
  await settle()
  assert.equal(bodies.at(-1)!.action, 'desk:save')
  dom.created
    .filter(node => node.textContent === 'Download document')
    .at(-1)!
    .click()
  await settle()
  assert.equal(downloads, 1)
  s.data.editPreview(owner, scope, 'edit', doc.id, 1, 0, 1, 'X')
  await app.refresh()
  dom.created
    .filter(node => node.textContent === 'Accept exact proposal')
    .at(-1)!
    .click()
  await settle()
  assert.equal(bodies.at(-1)!.confirm, true)
})
