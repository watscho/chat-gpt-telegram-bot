import type { HomeView } from '../application/routine-home.js'
export interface HomePorts {
  act(body: Record<string, unknown>): void
  inspect(id: string): void
  confirm(text: string): boolean
  shortcut?: () => void
}
/** All source/model text is rendered as text; actions go through the signed workspace API. */
export function renderHome(
  document: Document,
  root: HTMLElement,
  view: HomeView,
  ports: HomePorts
): void {
  const section = (title: string, text: string) => {
    const node = document.createElement('article'),
      h = document.createElement('h2'),
      p = document.createElement('p')
    h.textContent = title
    p.textContent = text
    node.append(h, p)
    root.append(node)
    return node
  }
  const button = (node: HTMLElement, label: string, action: () => void) => {
    const item = document.createElement('button')
    item.textContent = label
    item.addEventListener('click', action)
    node.append(item)
  }
  const act = (
    action: string,
    id = '',
    value?: string,
    revision?: number,
    confirm?: boolean
  ) =>
    ports.act({
      action: `home:${action}`,
      id,
      ...(value === undefined ? {} : { value }),
      ...(revision === undefined ? {} : { revision }),
      ...(confirm === undefined ? {} : { confirm })
    })
  const form = (
    node: HTMLElement,
    label: string,
    defaults: Record<string, string>,
    submit: (values: Record<string, string>) => void
  ) => {
    const fields: Record<string, HTMLInputElement> = {},
      form = document.createElement('form')
    for (const [name, value] of Object.entries(defaults)) {
      const label = document.createElement('label'),
        input = document.createElement('input')
      input.value = value
      input.name = name
      input.setAttribute('aria-label', name)
      label.textContent = name
      label.append(input)
      form.append(label)
      fields[name] = input
    }
    const submitButton = document.createElement('button')
    submitButton.type = 'submit'
    submitButton.textContent = label
    form.append(submitButton)
    form.addEventListener('submit', event => {
      event.preventDefault()
      submit(
        Object.fromEntries(
          Object.entries(fields).map(([key, input]) => [key, input.value])
        )
      )
    })
    node.append(form)
  }
  const overview = section(
    'Your day',
    `${view.date} · ${view.timezone}\n${view.tasks.length} open tasks · ${view.learning.due} cards due · ${view.waiting.filter(item => item.status === 'waiting').length} awaiting replies`
  )
  const actions: Record<string, () => void> = {
    plan: () => act('plan'),
    evening: () => act('evening'),
    expense: () => document.getElementById('home-expense')?.scrollIntoView(),
    review: () => act('review-next'),
    waiting: () => document.getElementById('home-waiting')?.scrollIntoView(),
    reading: () => document.getElementById('home-reading')?.scrollIntoView(),
    focus: () => act('focus', '', '25')
  }
  for (const pin of view.shortcuts) button(overview, pin, actions[pin]!)
  form(
    overview,
    'Save three shortcuts',
    { shortcuts: view.shortcuts.join(',') },
    values => act('pins', '', values.shortcuts)
  )
  if (ports.shortcut) button(overview, 'Add to home screen', ports.shortcut)
  if (view.mission)
    button(overview, 'Review prepared mission', () =>
      ports.inspect(view.mission!)
    )
  const calendar = section(
    'Plan with availability',
    view.calendar
      ? `Snapshot: ${new Date(view.calendar.asOf).toISOString()}\n${view.calendar.events.length} busy intervals. Refresh after 15 minutes. Review coverage before accepting.`
      : 'Choose a dedicated calendar read connection or enter verified busy intervals. [] explicitly means no busy intervals. All calendar reads require Telegram approval.'
  )
  form(
    calendar,
    'Choose calendar connection',
    { connection: view.connection ?? 'none' },
    values => act('calendar-use', values.connection)
  )
  form(
    calendar,
    'Prepare calendar read',
    { date: view.date, start: '09:00', end: '18:00' },
    values => act('calendar-sync', '', JSON.stringify(values))
  )
  form(
    calendar,
    'Review manual availability',
    { date: view.date, start: '09:00', end: '18:00', busy: '[]' },
    values => act('manual', '', JSON.stringify(values))
  )
  button(calendar, 'Prepare day plan', () => act('plan'))
  for (const task of view.tasks) {
    const node = section(
      task.title,
      `Task ${task.id}. Duration and priority affect the next plan.`
    )
    form(
      node,
      'Save task preferences',
      { minutes: String(task.minutes), priority: String(task.priority) },
      values => act('task', task.id, JSON.stringify(values))
    )
  }
  for (const day of view.days.slice(-3).reverse()) {
    const node = section(
      `Plan ${day.date}`,
      `${day.closed ? 'Closed' : 'Open'}\n${day.slots.map(slot => `${new Date(slot.start).toISOString()} · ${slot.title}`).join('\n')}\nUnscheduled: ${day.unscheduled.join(', ') || 'none'}\n${day.notes}`
    )
    if (!day.closed)
      button(node, 'Evening review', () => act('evening', day.date))
  }
  const pending = view.pending
  if (pending) {
    const node = section(
      `Review ${pending.kind} · revision ${pending.revision}`,
      pending.payload
    )
    if (pending.kind === 'evening') {
      form(
        node,
        'Change task outcome',
        { task: '', action: 'keep', due: '' },
        values =>
          act(
            'outcome',
            pending.token,
            JSON.stringify(values),
            pending.revision
          )
      )
      form(node, 'Save evening note', { note: '' }, values =>
        act('evening-note', pending.token, values.note, pending.revision)
      )
    }
    button(node, 'Accept displayed changes', () => {
      if (ports.confirm('Accept exactly the displayed daily changes?'))
        act('confirm', pending.token, undefined, pending.revision, true)
    })
    button(node, 'Cancel review', () =>
      act('cancel', pending.token, undefined, pending.revision)
    )
  }
  const expense = section(
    'Expenses',
    `${view.totals}\nReply to a receipt in Telegram: /expense scan. Review extracted totals before accepting. Subscription payments and refunds require separate explicit Telegram confirmation.`
  )
  expense.id = 'home-expense'
  form(
    expense,
    'Review expense',
    {
      merchant: '',
      date: view.date,
      currency: 'USD',
      amount: '',
      category: ''
    },
    values => act('expense-preview', '', JSON.stringify(values))
  )
  for (const sub of view.subscriptions)
    section(
      sub.title,
      `${sub.currency} minor units ${sub.minor} · next ${sub.next} · ${sub.active ? 'active' : 'paused'}`
    )
  const learning = section(
    'Practice recall',
    `${view.learning.cards} cards · ${view.learning.due} due. Reveal before rating. /review from COURSE_ID creates a separately reviewed card proposal.`
  )
  button(learning, 'Next due card', () => act('review-next'))
  if (view.session) {
    const session = view.session,
      node = section(
        session.front,
        `${session.source}${session.back ? '\n' + session.back : ''}`
      )
    if (session.back === null)
      button(node, 'Reveal answer', () => act('review-reveal', session.token))
    else
      for (const grade of ['again', 'hard', 'good', 'easy'])
        button(node, grade, () => act('review-grade', session.token, grade))
  }
  const waiting = section(
    'Waiting for replies',
    'Add and bind correspondence explicitly in Telegram: /waiting. Checking a service proposes a read mission; drafts require separate review before sending.'
  )
  waiting.id = 'home-waiting'
  for (const item of view.waiting) {
    const node = section(
      item.contact,
      `${item.request}\n${item.status} · check ${new Date(item.checkAt).toISOString()}`
    )
    if (item.status === 'waiting') {
      button(node, 'Prepare reply check', () => act('waiting-check', item.id))
      button(node, 'Prepare follow-up draft', () =>
        act('waiting-draft', item.id)
      )
    }
    button(node, 'Close tracking', () => act('waiting-close', item.id))
  }
  const reading = section(
    'Selected reading',
    'Manage explicit RSS/Atom/page subscriptions and delivery time in Telegram: /reading. Opening links leaves this workspace. The optional model brief creates a mission for review.'
  )
  reading.id = 'home-reading'
  form(reading, 'Save topic preference', { topic: '', weight: '1' }, values =>
    act('reading-topic', '', JSON.stringify(values))
  )
  button(reading, 'Prepare brief for displayed items', () =>
    act('reading-brief', view.reading.map(item => item.id).join(','))
  )
  for (const item of view.reading) {
    const node = section(item.title, `${item.excerpt}\n${item.reason}`),
      link = document.createElement('a')
    link.textContent = item.url
    link.href = item.url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    node.append(link)
    for (const action of ['read', 'save', 'hide'])
      button(node, action, () => act('reading-mark', item.id, action))
  }
  const focus = section(
    'Focus',
    view.focus
      ? `Until ${new Date(view.focus.end).toISOString()}`
      : 'Local timer; no model request.'
  )
  if (view.focus) button(focus, 'Stop timer', () => act('focus-stop'))
  else
    form(focus, 'Start focus timer', { minutes: '25', task: '' }, values =>
      act('focus', values.task, values.minutes)
    )
  for (const alert of view.alerts)
    section(
      alert.failed ? 'Delivery failed — inspect manually' : 'Recent reminder',
      alert.text
    )
}
