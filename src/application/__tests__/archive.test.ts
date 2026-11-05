import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArchiveImport } from '../archive.js'
import { config, MemoryStateStore } from '../../__tests__/helpers.js'
import { Profiles } from '../profiles.js'
const file = { name: 'a.txt', mime: 'text/plain', data: 'YQ==' }
function archive() {
  return {
    archiveVersion: 1,
    profile: { threads: [{ id: '1', title: 'Work' }], memories: ['A note'] },
    workspace: {
      projects: [
        {
          id: '1',
          title: 'Project',
          instructions: 'Use citations',
          notes: ['Project note'],
          documents: [{ ...file }]
        }
      ]
    },
    histories: [
      [
        'old:owner:1',
        {
          messages: [
            {
              id: 'u',
              role: 'user',
              content: 'Question',
              documents: [{ ...file }],
              images: [{ data: 'iVBORw0KGgo=', mime: 'image/png' }]
            },
            { id: 'a', role: 'assistant', content: 'Answer' }
          ],
          expiresAt: 0
        }
      ] as const
    ],
    extensions: {
      productivity: {
        templates: [{ name: 'review', body: 'Review {{code}}' }]
      },
      workflow: {
        tasks: [{ thread: '1', title: 'Follow up' }],
        glossary: { '1': [{ term: 'Brand', meaning: 'Brand' }] }
      },
      library: [
        {
          id: 'f',
          project: '1',
          name: 'a.txt',
          digest: 'digest',
          passages: [{ location: 'line 1', text: 'Evidence' }]
        }
      ]
    }
  }
}
void test('archive preview describes merge/conflicts and commits owned content with new IDs while preserving current quotas', () => {
  const settings = config(),
    store = new MemoryStateStore(),
    service = new ArchiveImport(settings, store, () => 100)
  const source = JSON.stringify(archive())
  assert.match(service.preview('a', source), /1 conversations/)
  service.commit('a', source)
  const profile = store.getProfile('a')!
  assert.deepEqual(
    profile.threads.map(item => item.id),
    ['1', '2']
  )
  assert.match(profile.threads[1]!.title, /import/)
  assert.equal(store.sessions()[0]![0], 'a:2')
  assert.equal(store.sessions()[0]![1].expiresAt, settings.sessionTtlMs + 100)
  assert.equal(
    store.getRecord<{ tasks: { dueAt: null }[] }>('workflow', 'a')!.tasks[0]!
      .dueAt,
    null
  )
  store.putRecord('usage', 'a', { requests: 20 })
  assert.match(service.preview('a', source), /skipped: review/)
  service.commit('a', source)
  assert.deepEqual(store.getRecord('usage', 'a'), { requests: 20 })
  assert.equal(
    store.getRecord<{ templates: unknown[] }>('productivity', 'a')!.templates
      .length,
    1
  )
  assert.equal(store.getProfile('b'), undefined)
})
void test('archive parser rejects malformed structures, duplicate identities, unsupported data and oversized content', () => {
  const service = new ArchiveImport(config(), new MemoryStateStore())
  for (const source of ['{', 'null', '[]', '"text"'])
    assert.throws(() => service.parse(source))
  assert.throws(() =>
    new ArchiveImport(
      { ...config(), maxExportBytes: 1 },
      new MemoryStateStore()
    ).parse('{}')
  )
  const invalid: ((data: ReturnType<typeof archive>) => void)[] = [
    data => {
      data.archiveVersion = 2
    },
    data => {
      Object.assign(data.profile, { threads: null })
    },
    data => {
      data.profile.threads[0]!.id = 'bad'
    },
    data => {
      data.profile.threads[0]!.id = '0'
    },
    data => {
      data.profile.threads[0]!.title = ''
    },
    data => {
      data.profile.threads[0]!.title = 'bad\nname'
    },
    data => {
      data.profile.threads[0]!.title = 'x'.repeat(81)
    },
    data => {
      data.profile.threads.push(data.profile.threads[0]!)
    },
    data => {
      data.histories.push(data.histories[0]!)
    },
    data => {
      Object.assign(data.histories[0]![1], {
        messages: [{ role: 'system', content: 'Bad' }]
      })
    },
    data => {
      Object.assign(data.histories[0]![1], {
        messages: [{ role: 'user', content: 'Incomplete' }]
      })
    },
    data => {
      Object.assign(data.histories[0]![1], {
        messages: [
          { role: 'assistant', content: 'Wrong' },
          { role: 'user', content: 'Wrong' }
        ]
      })
    },
    data => {
      Object.assign(data.histories[0]![1], {
        messages: [
          { role: 'user', content: 42 },
          { role: 'assistant', content: 'A' }
        ]
      })
    },
    data => {
      data.workspace.projects[0]!.documents[0]!.data = 'invalid!'
    },
    data => {
      data.workspace.projects[0]!.documents[0]!.name = 'bad.exe'
    },
    data => {
      data.workspace.projects.push(data.workspace.projects[0]!)
    },
    data => {
      data.workspace.projects[0]!.notes = ['x'.repeat(3000), 'y'.repeat(3000)]
    },
    data => {
      data.extensions.productivity.templates[0]!.name = 'BAD'
    },
    data => {
      data.extensions.productivity.templates[0]!.body = ''
    },
    data => {
      data.extensions.productivity.templates.push(
        data.extensions.productivity.templates[0]!
      )
    },
    data => {
      data.extensions.library[0]!.project = '99'
    },
    data => {
      data.extensions.library[0]!.passages = [
        { location: 'page 1', text: 'x'.repeat(1201) }
      ]
    },
    data => {
      data.extensions.workflow.tasks[0]!.thread = '99'
    },
    data => {
      Object.assign(data.extensions.workflow.glossary, { '99': [] })
    },
    data => {
      data.extensions.workflow.glossary['1'][0]!.term = ''
    },
    data => {
      data.extensions.workflow.glossary['1'][0]!.meaning = 'bad\nmeaning'
    },
    data => {
      data.extensions.workflow.glossary['1'] = Array.from(
        { length: 100 },
        (_, index) => ({ term: String(index), meaning: 'x'.repeat(50) })
      )
    }
  ]
  for (const change of invalid) {
    const data = archive()
    change(data)
    assert.throws(() => service.parse(JSON.stringify(data)))
  }
  const bare = archive()
  Object.assign(bare, {
    archiveVersion: undefined,
    extensions: undefined,
    histories: []
  })
  Object.assign(bare.workspace.projects[0]!, { documents: undefined })
  assert.equal(service.parse(JSON.stringify(bare)).templates.length, 0)
  const noExtras = archive()
  Object.assign(noExtras, { extensions: {} })
  assert.equal(service.parse(JSON.stringify(noExtras)).library.length, 0)
  const onlyProd = archive()
  Object.assign(onlyProd, { extensions: { productivity: {}, workflow: {} } })
  assert.equal(service.parse(JSON.stringify(onlyProd)).tasks.length, 0)
  const settings = config()
  for (const patch of [
    { maxHistoryCharacters: 5 },
    { maxHistoryImageBytes: 1 },
    { maxProjectBytes: 1 }
  ])
    assert.throws(() =>
      new ArchiveImport(
        { ...settings, ...patch },
        new MemoryStateStore()
      ).parse(JSON.stringify(archive()))
    )
  const many = archive()
  many.extensions.library[0]!.passages = Array.from({ length: 1001 }, () => ({
    location: 'p',
    text: 'x'.repeat(1200)
  }))
  assert.throws(() => service.parse(JSON.stringify(many)), /document text/)
})
void test('merged archive admission rechecks capacities without evicting or modifying current data', () => {
  for (const patch of [
    { maxThreads: 1 },
    { maxProjects: 1 },
    { maxMemories: 1 },
    { maxMemoryCharacters: 7 },
    { maxSessions: 1 },
    { maxTotalImageBytes: 1 },
    { maxProjectBytes: 1 }
  ]) {
    const settings = { ...config(), ...patch },
      store = new MemoryStateStore(),
      profiles = new Profiles(config(), store)
    profiles.rename('a', 'Existing')
    profiles.remember('a', 'Existing note')
    store.putSession('other:1', { messages: [], expiresAt: 100000 })
    if ('maxProjects' in patch)
      store.putRecord('workspace', 'a', {
        timezone: 'UTC',
        nextProject: 2,
        projects: [
          {
            id: '1',
            title: 'Existing',
            documents: [],
            notes: [],
            instructions: ''
          }
        ],
        threads: {}
      })
    assert.throws(() =>
      new ArchiveImport(settings, store).commit('a', JSON.stringify(archive()))
    )
    assert.equal(store.getProfile('a')!.threads.length, 1)
  }
  const settings = config(),
    store = new MemoryStateStore()
  store.putRecord('workflow', 'a', {
    tasks: Array.from({ length: 100 }, () => ({})),
    glossary: {},
    quotes: [],
    approval: null
  })
  assert.throws(() =>
    new ArchiveImport(settings, store).commit('a', JSON.stringify(archive()))
  )
  for (const [scope, value] of [
    [
      'productivity',
      {
        templates: Array.from({ length: 50 }, (_, index) => ({
          name: `t${index}`,
          body: 'text'
        }))
      }
    ],
    ['library', Array.from({ length: 500 }, () => ({}))]
  ] as const) {
    const store = new MemoryStateStore()
    store.putRecord(scope, 'a', value)
    assert.throws(() =>
      new ArchiveImport(settings, store).commit('a', JSON.stringify(archive()))
    )
  }
  for (const [scope, value] of [
    ['library', [{ text: 'x'.repeat(20000000) }]],
    [
      'productivity',
      { templates: [], forwards: { big: 'x'.repeat(20000000) } }
    ],
    [
      'workflow',
      { tasks: [], glossary: {}, quotes: [{ text: 'x'.repeat(20000000) }] }
    ]
  ] as const) {
    const store = new MemoryStateStore()
    store.putRecord(scope, 'a', value)
    assert.throws(() =>
      new ArchiveImport(settings, store).commit('a', JSON.stringify(archive()))
    )
  }
})

