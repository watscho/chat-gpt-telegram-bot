import { config, FakeModel, MemoryStateStore } from './helpers.js'
import { FakeWorkbench } from './workbench.js'
import { Studio } from '../application/studio.js'
import { StudioExecutor } from '../application/studio-executor.js'
import { StudioWorkspace } from '../application/studio-workspace.js'
import { Profiles } from '../application/profiles.js'
import { Workspaces } from '../application/workspaces.js'
import { Workflow } from '../application/workflow.js'
import { Workbench } from '../application/workbench.js'
import { UsageLedger } from '../application/usage.js'
import { Jobs } from '../application/jobs.js'
import type { JobInput } from '../domain/jobs.js'
import type { Mission, StudioPorts } from '../domain/studio.js'
export const studioFile = {
  name: 'sales.csv',
  mime: 'text/csv',
  data: Buffer.from('product,total\nA,20').toString('base64')
}
export const studioInput = (): JobInput => ({
  prompt: 'Prepare a useful report',
  project: null,
  documents: [],
  images: [],
  instructions: 'Be concise',
  memories: ['Private preference']
})
export function studioSetup() {
  let now = 1000
  const settings = config(),
    store = new MemoryStateStore(),
    model = new FakeModel(),
    provider = new FakeWorkbench(),
    profiles = new Profiles(settings, store),
    ws = new Workspaces(settings, store),
    workflow = new Workflow(store),
    usage = new UsageLedger(settings, ws, store),
    workbench = new Workbench(settings, ws, provider, store)
  settings.workbench.connections = [
    {
      id: 'mail',
      owner: 42,
      title: 'Mail',
      tools: ['send'],
      server: 'https://mcp.example.com',
      authorization: 'private-token'
    }
  ]
  const calls: Mission[] = [],
    notices: Mission[] = []
  const ports: StudioPorts = {
    allowed: () => true,
    available: () => true,
    execute: (_owner, mission) => {
      calls.push(mission)
      return Promise.resolve({
        text: 'Report based on supplied material.',
        images: [],
        files: [studioFile],
        sources: [
          { title: 'Example evidence', url: 'https://example.com/source' }
        ]
      })
    },
    notify: (_owner, mission) => {
      notices.push(mission)
      return Promise.resolve()
    }
  }
  const studio = new Studio(settings, ports, store, () => now),
    executor = new StudioExecutor(
      settings,
      model,
      workbench,
      usage,
      ws,
      profiles
    )
  const jobs = new Jobs(
    settings,
    {
      allowed: () => true,
      available: () => true,
      input: () => studioInput(),
      execute: () => Promise.resolve({ text: 'Job', images: [] }),
      deliver: () => Promise.resolve()
    },
    store
  )
  const view = new StudioWorkspace(studio, profiles, ws, workflow, usage, jobs)
  const plan = (mode: Mission['mode'] = 'autopilot', input = studioInput()) =>
    studio.plan(
      '42:42',
      '1',
      mode,
      input,
      mode === 'chain'
        ? [{ connection: 'mail', prompt: 'Prepare a draft' }]
        : []
    )
  const finish = async (mission: Mission) => {
    studio.start('42:42', mission.id, mission.revision)
    for (let i = 0; i < mission.steps.length; i++) await studio.tick()
    return studio.mission('42:42', mission.id)
  }
  return {
    settings,
    store,
    model,
    provider,
    profiles,
    ws,
    workflow,
    usage,
    workbench,
    ports,
    studio,
    executor,
    jobs,
    view,
    calls,
    notices,
    plan,
    finish,
    clock: (value: number) => {
      now = value
    }
  }
}
