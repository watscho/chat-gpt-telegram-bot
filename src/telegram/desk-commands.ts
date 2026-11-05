import { UserError } from '../domain/conversation.js'
import type { RoutineContext } from './routine-commands.js'
import { Desk } from '../application/desk.js'
import { DeskPlans, DeskExecutor } from '../application/desk-plans.js'
import { DeskActions } from '../application/desk-actions.js'
import { ConnectionCenter } from '../application/connection-center.js'
import { Studio } from '../application/studio.js'
import { StudioCommands } from './studio-commands.js'
import { Suite } from '../application/suite.js'
export class DeskCommands {
  constructor(
    private readonly data: Desk,
    private readonly plans: DeskPlans,
    private readonly actions: DeskActions,
    private readonly center: ConnectionCenter,
    private readonly studio: Studio,
    private readonly studioCommands: StudioCommands,
    private readonly executor: DeskExecutor,
    private readonly suite: Suite
  ) {}
  async home(ctx: RoutineContext): Promise<void> {
    await ctx.text(
      'Everything in one place. Ask a question, create or edit material, find retained work, review your day or choose a personal assistant. Paid work and external actions remain reviewable.',
      {
        inline_keyboard: [
          [
            { text: 'Ask', callback_data: 'desk:ask' },
            { text: 'Create', callback_data: 'desk:create' }
          ],
          [
            { text: 'My materials', callback_data: 'desk:materials' },
            { text: 'My day', callback_data: 'routine:workspace' }
          ],
          [
            { text: 'Assistants', callback_data: 'desk:assistants' },
            { text: 'Connections', callback_data: 'desk:services' }
          ],
          [{ text: 'Open workspace', callback_data: 'routine:workspace' }]
        ]
      }
    )
  }
  async callback(ctx: RoutineContext, value: string): Promise<boolean> {
    if (!value.startsWith('desk:')) return false
    const [, kind, id] = value.split(':')
    if (kind === 'ask')
      await ctx.text(
        'Send a question, photo or document here. /assistant use ID activates a personal assistant for ordinary text. /assistant use none restores normal chat.'
      )
    else if (kind === 'create')
      await ctx.text(
        'Create: /canvas add TITLE | language | text; /sheet import TITLE (reply to CSV/JSON); /sheet analyze TITLE (reply to Excel); /photos add TITLE (attach/reply to images). Open Workspace for selection, grids and previews.'
      )
    else if (kind === 'materials') await ctx.workspace()
    else if (kind === 'assistants') await this.handle(ctx, '/assistant')
    else if (kind === 'services') await this.handle(ctx, '/services')
    else if (kind === 'use') {
      this.data.use(ctx.owner, ctx.thread, id!)
      await this.handle(ctx, '/assistant')
    } else throw new UserError('Unknown workspace navigation action.')
    return true
  }
  async handle(ctx: RoutineContext, text: string): Promise<boolean> {
    const match = text.match(
      /^\/(hub|desk|canvas|assistant|sheet|photos|browser|services)(?:@\w+)?(?:\s+|$)/i
    )
    if (!match) return false
    const command = match[1]!.toLowerCase(),
      raw = text.slice(match[0].length).trim(),
      parts = raw.split('|').map(value => value.trim()),
      [action, id, third, fourth, fifth, sixth] = parts[0]!.split(/\s+/),
      owner = ctx.owner,
      scope = this.plans.scope(owner, ctx.thread)
    const review = async () => {
      const p = this.data.get(owner).pending
      if (!p) throw new UserError('No current Desk proposal.')
      this.data.review(owner, scope, p.token, p.revision)
      await ctx.file(Buffer.from(p.value), 'desk-review.json')
      await ctx.text(
        `Desk ${p.kind} preview ${p.token} · revision ${p.revision}. Inspect the full attached proposal, then /desk confirm ${p.token} ${p.revision}; cancel uses /desk cancel. Expires in 10 minutes.`
      )
    }
    if (command === 'hub') {
      await this.home(ctx)
      return true
    }
    if (command === 'desk') {
      if (action === 'confirm') {
        this.actions.confirm(owner, scope, id!, Number(third))
        await ctx.text('Reviewed Desk change accepted.')
      } else if (action === 'cancel') {
        this.data.cancel(owner, scope, id!, Number(third))
        await ctx.text('Desk proposal cancelled.')
      } else if (action === 'preview') await review()
      else if (action === 'review') {
        const mission = this.studio.mission(owner, id!),
          step = mission.steps.at(-1)!
        if (
          mission.thread !== ctx.thread ||
          mission.project !== scope.project ||
          !['done', 'paused'].includes(mission.state) ||
          step.desk?.phase !== 'apply'
        )
          throw new UserError(
            'Choose a completed Desk validation in its original scope.'
          )
        const reply = await this.executor.execute(
          owner,
          mission,
          step,
          AbortSignal.timeout(this.data.config.requestTimeoutMs)
        )
        await ctx.text(reply.text)
        for (const file of reply.files ?? [])
          await ctx.file(Buffer.from(file.data, 'base64'), file.name)
      } else if (action === 'export')
        await ctx.file(
          Buffer.from(JSON.stringify(this.data.get(owner), null, 2)),
          'desk.json'
        )
      else await this.home(ctx)
      return true
    }
    if (command === 'services') {
      if (!action)
        await ctx.text(
          JSON.stringify(this.center.list(owner), null, 2) +
            '\n/services authorize ID; enable ID; disconnect ID confirm. Provider access must be configured by the operator. Disconnection blocks local use; revoke provider grants in its own account settings.'
        )
      else if (action === 'authorize')
        await ctx.text(
          'Open this provider authorization URL. Check the requested scopes and return to Connections after completing it.\n' +
            this.center.begin(owner, id!)
        )
      else if (action === 'enable') {
        this.center.enable(owner, id!)
        await ctx.text(
          'Connection enabled. Existing or new authorization is still required.'
        )
      } else if (action === 'disconnect' && third === 'confirm') {
        this.center.disconnect(owner, id!)
        await ctx.text(
          'Connection disconnected locally; its stored access token was removed.'
        )
      } else
        throw new UserError(
          'Use /services for supported authorization and connection controls.'
        )
      return true
    }
    if (command === 'assistant') {
      if (!action) {
        const state = this.data.get(owner)
        await ctx.text(
          'Personal assistants\n' +
            state.assistants
              .map(
                item =>
                  `${item.id} · ${item.title} · tools ${item.tools.join(', ') || 'chat only'}`
              )
              .join('\n') +
            '\n/assistant add TITLE | instructions | model or default | tool,tool\n/assistant use ID_OR_none; sources ID (copy explicit Suite selection); ask ID TOOL_OR_chat | request; show ID; remove ID confirm',
          {
            inline_keyboard: state.assistants
              .slice(0, 10)
              .map(item => [
                { text: item.title, callback_data: `desk:use:${item.id}` }
              ])
          }
        )
      } else if (action === 'add') {
        const created = this.data.assistant(
          owner,
          parts[0]!.slice(4).trim(),
          parts[1] ?? '',
          parts[2] && parts[2] !== 'default' ? parts[2] : null,
          (parts[3] ?? '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
        )
        await ctx.text('Assistant created: ' + created)
      } else if (action === 'use') {
        this.data.use(owner, ctx.thread, id!)
        await ctx.text(
          'Active assistant updated. Ordinary text uses its explicit instructions and sources, with model tools off; request an allowed tool through /assistant ask.'
        )
      } else if (action === 'sources') {
        this.data.assistantSources(owner, id!, this.suite.get(owner).selected)
        await ctx.text('Explicit source selection copied to the assistant.')
      } else if (action === 'ask')
        await this.studioCommands.show(
          ctx,
          this.plans.assistant(
            owner,
            ctx.thread,
            id!,
            parts.slice(1).join('|'),
            third ?? 'chat',
            await ctx.materials()
          )
        )
      else if (action === 'show')
        await ctx.file(
          Buffer.from(
            JSON.stringify(this.data.assistantItem(owner, id!), null, 2)
          ),
          'assistant.json'
        )
      else if (action === 'remove' && third === 'confirm') {
        this.data.remove(owner, scope, 'assistants', id!)
        await ctx.text('Assistant removed.')
      } else throw new UserError('Unknown assistant action. Use /assistant.')
      return true
    }
    if (command === 'canvas') {
      if (!action)
        await ctx.text(
          JSON.stringify(
            this.data
              .get(owner)
              .documents.filter(
                item =>
                  item.thread === scope.thread && item.project === scope.project
              )
              .map(item => ({
                id: item.id,
                title: item.title,
                revision: item.revision
              }))
          ) +
            '\n/canvas add TITLE | language | text; show ID; save ID REVISION | text; edit ID REVISION START END | instruction; restore ID REVISION VERSION; export ID VERSION; remove ID confirm. Workspace supports selecting the passage directly.'
        )
      else if (action === 'add') {
        const item = this.data.create(
          owner,
          scope,
          parts[0]!.slice(4).trim(),
          parts[1] ?? 'text',
          parts.slice(2).join('|') || ctx.quote()
        )
        await ctx.text(`Canvas document ${item.id} · revision ${item.revision}`)
      } else if (action === 'show') {
        const item = this.data.document(owner, id!, scope)
        await ctx.file(
          Buffer.from(JSON.stringify(item, null, 2)),
          'canvas.json'
        )
      } else if (action === 'save') {
        this.data.write(
          owner,
          scope,
          id!,
          Number(third),
          parts.slice(1).join('|')
        )
        await ctx.text('Document saved.')
      } else if (action === 'edit')
        await this.studioCommands.show(
          ctx,
          this.plans.edit(
            owner,
            ctx.thread,
            id!,
            Number(third),
            Number(fourth),
            Number(fifth),
            parts.slice(1).join('|')
          )
        )
      else if (action === 'restore') {
        this.data.restore(owner, scope, id!, Number(third), fourth!)
        await ctx.text('Document version restored as a new revision.')
      } else if (action === 'export') {
        const file = this.actions.file(owner, scope, 'canvas', id!, third!)
        await ctx.file(Buffer.from(file.data, 'base64'), file.name)
      } else if (action === 'remove' && third === 'confirm') {
        this.data.remove(owner, scope, 'documents', id!)
        await ctx.text('Document removed.')
      } else throw new UserError('Unknown canvas action.')
      return true
    }
    if (command === 'sheet') {
      if (!action)
        await ctx.text(
          'Interactive tables: /sheet import TITLE (reply to UTF-8 CSV/JSON); analyze TITLE (reply to Excel); from MISSION_ID FILENAME | title; show ID; cell ID REV ROW COLUMN | value; restore ID REV VERSION; export ID VERSION; remove ID confirm. Row/column numbers start at one. Filtering, numeric sorting and charts are in Workspace.'
        )
      else if (action === 'import') {
        const file = await ctx.document()
        if (!file) throw new UserError('Reply to an explicit CSV/JSON file.')
        this.actions.importTable(owner, scope, parts[0]!.slice(7).trim(), file)
        await review()
      } else if (action === 'analyze')
        await this.studioCommands.show(
          ctx,
          this.plans.table(
            owner,
            ctx.thread,
            parts[0]!.slice(8).trim(),
            await ctx.materials()
          )
        )
      else if (action === 'from') {
        const mission = this.studio.mission(owner, id!)
        if (
          mission.thread !== scope.thread ||
          mission.project !== scope.project
        )
          throw new UserError('Select the source analysis scope.')
        const reply = this.studio.result(owner, id!).reply,
          file = reply.files?.find(file => file.name === third)
        if (!file) throw new UserError('Analysis file not found.')
        this.actions.importTable(owner, scope, parts[1] ?? file.name, file)
        await review()
      } else if (action === 'show')
        await ctx.file(
          Buffer.from(
            JSON.stringify(this.data.table(owner, id!, scope), null, 2)
          ),
          'table.json'
        )
      else if (action === 'cell') {
        this.data.cell(
          owner,
          scope,
          id!,
          Number(third),
          Number(fourth) - 1,
          Number(fifth) - 1,
          parts.slice(1).join('|')
        )
        await ctx.text('Table cell saved.')
      } else if (action === 'restore') {
        this.data.tableRestore(owner, scope, id!, Number(third), fourth!)
        await ctx.text('Table version restored.')
      } else if (action === 'export') {
        const file = this.actions.file(owner, scope, 'table', id!, third!)
        await ctx.file(Buffer.from(file.data, 'base64'), file.name)
      } else if (action === 'remove' && third === 'confirm') {
        this.data.remove(owner, scope, 'tables', id!)
        await ctx.text('Table removed.')
      } else throw new UserError('Unknown sheet action.')
      return true
    }
    if (command === 'photos') {
      if (!action)
        await ctx.text(
          'Photo projects: /photos add TITLE (attach/reply to images); show ID; edit ID IMAGE_ID X Y WIDTH HEIGHT | instruction; export ID IMAGE_ID; remove ID confirm. Selected-region editing requires an original PNG; coordinates are original-image pixels. Workspace offers a visual rectangle selection.'
        )
      else if (action === 'add') {
        const materials = await ctx.materials(),
          created = this.data.photoAdd(
            owner,
            scope,
            parts[0]!.slice(4).trim(),
            materials.images
          )
        await ctx.text('Photo project created: ' + created)
      } else if (action === 'show')
        await ctx.text(
          JSON.stringify(
            this.data.photo(owner, id!, scope).images.map(item => ({
              id: item.id,
              label: item.label,
              at: item.at
            }))
          )
        )
      else if (action === 'edit')
        await this.studioCommands.show(
          ctx,
          this.plans.photo(
            owner,
            ctx.thread,
            id!,
            third!,
            {
              x: Number(fourth),
              y: Number(fifth),
              width: Number(sixth),
              height: Number(parts[0]!.split(/\s+/)[6])
            },
            parts.slice(1).join('|')
          )
        )
      else if (action === 'export') {
        const file = this.actions.file(owner, scope, 'photo', id!, third!)
        await ctx.file(Buffer.from(file.data, 'base64'), file.name)
      } else if (action === 'remove' && third === 'confirm') {
        this.data.remove(owner, scope, 'photos', id!)
        await ctx.text('Photo project removed.')
      } else throw new UserError('Unknown photo project action.')
      return true
    }
    if (!action)
      await ctx.text(
        JSON.stringify(this.data.get(owner).browsers, null, 2) +
          '\n/browser add TITLE | CONNECTION | https://origin,https://origin | tool,tool\n/browser run ID URL | goal; remove ID confirm. Operator must provide an isolated MCP browser driver enforcing origins, downloads and permissions. Every proposed operation requires exact approval.'
      )
    else if (action === 'add') {
      const created = this.data.browser(
        owner,
        parts[0]!.slice(4).trim(),
        parts[1] ?? '',
        (parts[2] ?? '').split(','),
        (parts[3] ?? '').split(',')
      )
      await ctx.text('Browser recipe created: ' + created)
    } else if (action === 'run')
      await this.studioCommands.show(
        ctx,
        this.plans.browser(
          owner,
          ctx.thread,
          id!,
          third!,
          parts.slice(1).join('|')
        )
      )
    else if (action === 'remove' && third === 'confirm') {
      this.data.remove(owner, scope, 'browsers', id!)
      await ctx.text('Browser recipe removed.')
    } else throw new UserError('Unknown browser action.')
    return true
  }
}