void test('portable preferences, recaps, collections and feedback are validated and remapped without activating callbacks', () => {
  const settings = config(),
    store = new MemoryStateStore(),
    service = new ArchiveImport(settings, store, () => 10)
  const source = archive()
  Object.assign(source.workspace, {
    threads: {
      '1': {
        mode: 'editor',
        instructions: 'Be concise',
        project: '1',
        quality: 'medium',
        size: '1024x1024',
        retentionSeconds: 60,
        model: 'custom-model',
        reviewContext: true
      }
    }
  })
  Object.assign(source.histories[0]![1], {
    recap: {
      decisions: ['We agreed'],
      constraints: ['Must stay private'],
      questions: ['Pending?'],
      context: ['Earlier']
    }
  })
  Object.assign(source.extensions.productivity, {
    forwards: { '1': [{ id: 50, text: 'Forwarded text' }] },
    feedback: [
      { thread: '1', revision: 'a', rating: 'up', reason: 'helpful', at: 0 }
    ]
  })
  service.commit('a', JSON.stringify(source))
  const workspace = store.getRecord<{
    threads: Record<string, { project: string }>
  }>('workspace', 'a')!
  assert.equal(workspace.threads['2']!.project, '1')
  const prod = store.getRecord<{
    forwards: Record<string, { id: number }[]>
    feedback: { thread: string }[]
  }>('productivity', 'a')!
  assert.equal(prod.forwards['2']![0]!.id, -1)
  assert.equal(prod.feedback[0]!.thread, '2')
  assert.equal(store.sessions()[0]![1].expiresAt, 60010)
  assert.ok(store.sessions()[0]![1].recap)
  const cases: unknown[] = [
    { retentionSeconds: '60' },
    { reviewContext: 'yes' },
    { project: '99' },
    { mode: 'unknown' },
    { instructions: 42 },
    { quality: 'bad' },
    { size: 'bad' },
    { model: 'bad model' }
  ]
  for (const patch of cases) {
    const input = archive()
    Object.assign(input.workspace, { threads: { '1': patch } })
    assert.throws(() => service.parse(JSON.stringify(input)))
  }
  for (const patch of [
    {
      retentionSeconds: null,
      project: null,
      model: null,
      reviewContext: false
    },
    { retentionSeconds: 120, model: 'custom', project: '1' }
  ]) {
    const input = archive()
    Object.assign(input.workspace, { threads: { '1': patch } })
    assert.ok(service.parse(JSON.stringify(input)))
  }
  for (const [key, value] of [
    ['forwards', { '99': [] }],
    [
      'forwards',
      { '1': Array.from({ length: 8 }, () => ({ text: 'x'.repeat(8000) })) }
    ],
    [
      'feedback',
      [{ thread: '99', revision: 'a', rating: 'up', reason: 'helpful' }]
    ],
    [
      'feedback',
      [{ thread: '1', revision: 'a', rating: 'bad', reason: 'helpful' }]
    ],
    ['feedback', [{ thread: '1', revision: 'a', rating: 'up', reason: 'bad' }]]
  ] as const) {
    const input = archive()
    Object.assign(input.extensions.productivity, { [key]: value })
    assert.throws(() => service.parse(JSON.stringify(input)))
  }
  for (const key of ['decisions', 'constraints', 'questions', 'context']) {
    const input = archive()
    Object.assign(input.histories[0]![1], {
      recap: {
        decisions: [],
        constraints: [],
        questions: [],
        context: [],
        [key]: [42]
      }
    })
    assert.throws(() => service.parse(JSON.stringify(input)))
  }
})

