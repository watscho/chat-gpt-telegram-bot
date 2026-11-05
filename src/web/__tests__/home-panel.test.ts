import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderHome } from '../home-panel.js'
import { mountWorkspace } from '../workspace-client.js'
import { workspaceDOM, WorkspaceElement } from './workspace-helpers.js'
import { settle } from './helpers.js'
import {
  routineSetup,
  routineOwner as owner,
  routineScope as scope,
  routineSource
} from '../../__tests__/routines.js'
import { StudioWorkspace } from '../../application/studio-workspace.js'
function populated() {
  const s = routineSetup(),
    task = s.task('Literal <script>task</script>')
  s.available()
  let p = s.calendar.plan(owner, scope, 'UTC')
  s.calendar.confirmPlan(owner, scope, p.token, 1)
  p = s.learning.preview(owner, scope, 'cards', [
    { front: 'Question', back: 'Answer', source: routineSource }
  ])
  s.learning.confirm(owner, scope, p.token, 1)
  s.finance.subscription(owner, 'Music', 'USD', '1.00', '2027-01-31', 'month')
  s.waiting.add(
    owner,
    'Alice',
    'Request',
    routineSource,
    s.now(),
    s.now() + 1000
  )
  return { ...s, task }
}
void test('home panel renders text safely and routes local reviews, explicit forms and prepared mission inspection', async () => {
  const s = populated(),
    source = s.reading.add(owner, 'rss', 'https://example.com/feed', 1)
  await s.reading.check(owner, source.id)
  const dom = workspaceDOM(),
    root = dom.nodes.list!,
    calls: Record<string, unknown>[] = [],
    inspected: string[] = []
  let confirmed = false,
    shortcuts = 0
  const draw = () => {
    dom.created.length = 0
    root.replaceChildren()
    renderHome(
      dom.document,
      root as unknown as HTMLElement,
      s.home.snapshot(owner),
      {
        act: body => calls.push(body),
        inspect: id => inspected.push(id),
        confirm: () => confirmed,
        shortcut: () => {
          shortcuts++
        }
      }
    )
  }
  const click = (text: string) => {
    const node = dom.created.find(
      node => node.tag === 'button' && node.textContent === text
    )
    assert.ok(node, text)
    node.click()
  }
  const submit = (label: string) => {
    const form = dom.created.find(
      node =>
        node.tag === 'form' &&
        node.children.some(
          child => (child as WorkspaceElement).textContent === label
        )
    )
    assert.ok(form, label)
    const callback = form.events.submit as unknown as (event: {
      preventDefault(): void
    }) => void
    callback({ preventDefault() {} })
  }
  const scroll = { scrollIntoView() {} }
  const originalGet = dom.document.getElementById.bind(dom.document)
  dom.document.getElementById = (id: string) =>
    id.startsWith('home-') ? (scroll as HTMLElement) : originalGet(id)
  const charge = s.finance.manual(
    owner,
    scope,
    'Shop',
    '2027-01-15',
    'USD',
    '1.00',
    'Food'
  )
  s.finance.confirm(owner, scope, charge.token, 1)
  s.data.update(owner, state => {
    state.days[0]!.unscheduled = ['other']
  })
  draw()
  for (const label of [
    'plan',
    'expense',
    'evening',
    'Add to home screen',
    'Prepare day plan',
    'Evening review',
    'Next due card',
    'Prepare reply check',
    'Prepare follow-up draft',
    'Close tracking',
    'Prepare brief for displayed items',
    'read',
    'save',
    'hide'
  ])
    click(label)
  for (const label of [
    'Save three shortcuts',
    'Choose calendar connection',
    'Prepare calendar read',
    'Review manual availability',
    'Save task preferences',
    'Review expense',
    'Save topic preference',
    'Start focus timer'
  ])
    submit(label)
  assert.equal(shortcuts, 1)
  assert.ok(calls.some(call => call.action === 'home:manual'))
  assert.ok(
    dom.created.some(
      node => node.tag === 'a' && node.rel === 'noopener noreferrer'
    )
  )
  s.data.shortcuts(owner, ['review', 'waiting', 'reading'])
  draw()
  for (const label of ['review', 'waiting', 'reading']) click(label)
  s.data.shortcuts(owner, ['focus', 'plan', 'evening'])
  draw()
  click('focus')
  s.learning.next(owner, scope)
  draw()
  click('Reveal answer')
  const session = s.data.get(owner).session!
  s.learning.reveal(owner, scope, session.token)
  draw()
  for (const grade of ['again', 'hard', 'good', 'easy']) click(grade)
  s.finance.manual(owner, scope, 'Shop', '2027-01-15', 'USD', '1.00', 'Food')
  draw()
  s.calendar.evening(owner, scope, '2027-01-15')
  draw()
  submit('Change task outcome')
  submit('Save evening note')
  click('Accept displayed changes')
  assert.ok(!calls.some(call => call.confirm === true))
  confirmed = true
  click('Accept displayed changes')
  click('Cancel review')
  assert.ok(calls.some(call => call.confirm === true))
  s.data.focus(owner, null, 25)
  draw()
  click('Stop timer')
  s.data.update(owner, state => {
    state.days[0]!.closed = true
    state.days[0]!.unscheduled = []
    state.waiting[0]!.status = 'closed'
    state.subscriptions[0]!.active = false
    state.alerts = [
      { key: 'a', text: 'Notice', at: s.now(), failed: false },
      { key: 'b', text: 'Delivery uncertain', at: s.now(), failed: true }
    ]
  })
  draw()
  const view = s.home.snapshot(owner)
  view.mission = 'mission'
  dom.created.length = 0
  renderHome(dom.document, root as unknown as HTMLElement, view, {
    act: body => calls.push(body),
    inspect: id => inspected.push(id),
    confirm: () => true
  })
  click('Review prepared mission')
  assert.deepEqual(inspected, ['mission'])
})
void test('workspace opens Home by default, sends signed home actions and supports optional Telegram home-screen shortcut', async t => {
  const s = routineSetup(),
    dom = workspaceDOM(),
    workspace = new StudioWorkspace(
      s.studio,
      s.profiles,
      s.ws,
      s.workflow,
      s.usage,
      s.jobs,
      undefined,
      s.home
    )
  let shortcut = 0
  Object.assign(dom.window.Telegram.WebApp, {
    addToHomeScreen: () => {
      shortcut++
    }
  })
  const bodies: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', (_url: unknown, options?: RequestInit) => {
    const body = options?.body
      ? (JSON.parse(options.body as string) as Record<string, unknown>)
      : undefined
    if (body) bodies.push(body)
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(workspace.snapshot(owner))
    })
  })
  const client = mountWorkspace(dom.document, dom.window)
  await client.refresh()
  assert.equal(dom.nodes.title!.textContent, 'Home')
  let control = dom.created.find(
    node => node.textContent === 'Add to home screen'
  )!
  control.click()
  assert.equal(shortcut, 1)
  control = dom.created.find(node => node.textContent === 'plan')!
  control.click()
  await settle()
  assert.equal(bodies.at(-1)!.action, 'home:plan')
  s.finance.manual(owner, scope, 'Shop', '2027-01-15', 'USD', '1.00', 'Food')
  await client.refresh()
  dom.created
    .filter(node => node.textContent === 'Accept displayed changes')
    .at(-1)!
    .click()
  await settle()
  const view = workspace.snapshot(owner)
  view.home!.mission = 'mission'
  t.mock.method(globalThis, 'fetch', () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(view) })
  )
  await client.refresh()
  control = dom.created
    .filter(node => node.textContent === 'Review prepared mission')
    .at(-1)!
  control.click()
  await settle()
  assert.equal(dom.nodes.title!.textContent, 'Missions')
})
