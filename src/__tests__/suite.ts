import { studioSetup } from './studio.js'
import { Suite } from '../application/suite.js'
import { Watches } from '../application/watches.js'
import { SharedProjects } from '../application/shared-projects.js'
import { WorkSearch } from '../application/work-search.js'
import { SuiteExecutor } from '../application/suite-executor.js'
import { SuiteCommands, type SuiteContext } from '../telegram/suite-commands.js'
import { StudioCommands } from '../telegram/studio-commands.js'
import {
  workflowSpec,
  compileWorkflow,
  suiteCatalog
} from '../application/suite-workflows.js'
import type { SuiteAssetPorts, WorkflowId } from '../domain/suite.js'
export const suiteSource = {
  id: 'source1',
  title: 'Meeting notes',
  text: 'Alex will send the report by Friday. We chose the smaller launch.',
  thread: '1',
  project: null
}
export function suiteSetup() {
  const setup = studioSetup(),
    { settings, store, studio, ws, executor, usage, model } = setup
  settings.statePath = '/unit-only/state.db'
  const suite = new Suite(settings, store, () => 1000),
    teams = new SharedProjects(settings, store, () => 1000),
    search = new WorkSearch(owner =>
      owner === '42:42'
        ? [{ ...suiteSource, key: '1', kind: 'note', at: 1 }]
        : []
    )
  const assets: SuiteAssetPorts = {
    archive: () =>
      Promise.resolve({
        items: [
          {
            id: '1',
            name: 'documents/001-a.txt',
            group: 'documents',
            bytes: Uint8Array.of(65),
            hash: 'hash',
            duplicateOf: null
          },
          {
            id: '2',
            name: 'documents/002-a.txt',
            group: 'documents',
            bytes: Uint8Array.of(65),
            hash: 'hash',
            duplicateOf: '1'
          }
        ],
        manifest: '[]'
      }),
    package: () => Promise.resolve(Uint8Array.of(80, 75)),
    document: (_template, format) =>
      Promise.resolve({
        name: `review.${format}`,
        mime: 'application/octet-stream',
        data: 'QQ=='
      }),
    annotate: () =>
      Promise.resolve({
        name: 'screen.svg',
        mime: 'image/svg+xml',
        data: 'QQ=='
      }),
    template: (_file, name) =>
      Promise.resolve({
        name,
        revision: 0,
        brand: 'Unit brand',
        accent: '287F78',
        font: 'Noto Sans',
        footer: '',
        headings: []
      }),
    video: () =>
      Promise.resolve({
        duration: 90,
        start: 0,
        seconds: 20,
        frames: [{ time: 0, image: { mime: 'image/jpeg', data: 'QQ==' } }],
        audio: null
      })
  }
  const watches = new Watches(
      settings,
      {
        allowed: () => true,
        read: () =>
          Promise.resolve({ title: 'Watched page', text: 'Baseline' }),
        notify: () => Promise.resolve()
      },
      store,
      () => 1000
    ),
    commands = new StudioCommands(studio, ws),
    suiteExecutor = new SuiteExecutor(
      settings,
      suite,
      executor,
      assets,
      usage,
      (audio, signal) => model.transcribe(audio, signal),
      () => Promise.resolve(Uint8Array.of(1)),
      () => undefined
    ),
    suiteCommands = new SuiteCommands(
      settings,
      suite,
      studio,
      commands,
      ws,
      search,
      watches,
      teams,
      assets,
      suiteExecutor
    )
  const messages: string[] = [],
    files: { name: string; bytes: Uint8Array }[] = []
  let quote = '',
    document: import('../domain/conversation.js').Document | undefined,
    video: import('../domain/suite.js').VideoReference | undefined
  const ctx: SuiteContext = {
    owner: '42:42',
    thread: '1',
    text: value => {
      messages.push(value)
      return Promise.resolve()
    },
    file: (bytes, name) => {
      files.push({ name, bytes })
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
    capture: () => Promise.reject(new Error('Not used')),
    task: () => Promise.resolve(),
    meeting: () => Promise.resolve(),
    workspace: () => Promise.resolve(),
    quote: () => quote,
    document: () => Promise.resolve(document),
    video: () => video
  }
  const plan = (id: WorkflowId) => {
    const spec = workflowSpec(
      id,
      id === 'brand'
        ? { template: 'default', templateRevision: '1' }
        : id === 'referee'
          ? { model: 'gpt-6-astra' }
          : {}
    )
    return studio.plan(
      '42:42',
      '1',
      'workflow',
      {
        prompt: 'Review this material',
        images: [],
        documents: [],
        instructions: '',
        memories: [],
        sources: [suiteSource]
      },
      [],
      compileWorkflow(settings, spec, settings.chatModel)
    )
  }
  const rows = (id: WorkflowId) => [
    Object.fromEntries(
      suiteCatalog[id].fields.map(key => [
        key,
        key === 'source'
          ? suiteSource.id
          : key === 'quote'
            ? 'Alex will send the report by Friday.'
            : key === 'field'
              ? 'email'
              : key === 'format'
                ? 'email'
                : key === 'currency'
                  ? 'USD'
                  : ['base', 'shipping', 'tax', 'discount'].includes(key)
                    ? '10'
                    : key === 'x' || key === 'y'
                      ? '0'
                      : key === 'width' || key === 'height'
                        ? '100'
                        : 'Unit result'
      ])
    )
  ]
  return {
    ...setup,
    suite,
    teams,
    search,
    assets,
    watches,
    suiteCommands,
    suiteExecutor,
    ctx,
    messages,
    files,
    plan,
    rows,
    setQuote: (value: string) => {
      quote = value
    },
    setDocument: (value: typeof document) => {
      document = value
    },
    setVideo: (value: typeof video) => {
      video = value
    }
  }
}