void test('merge validation handles full canonical stores and rejects combined byte/character budgets atomically', () => {
  const source = JSON.stringify(archive()),
    settings = config()
  for (const [scope, value] of [
    [
      'productivity',
      {
        collecting: {},
        templates: [],
        forwards: {},
        feedback: [],
        draft: null,
        extra: 'x'.repeat(20000000)
      }
    ],
    [
      'workflow',
      {
        tasks: [],
        glossary: {},
        quotes: [],
        approval: null,
        extra: 'x'.repeat(20000000)
      }
    ]
  ] as const) {
    const store = new MemoryStateStore()
    store.putRecord(scope, 'a', value)
    assert.throws(
      () => new ArchiveImport(settings, store).commit('a', source),
      /storage limits/
    )
    assert.equal(store.getProfile('a'), undefined)
  }
  const store = new MemoryStateStore()
  store.putRecord('workspace', 'a', {
    timezone: 'UTC',
    nextProject: 2,
    projects: [
      {
        id: '1',
        title: 'Existing',
        instructions: '',
        notes: [],
        documents: [file]
      }
    ],
    threads: {},
    budget: null,
    imageLimit: null,
    searchLimit: null,
    voiceLimit: null
  })
  assert.throws(
    () =>
      new ArchiveImport({ ...settings, maxProjectBytes: 5 }, store).commit(
        'a',
        source
      ),
    /storage limits/
  )
  const profiles = new Profiles(settings, store)
  profiles.remember('a', 'Existing note!')
  assert.throws(
    () =>
      new ArchiveImport({ ...settings, maxMemoryCharacters: 15 }, store).commit(
        'a',
        source
      ),
    /memory limits/
  )
})

void test('feedback merges preserve current votes by rejecting archives that exceed the shared retention limit', () => {
  const store = new MemoryStateStore(),
    source = archive()
  Object.assign(source.extensions.productivity, {
    feedback: [{ thread: '1', revision: 'a', rating: 'up', reason: 'helpful' }]
  })
  store.putRecord('productivity', 'a', {
    collecting: {},
    templates: [],
    forwards: {},
    feedback: Array.from({ length: 200 }, (_, index) => ({
      thread: '1',
      revision: String(index),
      rating: 'up',
      reason: 'helpful',
      at: 0
    })),
    draft: null
  })
  assert.throws(
    () =>
      new ArchiveImport(config(), store).commit('a', JSON.stringify(source)),
    /storage limits/
  )
  assert.equal(store.getProfile('a'), undefined)
})
