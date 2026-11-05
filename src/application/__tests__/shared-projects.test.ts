import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SharedProjects } from '../shared-projects.js'
import { suiteSetup } from '../../__tests__/suite.js'
import { config, MemoryStateStore } from '../../__tests__/helpers.js'
import type { Team } from '../../domain/shared.js'
const a = '42:42',
  b = '43:43'
void test('shared projects require persistent allowlisted private identities and explicit targeted acceptance', () => {
  const settings = config()
  assert.throws(
    () => new SharedProjects(settings).create(a, 'Team'),
    /persistent/
  )
  settings.statePath = ':memory:'
  assert.throws(
    () =>
      new SharedProjects(settings, new MemoryStateStore()).create(a, 'Team'),
    /persistent/
  )
  const { teams, store } = suiteSetup()
  for (const owner of ['42:43', '99:99', '42', '42:42:42'])
    assert.throws(() => teams.create(owner, 'Team'))
  for (const title of ['', 'x'.repeat(101)])
    assert.throws(() => teams.create(a, title))
  const team = teams.create(a, 'Shared report')
  assert.equal(teams.list(a).length, 1)
  assert.equal(teams.list(b).length, 0)
  assert.throws(() => teams.inspect(b, team.id))
  assert.throws(() => teams.inspect(a, 'missing'))
  assert.equal('invites' in team, false)
  assert.throws(() => teams.invite(a, team.id, 0, b, 'editor'), /changed/)
  for (const [target, role] of [
    [a, 'reader'],
    [b, 'owner']
  ])
    assert.throws(() => teams.invite(a, team.id, team.revision, target!, role!))
  const invite = teams.invite(a, team.id, team.revision, b, 'reader')
  assert.equal(teams.invitations(b)[0]!.token, invite.token)
  assert.throws(() => teams.accept(a, team.id, invite.token))
  assert.throws(() => teams.accept(b, 'missing', invite.token))
  assert.throws(() => teams.accept(b, team.id, 'wrong'))
  const joined = teams.accept(b, team.id, invite.token)
  assert.equal(joined.role, 'reader')
  assert.equal(teams.invitations(b).length, 0)
  assert.throws(() => teams.invite(b, team.id, joined.revision, a, 'reader'))
  assert.throws(() =>
    teams.publish(b, team.id, joined.revision, [], ['No permission'])
  )
  assert.throws(() => teams.invite(a, team.id, joined.revision, b, 'editor'))
  const raw = store.getRecord<Team>('teams', team.id)!
  raw.invites.push({
    target: b,
    token: 'duplicate',
    role: 'editor',
    expiresAt: 900000
  })
  store.putRecord('teams', team.id, raw)
  assert.throws(() => teams.accept(b, team.id, 'duplicate'), /already/)
})
void test('shared roles are authoritative on each read, publish only reviewed content and revoke file access immediately', () => {
  const { teams } = suiteSetup(),
    team = teams.create(a, 'Work')
  const revision = () => teams.inspect(a, team.id).revision
  const invite = teams.invite(a, team.id, revision(), b, 'editor')
  teams.accept(b, team.id, invite.token)
  const file = { name: 'report.txt', mime: 'text/plain', data: 'QQ==' }
  teams.publish(b, team.id, revision(), [file], ['A shared note'])
  let view = teams.inspect(a, team.id)
  assert.equal(view.files[0]!.author, b)
  assert.equal(teams.file(b, team.id, view.files[0]!.id).data, file.data)
  assert.throws(() => teams.file(b, team.id, 'missing'))
  for (const [files, notes] of [
    [[], []],
    [Array(11).fill(file), []],
    [[], Array(11).fill('note')],
    [[{ ...file, name: '' }], []],
    [[{ ...file, name: 'x'.repeat(161) }], []],
    [[{ ...file, data: '' }], []],
    [[], ['']],
    [[], ['x'.repeat(6001)]]
  ] as [(typeof file)[], string[]][])
    assert.throws(() => teams.publish(a, team.id, revision(), files, notes))
  for (const role of ['owner', 'invalid'])
    assert.throws(() => teams.role(a, team.id, revision(), b, role))
  assert.throws(() => teams.role(a, team.id, revision(), a, 'reader'))
  assert.throws(() => teams.role(a, team.id, revision(), 'missing', 'reader'))
  teams.role(a, team.id, revision(), b, 'reader')
  assert.throws(() => teams.publish(b, team.id, revision(), [], ['blocked']))
  teams.task(a, team.id, revision(), 'Review', b)
  view = teams.inspect(a, team.id)
  const task = view.tasks[0]!
  teams.task(a, team.id, revision(), 'Review updated', null, task.id, true)
  assert.equal(teams.inspect(a, team.id).tasks[0]!.done, true)
  for (const [title, assignee, id] of [
    ['', null, undefined],
    ['x'.repeat(1001), null, undefined],
    ['Task', 'missing', undefined],
    ['Task', null, 'missing']
  ])
    assert.throws(() =>
      teams.task(
        a,
        team.id,
        revision(),
        title!,
        assignee as string | null,
        id as string | undefined
      )
    )
  assert.throws(() => teams.removeContent(a, team.id, revision(), 'missing'))
  teams.removeContent(a, team.id, revision(), view.notes[0]!.id)
  assert.throws(() => teams.revoke(a, team.id, revision(), a))
  assert.throws(() => teams.revoke(a, team.id, revision(), 'missing'))
  teams.revoke(a, team.id, revision(), b)
  assert.throws(() => teams.file(b, team.id, view.files[0]!.id))
  teams.removeContent(a, team.id, revision(), view.files[0]!.id)
  assert.throws(() => teams.leave(a, team.id, revision()))
  teams.close(a, team.id, revision())
  assert.throws(() => teams.inspect(a, team.id))
})
void test('shared invitations expire, can be replaced or revoked, and leave removes a current grant', () => {
  const { settings, store } = suiteSetup()
  let now = 1
  const teams = new SharedProjects(settings, store, () => now),
    team = teams.create(a, 'Space')
  const first = teams.invite(a, team.id, team.revision, b, 'editor')
  now += 600001
  assert.equal(teams.invitations(b).length, 0)
  assert.throws(() => teams.accept(b, team.id, first.token))
  const second = teams.invite(
    a,
    team.id,
    teams.inspect(a, team.id).revision,
    b,
    'reader'
  )
  assert.notEqual(second.token, first.token)
  teams.revoke(a, team.id, teams.inspect(a, team.id).revision, b)
  assert.throws(() => teams.accept(b, team.id, second.token))
  const third = teams.invite(
    a,
    team.id,
    teams.inspect(a, team.id).revision,
    b,
    'editor'
  )
  teams.accept(b, team.id, third.token)
  teams.leave(b, team.id, teams.inspect(a, team.id).revision)
  assert.equal(teams.list(b).length, 0)
})
void test('erasure removes owned spaces and all contributions or assignees from other spaces even after quota reductions', () => {
  const { teams, settings, store } = suiteSetup(),
    own = teams.create(b, 'Owned by B'),
    team = teams.create(a, 'Other')
  const invite = teams.invite(a, team.id, team.revision, b, 'editor')
  teams.accept(b, team.id, invite.token)
  const revision = () => teams.inspect(a, team.id).revision
  teams.publish(
    b,
    team.id,
    revision(),
    [{ name: 'private.txt', mime: 'text/plain', data: 'QQ==' }],
    ['My note']
  )
  teams.task(b, team.id, revision(), 'My task', b)
  teams.task(a, team.id, revision(), 'Their task', b)
  const unrelated = teams.create(a, 'Unrelated')
  settings.maxJobBytes = 1
  teams.erase(b)
  assert.equal(store.getRecord('teams', own.id), undefined)
  assert.equal(teams.inspect(a, team.id).files.length, 0)
  assert.equal(teams.inspect(a, team.id).tasks[0]!.assignee, null)
  assert.ok(
    teams
      .inspect(a, team.id)
      .audit.every(event => event.actor !== b && event.target !== b)
  )
  assert.equal(teams.inspect(a, unrelated.id).revision, 1)
  teams.erase(b)
})
void test('shared storage enforces total owned-space and content bounds before writes', () => {
  const { teams, settings, store } = suiteSetup(),
    team = teams.create(a, 'Limits'),
    original = store.getRecord<Team>('teams', team.id)!
  const patches = [
    { members: Array(21).fill({ owner: a, role: 'owner' }) },
    {
      invites: Array(21).fill({
        target: b,
        token: 't',
        role: 'reader',
        expiresAt: 99999
      })
    },
    {
      files: Array(21).fill({
        id: 'f',
        author: a,
        file: { name: 'x', mime: 'text/plain', data: 'QQ==' }
      })
    },
    { notes: Array(100).fill({ id: 'n', author: a, text: 'Note' }) },
    {
      tasks: Array(101).fill({
        id: 't',
        author: a,
        title: 'Task',
        assignee: null,
        done: false
      })
    }
  ]
  for (const patch of patches) {
    store.putRecord('teams', team.id, { ...original, ...patch })
    assert.throws(
      () => teams.publish(a, team.id, original.revision, [], ['A note']),
      /capacity/
    )
  }
  store.putRecord('teams', team.id, original)
  settings.maxProjectBytes = 1
  assert.throws(
    () =>
      teams.publish(
        a,
        team.id,
        original.revision,
        [{ name: 'a', mime: 'text/plain', data: 'QQ==' }],
        []
      ),
    /capacity/
  )
  settings.maxProjectBytes = 1000
  settings.maxDocumentBytes = 0
  assert.throws(
    () =>
      teams.publish(
        a,
        team.id,
        original.revision,
        [{ name: 'a', mime: 'text/plain', data: 'QQ==' }],
        []
      ),
    /bounded/
  )
  settings.maxJobBytes = 1
  assert.throws(
    () => teams.publish(a, team.id, original.revision, [], ['Note']),
    /byte limit/
  )
  settings.maxJobBytes = 20000000
  for (let i = 0; i < 9; i++) teams.create(a, `Team ${i}`)
  assert.throws(() => teams.create(a, 'Too many'), /capacity/)
})
void test('shared erasure cleans invitations and revoked contributions while retaining other members content and assignments', () => {
  const { teams, settings, store } = suiteSetup()
  settings.allowedUsers = new Set([...settings.allowedUsers, 44])
  const c = '44:44',
    team = teams.create(a, 'Contributions'),
    rev = () => teams.inspect(a, team.id).revision
  const invite = teams.invite(a, team.id, rev(), b, 'editor')
  teams.accept(b, team.id, invite.token)
  teams.invite(a, team.id, rev(), c, 'reader')
  const file = { name: 'own.txt', mime: 'text/plain', data: 'QQ==' }
  teams.publish(a, team.id, rev(), [file], ['Owner note'])
  teams.publish(
    b,
    team.id,
    rev(),
    [{ ...file, name: 'member.txt' }],
    ['Member note']
  )
  teams.task(b, team.id, rev(), 'Member task', a)
  teams.task(a, team.id, rev(), 'Owner task', a)
  teams.revoke(a, team.id, rev(), b)
  teams.erase(b)
  const kept = teams.inspect(a, team.id)
  assert.equal(kept.files.length, 1)
  assert.equal(kept.notes.length, 1)
  assert.equal(kept.tasks[0]!.assignee, a)
  assert.equal(teams.invitations(c).length, 1)
  teams.invite(a, team.id, kept.revision, b, 'reader')
  teams.erase(b)
  assert.equal(teams.invitations(b).length, 0)
  assert.ok(store.getRecord('teams', team.id))
  new SharedProjects(settings).erase(a)
})
void test('erasure finds a former contributor through notes even when no membership or file remains', () => {
  const { teams } = suiteSetup(),
    team = teams.create(a, 'Notes only'),
    invite = teams.invite(a, team.id, team.revision, b, 'editor')
  teams.accept(b, team.id, invite.token)
  teams.publish(
    b,
    team.id,
    teams.inspect(a, team.id).revision,
    [],
    ['Retained contributor note']
  )
  teams.revoke(a, team.id, teams.inspect(a, team.id).revision, b)
  teams.erase(b)
  assert.equal(teams.inspect(a, team.id).notes.length, 0)
})
