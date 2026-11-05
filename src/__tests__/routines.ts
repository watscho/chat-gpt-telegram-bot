import { RoutineExecutor } from '../application/routine-executor.js'
import { RoutinePlans } from '../application/routine-plans.js'
import { RoutineReviews } from '../application/routine-reviews.js'
import { RoutineHome } from '../application/routine-home.js'
import {
  RoutineCommands,
  type RoutineContext
} from '../telegram/routine-commands.js'
import { StudioCommands } from '../telegram/studio-commands.js'
import { studioSetup } from './studio.js'
import { Suite } from '../application/suite.js'
import { Workflow } from '../application/workflow.js'
import { Experience } from '../application/experience.js'
import { Routines, routineId } from '../application/routines.js'
import { RoutineCalendar } from '../application/routine-calendar.js'
import { RoutineFinance } from '../application/routine-finance.js'
import { RoutineLearning } from '../application/routine-learning.js'
import { RoutineWaiting } from '../application/routine-waiting.js'
import { RoutineReading } from '../application/routine-reading.js'
import { RoutineAlerts } from '../application/routine-alerts.js'
import type { ReadingPorts } from '../domain/routine.js'
export const routineOwner = '42:42',
  routineScope = { thread: '1', project: null }
export const routineSource = {
  id: 'selected-source',
  title: 'Selected learning notes',
  text: 'A durable claim is persisted before an external effect.',
  thread: '1',
  project: null
}
export function routineSetup() {
  const s = studioSetup()
  let now = Date.parse('2027-01-15T08:00:00Z')
  s.settings.statePath = '/unit/routines.db'
  s.clock(now)
  const data = new Routines(s.settings, s.store, () => now),
    workflow = new Workflow(s.store, () => now),
    suite = new Suite(s.settings, s.store, () => now),
    experience = new Experience(s.store),
    notices: string[] = []
  const readingPorts: ReadingPorts = {
    allowed: () => true,
    quiet: () => false,
    timezone: () => 'UTC',
    read: () =>
      Promise.resolve([
        {
          url: 'https://example.com/article',
          title: 'TypeScript project notes',
          excerpt: 'Useful daily TypeScript reading.',
          published: now
        }
      ]),
    notify: (_owner, text) => {
      notices.push(text)
      return Promise.resolve()
    }
  }
  const calendar = new RoutineCalendar(data, workflow),
    finance = new RoutineFinance(data),
    learning = new RoutineLearning(data),
    waiting = new RoutineWaiting(data),
    reading = new RoutineReading(data, readingPorts, experience),
    alerts = new RoutineAlerts(data, readingPorts, reading)
  const executor = new RoutineExecutor(
    calendar,
    finance,
    learning,
    waiting,
    reading,
    s.executor,
    {
      execute: () =>
        Promise.resolve({ text: 'Delegated Suite result', images: [] })
    },
    () => undefined
  )
  const plans = new RoutinePlans(
    data,
    s.ws,
    s.studio,
    suite,
    calendar,
    waiting,
    reading
  )
  const reviews = new RoutineReviews(data, calendar, finance, learning, waiting)
  const home = new RoutineHome(
    data,
    calendar,
    finance,
    learning,
    waiting,
    reading,
    plans,
    reviews,
    s.profiles,
    s.ws,
    workflow
  )
  const commands = new RoutineCommands(
    data,
    calendar,
    finance,
    learning,
    waiting,
    reading,
    plans,
    executor,
    s.studio,
    new StudioCommands(s.studio, s.ws),
    s.ws,
    workflow,
    suite,
    reviews
  )
  const messages: string[] = [],
    files: { bytes: Uint8Array; name: string }[] = []
  const ctx: RoutineContext = {
    owner: routineOwner,
    thread: '1',
    text: value => {
      messages.push(value)
      return Promise.resolve()
    },
    file: (bytes, name) => {
      files.push({ bytes, name })
      return Promise.resolve()
    },
    input: prompt =>
      Promise.resolve({
        prompt,
        project: null,
        documents: [],
        images: [],
        instructions: '',
        memories: []
      }),
    capture: () => Promise.reject(new Error('No capture')),
    task: () => Promise.resolve(),
    meeting: () => Promise.resolve(),
    workspace: () => {
      messages.push('Workspace opened')
      return Promise.resolve()
    },
    quote: () => '',
    document: () => Promise.resolve(undefined),
    video: () => undefined,
    materials: () =>
      Promise.resolve({
        images: [{ mime: 'image/png', data: 'QQ==' }],
        documents: []
      })
  }
  return {
    ...s,
    routineExecutor: executor,
    plans,
    reviews,
    home,
    commands,
    ctx,
    messages,
    files,
    data,
    workflow,
    suite,
    experience,
    calendar,
    finance,
    learning,
    waiting,
    reading,
    alerts,
    readingPorts,
    notices,
    now: () => now,
    time: (value: number) => {
      now = value
      s.clock(value)
    },
    task: (title = 'Review draft', dueAt: number | null = null) =>
      workflow.addTask(routineOwner, '1', title, dueAt),
    available: (events: import('../domain/routine.js').TimeBlock[] = []) => {
      const pending = calendar.preview(
        routineOwner,
        routineScope,
        `manual:${routineId()}`,
        {
          start: now,
          end: now + 8 * 3600000,
          events,
          asOf: now,
          source: 'Explicit manual availability',
          connection: null
        }
      )
      return calendar.confirmCalendar(
        routineOwner,
        routineScope,
        pending.token,
        1
      )
    }
  }
}
