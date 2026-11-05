import type { SuiteExecutor } from '../application/suite-executor.js'
import { createHash } from 'node:crypto'
import type { Config } from '../config.js'
import { UserError, type Document } from '../domain/conversation.js'
import type { StudioContext } from './studio-commands.js'
import { StudioCommands } from './studio-commands.js'
import { Suite, suiteStrings } from '../application/suite.js'
import { Studio } from '../application/studio.js'
import { Workspaces } from '../application/workspaces.js'
import { WorkSearch } from '../application/work-search.js'
import { Watches } from '../application/watches.js'
import { SharedProjects } from '../application/shared-projects.js'
import {
  compileWorkflow,
  suiteCatalog,
  workflowSpec
} from '../application/suite-workflows.js'
import type {
  ArchiveItem,
  SuiteAssetPorts,
  VideoReference,
  RecipeStep
} from '../domain/suite.js'
export interface SuiteContext extends StudioContext {
  quote(): string
  document(): Promise<Document | undefined>
  video(): VideoReference | undefined
}
export class SuiteCommands {
  constructor(
    private readonly config: Config,
    private readonly suite: Suite,
    private readonly studio: Studio,
    private readonly commands: StudioCommands,
    private readonly ws: Workspaces,
    private readonly search: WorkSearch,
    private readonly watches: Watches,
    private readonly teams: SharedProjects,
    private readonly assets: SuiteAssetPorts,
    private readonly executor: SuiteExecutor
  ) {}
  private scope(ctx: SuiteContext) {
    return {
      thread: ctx.thread,
      project: this.ws.thread(ctx.owner, ctx.thread).project,
      sourceRevision: undefined
    }
  }
  async handle(ctx: SuiteContext, text: string): Promise<boolean> {
    const match = text.match(/^\/suite(?:@\w+)?(?:\s+|$)/i)
    if (!match) {
      if (!text.startsWith('/')) {
        const listener = this.suite.listener(ctx.owner, ctx.thread)
        if (listener) {
          this.suite.clearListener(ctx.owner)
          if (listener.kind === 'form') {
            const record = this.suite.record(
                ctx.owner,
                listener.record,
                'form'
              ),
              row = record.rows.find(row => !row.value?.trim())
            if (!row?.field)
              throw new UserError('No missing form fields remain.')
            this.suite.answerField(ctx.owner, record.id, row.field, text)
            await ctx.text(
              `Saved ${row.field}. /suite record ${record.id} or /suite session ${record.id} for the next missing field.`
            )
          } else
            await this.plan(ctx, listener.kind, text, {
              record: listener.record
            })
          return true
        }
      }
      return false
    }
    const arg = text.slice(match[0].length).trim(),
      split = arg.split('|').map(part => part.trim()),
      parts = split[0]!.split(/\s+/),
      [action, id, extra] = parts
    if (!action) {
      await ctx.text(
        `Pro Suite: reviewed plans, explicit sources and local artifacts.\n${Object.entries(
          suiteCatalog
        )
          .map(([key]) => `/suite ${key} | goal`)
          .join(
            '\n'
          )}\n/suite search QUERY; /suite select ID; /suite sources; /suite clear\n/suite watch; /suite brand-template; /suite quality-rule; /suite records; /suite team; /suite zip; /suite recipe\n/suite review MISSION_ID reopens an expired record preview without a model call. /suite remind RECORD_ID ROW_NUMBER proposes a separately reviewed reminder. /suite session RECORD_ID starts an explicitly selected learning/rehearsal/form session. /suite stop stops it. Nothing is sent to others by these workflows.`
      )
      return true
    }
    if (action === 'models') {
      await ctx.text(
        `Configured independent review models: ${this.config.suite.reviewModels.join(', ')}. Choose one different from the current model; reviewer surcharge estimate $${(this.config.suite.reviewExtra / 1000000).toFixed(6)} plus the normal chat estimate. /suite referee MODEL | goal`
      )
      return true
    }
    if (action === 'stop') {
      this.suite.clearListener(ctx.owner)
      await ctx.text('Suite session stopped.')
      return true
    }
    if (action === 'search') {
      const hits = this.search.search(ctx.owner, arg.slice(7))
      await ctx.text(
        hits
          .map(hit => `${hit.id} · ${hit.kind} · ${hit.title}\n${hit.excerpt}`)
          .join('\n\n') ||
          'No retained source matches. Try a distinctive name or keyword.'
      )
      return true
    }
    if (action === 'select') {
      this.suite.select(ctx.owner, this.search.open(ctx.owner, id!))
      await ctx.text(
        'Source excerpt selected explicitly. /suite sources inspects the exact model context.'
      )
      return true
    }
    if (action === 'sources') {
      await ctx.file(
        Buffer.from(
          JSON.stringify(this.suite.get(ctx.owner).selected, null, 2)
        ),
        'selected-sources.json'
      )
      return true
    }
    if (action === 'clear') {
      this.suite.clearSelected(ctx.owner)
      await ctx.text('Selected source excerpts cleared.')
      return true
    }
    if (action === 'records') {
      await ctx.text(
        this.suite
          .get(ctx.owner)
          .records.map(
            record =>
              `${record.id} · ${record.kind} · revision ${record.revision} · ${record.title}`
          )
          .join('\n') || 'No confirmed records.'
      )
      return true
    }
    if (action === 'review') {
      const mission = this.studio.mission(ctx.owner, id!),
        stage = mission.steps.at(-1)!
      if (
        !['done', 'paused'].includes(mission.state) ||
        stage.kind !== 'local' ||
        stage.workflow?.phase !== 'record' ||
        mission.thread !== ctx.thread ||
        mission.project !== this.scope(ctx).project
      )
        throw new UserError(
          'Choose a completed record workflow in its source conversation/project.'
        )
      const result = await this.executor.execute(
        ctx.owner,
        mission,
        stage,
        AbortSignal.timeout(this.config.requestTimeoutMs)
      )
      await ctx.text(result.text)
      return true
    }
    if (action === 'confirm') {
      const record = this.suite.confirmRecord(
        ctx.owner,
        this.scope(ctx),
        id!,
        Number(extra)
      )
      await ctx.text(
        `Saved ${record.kind} ${record.id}. /suite record ${record.id}; /suite session ${record.id} for continuing work. No reminder or message was created.`
      )
      return true
    }
    if (action === 'record') {
      const record = this.suite.record(ctx.owner, id!)
      await ctx.file(
        Buffer.from(JSON.stringify(record, null, 2)),
        `record-${record.id}.json`
      )
      await ctx.text(
        `Revision ${record.revision}. /suite delete ${record.id}; /suite session ${record.id}; /suite answer ${record.id} FIELD | value; /suite export ${record.id} docx|pptx|pdf`
      )
      return true
    }
    if (action === 'delete') {
      this.suite.removeRecord(ctx.owner, id!)
      await ctx.text('Record and its retained revisions removed.')
      return true
    }
    if (action === 'session') {
      const record = this.suite.record(ctx.owner, id!)
      if (!['course', 'rehearsal', 'form'].includes(record.kind))
        throw new UserError('Choose a course, rehearsal or form record.')
      this.suite.listen(
        ctx.owner,
        ctx.thread,
        record.kind === 'course'
          ? 'learn'
          : record.kind === 'form'
            ? 'form'
            : 'rehearse',
        record.id
      )
      const missing = record.rows.find(row => !row.value?.trim())
      await ctx.text(
        record.kind === 'form'
          ? `Next field: ${missing?.label ?? 'No missing fields'}. Send its value, or /suite stop.`
          : 'Send your next answer as text or a voice message. A fresh mission plan will require cost approval; accepting its result updates the record. Session expires in 10 minutes. /suite stop ends it.'
      )
      return true
    }
    if (action === 'remind') {
      const record = this.suite.record(ctx.owner, id!),
        row = record.rows[Number(extra) - 1]
      if (
        !row ||
        record.thread !== ctx.thread ||
        record.project !== this.scope(ctx).project
      )
        throw new UserError(
          'Choose a row in the current record conversation/project.'
        )
      await ctx.task({
        id: record.id,
        source: `record:${record.id}:${record.revision}:${extra}`,
        thread: record.thread,
        project: record.project,
        kind: 'text',
        text: JSON.stringify(row),
        documents: [],
        images: [],
        recording: null,
        createdAt: record.createdAt
      })
      return true
    }
    if (action === 'answer') {
      this.suite.answerField(ctx.owner, id!, extra!, split.slice(1).join('|'))
      await ctx.text('Reviewed field value saved.')
      return true
    }
    if (action === 'export') {
      const record = this.suite.record(ctx.owner, id!)
      if (!['docx', 'pptx', 'pdf'].includes(extra!))
        throw new UserError('Choose docx, pptx or pdf.')
      const document = await this.assets.document(
        this.suite.template(ctx.owner, 'default'),
        extra as 'docx' | 'pptx' | 'pdf',
        record.title,
        record.rows.map((row, index) => ({
          heading: `Entry ${index + 1}`,
          text: Object.entries(row)
            .map(([key, value]) => `${key}: ${value ?? '(missing)'}`)
            .join('\n')
        }))
      )
      await ctx.file(Buffer.from(document.data, 'base64'), document.name)
      return true
    }
    if (action === 'quality-rule') {
      if (id === 'add') {
        const rule = this.suite.criterion(
          ctx.owner,
          extra === 'project' ? this.scope(ctx).project : null,
          split[1] ?? '',
          split[2] ?? ''
        )
        await ctx.text(`Saved criterion ${rule.id}.`)
      } else if (id === 'remove') {
        this.suite.removeCriterion(ctx.owner, extra!)
        await ctx.text('Criterion removed.')
      } else
        await ctx.text(
          `${this.suite.qualityText(ctx.owner, this.scope(ctx).project) || 'No personal criteria.'}\n/suite quality-rule add global|project | label | check\n/suite quality-rule remove ID`
        )
      return true
    }
    if (action === 'brand-template') {
      if (id === 'remove') {
        this.suite.removeTemplate(ctx.owner, extra!)
        await ctx.text('Template removed.')
        return true
      }
      if (id === 'import') {
        const document = await ctx.document()
        if (!document)
          throw new UserError('Reply to a DOCX or PPTX reference file.')
        const template = this.suite.saveTemplate(
          ctx.owner,
          await this.assets.template(document, extra!)
        )
        await ctx.text(
          `Imported palette, font and headings into ${template.name}; inspect /suite brand-template show ${template.name}. Reference layout is not copied.`
        )
        return true
      }
      if (id === 'set') {
        const template = this.suite.saveTemplate(ctx.owner, {
          name: extra!,
          revision: 0,
          brand: split[1] ?? '',
          accent: split[2] ?? '',
          font: split[3] ?? '',
          footer: split[4] ?? '',
          headings: split.slice(5)
        })
        await ctx.text(
          `Saved template ${template.name} revision ${template.revision}.`
        )
        return true
      }
      if (id === 'show') {
        await ctx.text(
          JSON.stringify(this.suite.template(ctx.owner, extra!), null, 2)
        )
        return true
      }
      await ctx.text(
        `${this.suite
          .get(ctx.owner)
          .templates.map(item => `${item.name} · revision ${item.revision}`)
          .join(
            '\n'
          )}\n/suite brand-template set NAME | brand | HEX_COLOR | font | footer | heading...\n/suite brand-template import NAME (reply to DOCX/PPTX); show NAME; remove NAME\n/suite brand TEMPLATE docx|pptx|pdf | goal`
      )
      return true
    }
    if (action === 'watch') {
      await this.watch(ctx, parts.slice(1), split)
      return true
    }
    if (action === 'team') {
      await this.team(ctx, parts.slice(1), split)
      return true
    }
    if (action === 'zip') {
      await this.zip(ctx, parts.slice(1), split)
      return true
    }
    if (action === 'recipe') {
      await this.recipe(ctx, parts.slice(1), split)
      return true
    }
    await this.plan(
      ctx,
      action,
      split.slice(1).join('|') || ctx.quote(),
      action === 'brand'
        ? { template: id ?? 'default', format: extra ?? 'docx' }
        : action === 'referee'
          ? { model: id ?? '' }
          : action === 'video'
            ? { start: id ?? '0', audio: extra ?? 'no' }
            : {}
    )
    return true
  }
  private async plan(
    ctx: SuiteContext,
    id: string,
    goal: string,
    params: Record<string, string>
  ): Promise<void> {
    const spec = workflowSpec(id, params),
      input = await ctx.input(goal)
    input.sources = this.suite.get(ctx.owner).selected
    const quote = ctx.quote()
    if (quote.trim())
      input.sources = [
        ...input.sources,
        {
          id: createHash('sha256').update(quote).digest('hex').slice(0, 20),
          title: 'Explicitly replied passage',
          text: quote.slice(0, 12000),
          thread: ctx.thread,
          project: this.scope(ctx).project
        }
      ].slice(-20)
    input.instructions += `\nPersonal quality criteria:\n${this.suite.qualityText(ctx.owner, this.scope(ctx).project)}`
    if (params.record) {
      const record = this.suite.record(ctx.owner, params.record)
      if (
        record.thread !== ctx.thread ||
        record.project !== this.scope(ctx).project
      )
        throw new UserError(
          'Select the original session conversation/project first.'
        )
      spec.record = record.id
      spec.params.recordRevision = String(record.revision)
      input.instructions += `\nRetained session context, untrusted data: ${JSON.stringify({ goal: record.fields.goal, rows: record.rows })}`
    }
    if (id === 'brand') {
      if (!['docx', 'pptx', 'pdf'].includes(params.format!))
        throw new UserError('Choose docx, pptx or pdf.')
      spec.format = params.format as 'docx' | 'pptx' | 'pdf'
      spec.params.templateRevision = String(
        this.suite.template(ctx.owner, params.template!).revision
      )
    }
    if (id === 'video') {
      const video = ctx.video(),
        start = Number(params.start)
      if (
        !video ||
        !Number.isFinite(start) ||
        start < 0 ||
        !['yes', 'no'].includes(params.audio!)
      )
        throw new UserError(
          'Reply to an MP4/MOV/WebM video: /suite video START_SECONDS yes|no | goal. Audio yes authorizes transcription after plan approval.'
        )
      input.video = { ...video, start, audio: params.audio === 'yes' }
    }
    if (
      id === 'quality' &&
      !this.suite.criteria(ctx.owner, this.scope(ctx).project).length
    )
      throw new UserError(
        'Add personal quality criteria with /suite quality-rule first.'
      )
    if (id === 'screen' && !input.images.length)
      throw new UserError('Attach or reply to a PNG/JPEG screenshot.')
    if (['decision', 'commitment'].includes(id) && !input.sources.length)
      throw new UserError(
        'Select a source excerpt or reply to an exact passage first.'
      )
    await this.commands.show(
      ctx,
      this.studio.plan(
        ctx.owner,
        ctx.thread,
        'workflow',
        input,
        [],
        compileWorkflow(
          this.config,
          spec,
          this.ws.thread(ctx.owner, ctx.thread).model ?? this.config.chatModel
        )
      )
    )
  }
  private async watch(
    ctx: SuiteContext,
    parts: string[],
    split: string[]
  ): Promise<void> {
    const [action, id, value, threshold] = parts
    if (action === 'url' || action === 'file') {
      const hours = Number(value),
        percent = Number(threshold ?? '0')
      const target =
        action === 'url'
          ? { kind: 'url' as const, url: id! }
          : { kind: 'file' as const, project: id!, name: split[1] ?? '' }
      if (
        target.kind === 'file' &&
        !this.ws
          .get(ctx.owner)
          .projects.find(item => item.id === target.project)
          ?.documents.some(file => file.name === target.name)
      )
        throw new UserError('Choose an owned project file.')
      const watch = this.watches.add(
        ctx.owner,
        ctx.thread,
        target,
        hours * 3600000,
        percent
      )
      await ctx.text(
        `Watch ${watch.id} enabled. Initial check establishes a baseline. No model calls.`
      )
    } else if (action === 'remove') {
      this.watches.remove(ctx.owner, id!)
      await ctx.text('Watch removed.')
    } else if (action === 'on' || action === 'off') {
      this.watches.enable(ctx.owner, id!, action === 'on')
      await ctx.text('Watch updated.')
    } else if (action === 'check') {
      await this.watches.check(ctx.owner, id!)
      await ctx.text(JSON.stringify(this.watches.item(ctx.owner, id!), null, 2))
    } else if (action === 'show') {
      await ctx.file(
        Buffer.from(JSON.stringify(this.watches.item(ctx.owner, id!), null, 2)),
        `watch-${id}.json`
      )
    } else
      await ctx.text(
        `${this.watches
          .get(ctx.owner)
          .map(
            item =>
              `${item.id} · ${item.enabled ? 'on' : 'off'} · ${JSON.stringify(item.target)} · ${item.error}`
          )
          .join(
            '\n'
          )}\n/suite watch url URL HOURS THRESHOLD_PERCENT\n/suite watch file PROJECT_ID HOURS THRESHOLD_PERCENT | filename\n/suite watch show|check|on|off|remove ID`
      )
  }
  private async team(
    ctx: SuiteContext,
    parts: string[],
    split: string[]
  ): Promise<void> {
    const [action, id, target, role] = parts
    if (action === 'create') {
      await ctx.text(
        JSON.stringify(this.teams.create(ctx.owner, split[1] ?? ''), null, 2)
      )
      return
    }
    if (action === 'invitations') {
      await ctx.text(JSON.stringify(this.teams.invitations(ctx.owner), null, 2))
      return
    }
    if (action === 'accept') {
      await ctx.text(
        JSON.stringify(this.teams.accept(ctx.owner, id!, target!), null, 2)
      )
      return
    }
    if (!action) {
      await ctx.text(
        `${JSON.stringify(this.teams.list(ctx.owner), null, 2)}\n/suite team create | title; invitations; accept TEAM TOKEN; show TEAM; invite TEAM USER_ID reader|editor; revoke TEAM USER_ID; role TEAM USER_ID reader|editor\n/suite team publish TEAM | note (reply to an optional file); confirm TOKEN REVISION; file TEAM FILE; remove TEAM CONTENT_ID; task TEAM ASSIGNEE_OR_none | title; done TEAM TASK; leave TEAM; close TEAM confirm`
      )
      return
    }
    if (action === 'confirm') {
      const pending = this.suite.takePending(
          ctx.owner,
          this.scope(ctx),
          id!,
          Number(target),
          'share'
        ),
        payload = JSON.parse(pending.payload) as {
          team: string
          revision: number
          files: Document[]
          notes: string[]
        }
      this.teams.publish(
        ctx.owner,
        payload.team,
        payload.revision,
        payload.files,
        payload.notes
      )
      await ctx.text('Reviewed content published to the shared project.')
      return
    }
    const team = this.teams.inspect(ctx.owner, id!)
    if (action === 'show') await ctx.text(JSON.stringify(team, null, 2))
    else if (action === 'invite') {
      const invite = this.teams.invite(
        ctx.owner,
        id!,
        team.revision,
        `${target}:${target}`,
        role!
      )
      await ctx.text(
        `Invitation ${invite.token} created for user ${target}; expires in 10 minutes. Recipient must explicitly accept it. No message was sent.`
      )
    } else if (action === 'revoke') {
      this.teams.revoke(ctx.owner, id!, team.revision, `${target}:${target}`)
      await ctx.text('Access and pending invitations revoked.')
    } else if (action === 'role') {
      this.teams.role(
        ctx.owner,
        id!,
        team.revision,
        `${target}:${target}`,
        role!
      )
      await ctx.text('Member role updated.')
    } else if (action === 'publish') {
      const document = await ctx.document(),
        notes = split[1] ? [split.slice(1).join('|')] : [],
        files = document ? [document] : []
      if (!notes.length && !files.length)
        throw new UserError('Choose an explicit note or replied file.')
      const pending = this.suite.stage(ctx.owner, this.scope(ctx), 'share', {
        team: id,
        revision: team.revision,
        files,
        notes
      })
      await ctx.text(
        `Publish to ${team.title}, members ${team.members.map(member => member.owner).join(', ')}\nFiles: ${files.map(file => file.name).join(', ') || 'none'}\nNotes: ${notes.join('\n')}\n/suite team confirm ${pending.token} ${pending.revision}. No private history is included.`
      )
    } else if (action === 'file') {
      const file = this.teams.file(ctx.owner, id!, target!)
      await ctx.file(Buffer.from(file.data, 'base64'), file.name)
    } else if (action === 'remove') {
      this.teams.removeContent(ctx.owner, id!, team.revision, target!)
      await ctx.text('Shared content removed.')
    } else if (action === 'task') {
      this.teams.task(
        ctx.owner,
        id!,
        team.revision,
        split[1] ?? '',
        target === 'none' ? null : `${target}:${target}`
      )
      await ctx.text('Shared task created.')
    } else if (action === 'done') {
      const task = team.tasks.find(task => task.id === target)
      if (!task) throw new UserError('Shared task not found.')
      this.teams.task(
        ctx.owner,
        id!,
        team.revision,
        task.title,
        task.assignee,
        task.id,
        true
      )
      await ctx.text('Shared task completed.')
    } else if (action === 'leave') {
      this.teams.leave(ctx.owner, id!, team.revision)
      await ctx.text('Shared project access removed.')
    } else if (action === 'close' && target === 'confirm') {
      this.teams.close(ctx.owner, id!, team.revision)
      await ctx.text('Shared project closed and local shared content removed.')
    } else
      throw new UserError('Unknown shared-project action. Use /suite team.')
  }
  private async zip(
    ctx: SuiteContext,
    parts: string[],
    split: string[]
  ): Promise<void> {
    const [action, token, revision, entry] = parts
    type Payload = {
      items: (Omit<ArchiveItem, 'bytes'> & { size: number })[]
      data: Record<string, string>
      manifest: string
    }
    if (action === 'confirm' || action === 'rename') {
      const pending = this.suite.pending(
        ctx.owner,
        this.scope(ctx),
        token!,
        Number(revision)
      )
      if (pending.kind !== 'zip') throw new UserError('Choose a ZIP preview.')
      const payload = JSON.parse(pending.payload) as Payload
      if (action === 'rename') {
        const item = payload.items.find(item => item.id === entry),
          name = split[1] ?? ''
        if (
          !item ||
          !name ||
          name.length > 160 ||
          !/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/.test(name) ||
          name === '.' ||
          name === '..'
        )
          throw new UserError('Choose an existing entry and safe basename.')
        item.name = `${item.group}/${name}`
        if (
          new Set(payload.items.map(item => item.name.toLowerCase())).size !==
          payload.items.length
        )
          throw new UserError('Archive names must be unique.')
        const changed = this.suite.replacePending(
          ctx.owner,
          this.scope(ctx),
          token!,
          Number(revision),
          payload
        )
        await ctx.text(
          `Renamed. /suite zip confirm ${changed.token} ${changed.revision}`
        )
        return
      }
      const manifest = JSON.stringify(payload.items, null, 2),
        data = await this.assets.package([
          ...payload.items
            .filter(item => !item.duplicateOf)
            .map(item => ({
              name: item.name,
              data: Buffer.from(payload.data[item.id]!, 'base64')
            })),
          { name: 'manifest.json', data: Buffer.from(manifest) }
        ])
      this.suite.takePending(
        ctx.owner,
        this.scope(ctx),
        token!,
        Number(revision),
        'zip'
      )
      await ctx.file(data, 'organized.zip')
      return
    }
    if (action)
      throw new UserError(
        'Use /suite zip while replying to an archive, rename TOKEN REVISION ENTRY | basename, or confirm TOKEN REVISION.'
      )
    const document = await ctx.document()
    if (!document || !document.name.toLowerCase().endsWith('.zip'))
      throw new UserError(
        'Reply to a ZIP archive. Entries are never executed or extracted to disk.'
      )
    const archive = await this.assets.archive(
        Buffer.from(document.data, 'base64')
      ),
      payload: Payload = {
        items: archive.items.map(item => ({
          id: item.id,
          name: item.name,
          group: item.group,
          hash: item.hash,
          duplicateOf: item.duplicateOf,
          size: item.bytes.length
        })),
        data: Object.fromEntries(
          archive.items.map(item => [
            item.id,
            Buffer.from(item.bytes).toString('base64')
          ])
        ),
        manifest: archive.manifest
      },
      pending = this.suite.stage(ctx.owner, this.scope(ctx), 'zip', payload)
    await ctx.text(
      `${payload.items.map(item => `${item.id} · ${item.name} · ${item.size} bytes${item.duplicateOf ? ` · duplicate of ${item.duplicateOf}` : ''}`).join('\n')}\nExact byte duplicates will be omitted and documented in manifest.json. /suite zip confirm ${pending.token} ${pending.revision}; rename ${pending.token} ${pending.revision} ENTRY | basename. Expires in 10 minutes.`
    )
  }
  private async recipe(
    ctx: SuiteContext,
    parts: string[],
    split: string[]
  ): Promise<void> {
    const [action, name, id] = parts
    if (action === 'save') {
      const mission = this.studio.mission(ctx.owner, id!)
      if (
        mission.steps.some(step => step.routine) ||
        mission.input.video ||
        mission.steps.some(step => step.workflow?.record)
      )
        throw new UserError(
          'Recipes cannot retain video IDs, daily routine bindings or live record bindings. Save a fresh portable plan.'
        )
      const recipe = this.suite.saveRecipe(
        ctx.owner,
        name!,
        mission.input.prompt,
        mission.steps.map(step => ({
          kind: step.kind,
          title: step.title,
          prompt: step.prompt,
          connection: step.connection,
          ...(step.workflow ? { workflow: step.workflow } : {})
        }))
      )
      await ctx.text(
        `Saved recipe ${recipe.name} revision ${recipe.revision}; new runs require fresh material and cost approval.`
      )
    } else if (action === 'show' || action === 'export') {
      await ctx.file(
        Buffer.from(
          JSON.stringify(this.suite.recipe(ctx.owner, name!), null, 2)
        ),
        `recipe-${name}.json`
      )
    } else if (action === 'remove') {
      this.suite.removeRecipe(ctx.owner, name!)
      await ctx.text('Recipe removed.')
    } else if (action === 'run') {
      let variables: Record<string, string>
      try {
        variables = JSON.parse(split[1] ?? '{}') as Record<string, string>
        suiteStrings(variables, 2000)
      } catch {
        throw new UserError('Supply a JSON object of recipe variables after |.')
      }
      const recipe = this.suite.renderRecipe(ctx.owner, name!, variables),
        input = await ctx.input(recipe.goal)
      for (const step of recipe.steps) this.validatePortable(step)
      input.sources = this.suite.get(ctx.owner).selected
      input.instructions += `\nPersonal quality criteria:\n${this.suite.qualityText(ctx.owner, this.scope(ctx).project)}`
      await this.commands.show(
        ctx,
        this.studio.plan(
          ctx.owner,
          ctx.thread,
          'workflow',
          input,
          [],
          recipe.steps
        )
      )
    } else
      await ctx.text(
        `${this.suite
          .get(ctx.owner)
          .recipes.map(recipe => `${recipe.name} · revision ${recipe.revision}`)
          .join(
            '\n'
          )}\n/suite recipe save NAME MISSION_ID; show|export|remove NAME; run NAME | {"variable":"value"}\nUse {{variable}} in the mission goal or step prompt before saving. No source bytes or approvals are saved in recipes.`
      )
  }
  private validatePortable(step: RecipeStep): void {
    if (step.workflow) {
      const spec = step.workflow
      if (
        spec.record ||
        spec.id === 'video' ||
        !Object.hasOwn(suiteCatalog, spec.id) ||
        spec.fields.join() !== suiteCatalog[spec.id].fields.join()
      )
        throw new UserError(
          'Recipe contains a nonportable workflow binding. Create a fresh plan.'
        )
    }
  }
}
