import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StudioCommands, type StudioContext } from '../studio-commands.js'
import { studioSetup, studioInput, studioFile } from '../../__tests__/studio.js'
import type { Keyboard } from '../productivity-commands.js'
function setup() {
  const s = studioSetup(),
    texts: string[] = [],
    files: { name: string; text: string }[] = [],
    keys: Keyboard[] = [],
    tasks: string[] = [],
    meetings: string[] = []
  const ctx: StudioContext = {
    owner: '42:42',
    thread: '1',
    text: (value, key) => {
      texts.push(value)
      if (key) keys.push(key)
      return Promise.resolve()
    },
    file: (bytes, name) => {
      files.push({ name, text: Buffer.from(bytes).toString() })
      return Promise.resolve()
    },
    input: prompt =>
      Promise.resolve({
        ...studioInput(),
        prompt,
        project: s.ws.thread('42:42', '1').project
      }),
    capture: text =>
      Promise.resolve({
        source: '1',
        thread: '1',
        project: null,
        text,
        documents: [studioFile],
        images: [],
        recording: null
      }),
    task: item => {
      tasks.push(item.id)
      return Promise.resolve()
    },
    meeting: item => {
      meetings.push(item.id)
      return Promise.resolve()
    },
    workspace: () => {
      texts.push('Workspace')
      return Promise.resolve()
    }
  }
  const commands = new StudioCommands(s.studio, s.ws)
  return {
    ...s,
    texts,
    files,
    keys,
    tasks,
    meetings,
    ctx,
    commands,
    button: () => keys.at(-1)!.inline_keyboard[0]![0]!.callback_data
  }
}
void test('mission command plans are inert until owner/thread/revision-bound approval and status/result retrieval stays local', async () => {
  const s = setup()
  assert.equal(await s.commands.handle(s.ctx, 'hello'), false)
  await s.commands.handle(s.ctx, '/workspace')
  await s.commands.handle(s.ctx, '/missions')
  assert.match(s.texts.at(-1)!, /No missions/)
  await s.commands.handle(s.ctx, '/autopilot Make a report')
  let mission = s.studio.get('42:42').missions[0]!
  assert.equal(s.calls.length, 0)
  await s.commands.handle(s.ctx, `/mission ${mission.id}`)
  await s.commands.handle(s.ctx, `/mission context ${mission.id}`)
  assert.match(s.files.at(-1)!.text, /Make a report/)
  const token = s.button()
  assert.equal(await s.commands.callback(s.ctx, 'other'), false)
  await assert.rejects(s.commands.callback({ ...s.ctx, thread: '2' }, token))
  await assert.rejects(
    s.commands.callback(s.ctx, token.replace(':start', ':unknown'))
  )
  await s.commands.callback(s.ctx, token.replace(':start', ':show'))
  await s.commands.callback(s.ctx, token)
  await assert.rejects(s.commands.callback(s.ctx, token))
  await s.commands.handle(s.ctx, '/missions')
  assert.match(s.texts.at(-1)!, /queued/)
  for (const action of ['pause', 'resume', 'cancel'])
    await s.commands.handle(s.ctx, `/mission ${action} ${mission.id}`)
  await assert.rejects(s.commands.handle(s.ctx, `/mission retry ${mission.id}`))
  await assert.rejects(
    s.commands.handle(s.ctx, `/mission retry ${mission.id} confirm`)
  )
  await assert.rejects(
    s.commands.handle(s.ctx, `/mission unknown ${mission.id}`)
  )
  await s.commands.handle(s.ctx, `/mission delete ${mission.id}`)
  await s.commands.handle(s.ctx, '/investigate Public question')
  await s.commands.handle(
    s.ctx,
    '/chain mail | Prepare draft ;; mail | Prepare follow-up'
  )
  mission = s.studio.get('42:42').missions.at(-1)!
  await s.commands.handle(
    s.ctx,
    `/mission edit ${mission.id} 1 | Prepare only a draft`
  )
  await s.commands.callback(s.ctx, s.button().replace(':start', ':cancel'))
  const failed = s.plan()
  s.ports.execute = () => Promise.reject(new Error('provider'))
  s.studio.start('42:42', failed.id, 1)
  await s.studio.tick()
  await s.commands.handle(s.ctx, `/mission retry ${failed.id} confirm`)
  assert.equal(s.studio.mission('42:42', failed.id).state, 'draft')
})
void test('Inbox commands preview retained material, require source scope and propose task/recording work without executing it', async () => {
  const s = setup()
  await s.commands.handle(s.ctx, '/inbox')
  assert.match(s.texts.at(-1)!, /Empty/)
  await s.commands.handle(s.ctx, '/inbox on')
  await s.commands.handle(s.ctx, '/inbox')
  assert.match(s.texts.at(-1)!, /capture: on/)
  await s.commands.handle(s.ctx, '/inbox off')
  await s.commands.handle(s.ctx, '/inbox save Review this')
  const item = s.studio.get('42:42').inbox[0]!
  await s.commands.handle(s.ctx, `/inbox view ${item.id}`)
  assert.equal(s.files.at(-1)!.name, studioFile.name)
  await s.commands.handle(s.ctx, '/inbox')
  assert.match(s.texts.at(-1)!, /files/)
  await s.commands.handle(s.ctx, `/inbox task ${item.id}`)
  assert.deepEqual(s.tasks, [item.id])
  await assert.rejects(s.commands.handle(s.ctx, `/inbox meeting ${item.id}`))
  await s.commands.handle(s.ctx, `/inbox plan ${item.id}`)
  assert.equal(s.studio.get('42:42').missions.length, 1)
  const project = s.ws.create('42:42', 'Work')
  await assert.rejects(
    s.commands.handle(s.ctx, `/inbox assign ${item.id} wrong`)
  )
  await s.commands.handle(s.ctx, `/inbox assign ${item.id} ${project.id}`)
  await assert.rejects(s.commands.handle(s.ctx, `/inbox plan ${item.id}`))
  await s.commands.handle(s.ctx, `/inbox assign ${item.id} none`)
  const recording = s.studio.capture('42:42', {
    ...item,
    source: '2',
    text: '',
    documents: [],
    recording: {
      file: 'audio',
      name: 'meeting.ogg',
      mime: 'audio/ogg',
      bytes: null,
      seconds: null
    }
  })
  await s.commands.handle(s.ctx, `/inbox view ${recording.id}`)
  await s.commands.handle(s.ctx, `/inbox meeting ${recording.id}`)
  assert.deepEqual(s.meetings, [recording.id])
  await assert.rejects(s.commands.handle(s.ctx, `/inbox task ${recording.id}`))
  await assert.rejects(s.commands.handle(s.ctx, `/inbox plan ${recording.id}`))
  const image = s.studio.capture('42:42', {
    ...item,
    source: '3',
    text: '',
    documents: [],
    images: [{ data: 'YQ==', mime: 'image/png' }]
  })
  await s.commands.handle(s.ctx, `/inbox plan ${image.id}`)
  await s.commands.handle(s.ctx, '/inbox')
  assert.match(s.texts.at(-1)!, /Image/)
  const document = s.studio.capture('42:42', { ...item, source: '4', text: '' })
  await s.commands.handle(s.ctx, '/inbox')
  assert.match(s.texts.at(-1)!, /sales.csv/)
  await assert.rejects(
    s.commands.handle({ ...s.ctx, thread: '2' }, `/inbox plan ${document.id}`)
  )
  await assert.rejects(s.commands.handle(s.ctx, `/inbox unknown ${item.id}`))
  await s.commands.handle(s.ctx, `/inbox delete ${item.id}`)
})
void test('result commands preserve versions, export files and require a new plan for model revisions', async () => {
  const s = setup(),
    done = await s.finish(s.plan()),
    version = s.studio.result('42:42', done.id)
  await s.commands.handle(s.ctx, `/result ${done.id}`)
  assert.equal(s.files.at(-1)!.name, studioFile.name)
  await s.commands.handle(s.ctx, `/result export ${done.id}`)
  assert.match(s.files.at(-1)!.text, /example.com/)
  await s.commands.handle(s.ctx, `/result edit ${done.id} | New report`)
  await s.commands.handle(s.ctx, `/result ${done.id}`)
  const second = s.studio.result('42:42', done.id)
  await s.commands.handle(
    s.ctx,
    `/result compare ${done.id} | ${version.id} | ${second.id}`
  )
  assert.match(s.files.at(-1)!.text, /\+ New report/)
  await s.commands.handle(s.ctx, `/result replace ${done.id} | New | Better`)
  await s.commands.handle(s.ctx, `/result restore ${done.id} ${version.id}`)
  await s.commands.handle(
    s.ctx,
    `/result revise ${done.id} | Improve the conclusion`
  )
  for (const arg of [`unknown ${done.id}`, `replace ${done.id}`])
    await assert.rejects(s.commands.handle(s.ctx, `/result ${arg}`))
})
void test('chain reviews show exact arguments, continuation estimates and approval receipts', async () => {
  const s = setup(),
    mission = s.plan('chain')
  s.studio.start('42:42', mission.id, 1)
  await s.studio.tick()
  {
    const current = s.studio.mission('42:42', mission.id)
    s.studio.control('42:42', mission.id, current.revision, 'resume')
  }
  s.ports.execute = () =>
    Promise.resolve({
      text: 'Review',
      images: [],
      approval: {
        connection: 'mail',
        continuation: 'private-state',
        calls: [
          { id: 'a1', name: 'send', arguments: '{"to":"draft@example.com"}' }
        ]
      }
    })
  await s.studio.tick()
  await s.commands.handle(s.ctx, `/mission ${mission.id}`)
  assert.match(s.texts.at(-1)!, /draft@example.com/)
  assert.ok(!s.texts.join('').includes('private-state'))
  const approve = s.button()
  await s.commands.callback(s.ctx, approve)
  await s.commands.handle(s.ctx, `/mission ${mission.id}`)
  assert.match(s.texts.join(' '), /approved: send/)
  await s.studio.tick()
  await s.commands.handle(s.ctx, `/mission ${mission.id}`)
  await s.commands.callback(s.ctx, s.button().replace(':approve:', ':reject:'))
  assert.equal(s.studio.mission('42:42', mission.id).state, 'cancelled')
})
void test('Inbox bulk processing snapshots only selected non-recording items in the active scope', async () => {
  const s = setup()
  await assert.rejects(s.commands.handle(s.ctx, '/inbox process'))
  await s.commands.handle(s.ctx, '/inbox save First')
  const item = s.studio.get('42:42').inbox[0]!
  await s.commands.handle(s.ctx, `/inbox process ${item.id}`)
  assert.match(
    s.studio.get('42:42').missions[0]!.input.prompt,
    /untrusted data/
  )
  const link = s.studio.capture('42:42', {
    ...item,
    source: 'link',
    text: 'https://example.com',
    documents: []
  })
  await s.commands.handle(s.ctx, `/inbox plan ${link.id}`)
  assert.equal(s.studio.get('42:42').missions.at(-1)!.mode, 'research')
  const recording = s.studio.capture('42:42', {
    ...item,
    source: 'record',
    recording: {
      file: 'audio',
      name: 'r.ogg',
      mime: 'audio/ogg',
      bytes: null,
      seconds: null
    }
  })
  await assert.rejects(
    s.commands.handle(s.ctx, `/inbox process ${recording.id}`)
  )
  await assert.rejects(
    s.commands.handle(
      s.ctx,
      '/inbox process ' + Array(11).fill(item.id).join(',')
    )
  )
  await assert.rejects(
    s.commands.handle({ ...s.ctx, thread: '2' }, `/inbox process ${item.id}`)
  )
})
void test('invalid chain syntax stops locally and plain text results need no attachment handling', async () => {
  const s = setup()
  await assert.rejects(s.commands.handle(s.ctx, '/chain invalid'))
  s.ports.execute = () => Promise.resolve({ text: 'Plain', images: [] })
  const done = await s.finish(s.plan())
  await s.commands.handle(s.ctx, `/result ${done.id}`)
  assert.match(s.texts.at(-1)!, /Plain/)
})
void test('completed step inspection returns full output and files while pending or unknown step numbers stay local errors', async () => {
  const s = setup(),
    mission = s.plan()
  await assert.rejects(
    s.commands.handle(s.ctx, `/mission step ${mission.id} 1`)
  )
  s.studio.start('42:42', mission.id, 1)
  await s.studio.tick()
  await s.commands.handle(s.ctx, `/mission step ${mission.id} 1`)
  assert.equal(s.files.at(-1)!.name, studioFile.name)
  await assert.rejects(
    s.commands.handle(s.ctx, `/mission step ${mission.id} 99`)
  )
  s.ports.execute = () => Promise.resolve({ text: 'Plain step', images: [] })
  await s.studio.tick()
  await s.commands.handle(s.ctx, `/mission step ${mission.id} 2`)
  assert.match(s.texts.at(-1)!, /Plain step/)
})
