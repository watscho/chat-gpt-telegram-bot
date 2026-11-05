import { test } from 'node:test'
import assert from 'node:assert/strict'
import { config, MemoryStateStore } from '../../__tests__/helpers.js'
import { Workspaces } from '../workspaces.js'

const file = { name: 'a.txt', mime: 'text/plain', data: 'aGk=' }
void test('workspaces scope projects, files, notes and modes by owner and conversation', () => {
  const store = new MemoryStateStore()
  let ws = new Workspaces(config(), store)
  const project = ws.create('a', 'Work')
  ws.configure('a', '1', {
    project: project.id,
    mode: 'developer',
    instructions: 'Be concise.',
    retentionSeconds: 60
  })
  ws.updateProject('a', project.id, 'instructions', 'Use the project files.')
  ws.updateProject('a', project.id, 'remember', 'Prefer TypeScript.')
  ws.updateProject('a', project.id, 'attach', file)
  ws.updateProject('a', project.id, 'attach', { ...file, data: 'bmV3' })
  assert.equal(ws.project('a', '1')?.documents.length, 1)
  assert.equal(ws.project('b', '1'), undefined)
  assert.match(ws.instructions('a', '1'), /software development/)
  assert.match(ws.instructions('a', '1'), /project files/)
  ws = new Workspaces(config(), store)
  assert.equal(ws.project('a', '1')?.notes[0], 'Prefer TypeScript.')
  const snapshot = ws.get('a')
  snapshot.projects.length = 0
  assert.equal(ws.get('a').projects.length, 1)
  for (const mode of ['default', 'editor', 'translator', 'custom'] as const)
    ws.configure('a', '1', { mode })
  ws.updateProject('a', project.id, 'forget', '1')
  ws.updateProject('a', project.id, 'remember', 'temporary')
  ws.updateProject('a', project.id, 'forget', 'all')
  ws.updateProject('a', project.id, 'remove', file.name)
  ws.configure('a', '2', { mode: 'default' })
  ws.deleteProject('a', project.id)
  assert.equal(ws.thread('a', '1').project, null)
  assert.equal(ws.thread('a', '2').project, null)
  ws.deleteThread('a', '1')
  ws.timezone('a', 'Asia/Tbilisi')
  assert.equal(ws.get('a').timezone, 'Asia/Tbilisi')
  ws.limits('a', 'budget', 0)
  ws.limits('a', 'imageLimit', 1)
  ws.limits('a', 'searchLimit', 1)
  ws.limits('a', 'voiceLimit', 1)
  assert.equal(ws.operatorBudget(), config().dailyBudgetMicroUsd)
  ws.forget('a')
  assert.equal(ws.get('a').timezone, 'UTC')
  const local = new Workspaces(config())
  local.create('a', 'Local')
  local.forget('a')
  assert.equal(local.get('a').projects.length, 0)
})
void test('workspace input and resource limits reject invalid settings without mutating stored data', () => {
  const ws = new Workspaces({
    ...config(),
    maxProjects: 1,
    maxMemories: 1,
    maxMemoryCharacters: 3,
    maxProjectBytes: 8
  })
  assert.throws(() => ws.create('a', ''), /name/)
  assert.throws(() => ws.create('a', 'x'.repeat(81)), /name/)
  assert.throws(() => ws.create('a', 'a\nb'), /name/)
  const p = ws.create('a', 'One')
  assert.throws(() => ws.create('a', 'Two'), /limit/)
  for (const patch of [
    { mode: 'invalid' },
    { instructions: 'x'.repeat(4001) },
    { quality: 'invalid' },
    { size: 'invalid' },
    { retentionSeconds: 59 },
    { retentionSeconds: 86401 },
    { retentionSeconds: 60.5 },
    { project: 'missing' }
  ])
    assert.throws(() =>
      ws.configure('a', '1', patch as Parameters<Workspaces['configure']>[2])
    )
  for (const value of [-1, 1.5, config().dailyBudgetMicroUsd + 1])
    assert.throws(() => ws.limits('a', 'budget', value))
  assert.throws(() => ws.timezone('a', 'not/a-zone'), /IANA/)
  assert.throws(
    () => ws.updateProject('b', p.id, 'instructions', 'x'),
    /not found/
  )
  assert.throws(
    () => ws.updateProject('a', p.id, 'attach', 'wrong'),
    /document/
  )
  assert.throws(() => ws.updateProject('a', p.id, 'instructions', file), /Text/)
  assert.throws(() =>
    ws.updateProject('a', p.id, 'instructions', 'x'.repeat(4001))
  )
  assert.throws(() => ws.updateProject('a', p.id, 'remember', ''))
  assert.throws(() => ws.updateProject('a', p.id, 'remember', 'long'))
  ws.updateProject('a', p.id, 'remember', 'a')
  assert.throws(() => ws.updateProject('a', p.id, 'remember', 'b'))
  for (const value of ['0', '2', 'no', '0.5'])
    assert.throws(() => ws.updateProject('a', p.id, 'forget', value))
  assert.throws(() => ws.updateProject('a', p.id, 'remove', 'missing'))
  assert.throws(() =>
    ws.updateProject('a', p.id, 'attach', { ...file, data: 'x'.repeat(9) })
  )
  assert.equal(ws.get('a').projects[0]?.documents.length, 0)
  assert.throws(() => ws.deleteProject('b', p.id))
  const many = new Workspaces({ ...config(), maxProjectBytes: 1000 })
  const project = many.create('a', 'Files')
  for (let i = 0; i < 10; i++)
    many.updateProject('a', project.id, 'attach', { ...file, name: `${i}.txt` })
  assert.throws(() =>
    many.updateProject('a', project.id, 'attach', { ...file, name: '11.txt' })
  )
})
