import {
  routineSetup,
  routineOwner as owner,
  routineScope as scope
} from './routines.js'
import { Desk } from '../application/desk.js'
import { DeskPlans, DeskExecutor } from '../application/desk-plans.js'
import { DeskActions } from '../application/desk-actions.js'
import { ConnectionCenter } from '../application/connection-center.js'
import { DeskWorkspace } from '../application/desk-workspace.js'
import { DeskCommands } from '../telegram/desk-commands.js'
import { StudioCommands } from '../telegram/studio-commands.js'
export { owner, scope }
export function deskPNG(width = 2, height = 2) {
  const bytes = Buffer.alloc(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return { mime: 'image/png' as const, data: bytes.toString('base64') }
}
export function deskSetup() {
  const s = routineSetup(),
    data = new Desk(s.settings, s.store, s.now),
    plans = new DeskPlans(data, s.studio, s.ws),
    search = {
      search: () => [
        {
          id: 'source',
          title: 'Selected note',
          text: 'Useful owned material',
          thread: '1',
          project: null,
          kind: 'note',
          score: 1,
          excerpt: 'Useful',
          at: 1
        }
      ]
    },
    actions = new DeskActions(data, s.workflow, s.studio, search),
    requests: { url: string; options: RequestInit | undefined }[] = []
  let response: unknown = {
      access_token: 'oauth-unit-token',
      expires_in: 3600
    },
    ok = true,
    raw: string | null = null
  const request: typeof fetch = (input, options) => {
    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      options
    })
    return Promise.resolve(
      new Response(raw ?? JSON.stringify(response), { status: ok ? 200 : 400 })
    )
  }
  const center = new ConnectionCenter(s.settings, s.store, request, s.now),
    executor = new DeskExecutor(
      data,
      s.executor,
      s.routineExecutor,
      () => undefined
    ),
    view = new DeskWorkspace(data, plans, actions, center, s.profiles, s.ws),
    commands = new DeskCommands(
      data,
      plans,
      actions,
      center,
      s.studio,
      new StudioCommands(s.studio, s.ws),
      executor,
      s.suite
    )
  return {
    ...s,
    data,
    plans,
    actions,
    center,
    deskExecutor: executor,
    deskView: view,
    deskCommands: commands,
    search,
    requests,
    setOAuth: (value: unknown, success = true, text: string | null = null) => {
      response = value
      ok = success
      raw = text
    },
    oauth: () => {
      const item = s.settings.workbench.connections[0]!
      item.oauth = {
        authorizationURL: 'https://auth.example.com/authorize',
        tokenURL: 'https://auth.example.com/token',
        clientID: 'unit-client',
        scopes: ['mail.read']
      }
      s.settings.workbench.miniAppURL = 'https://bot.example.com/voice'
      return item
    }
  }
}
