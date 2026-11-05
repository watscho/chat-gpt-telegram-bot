import type { Document, Image } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import type { JobInput } from '../domain/jobs.js'
import type { Mode } from '../domain/workspace.js'
import type { StateStore } from '../domain/state.js'
import { Profiles } from '../application/profiles.js'
import { Conversations } from '../application/conversations.js'
import { Workspaces } from '../application/workspaces.js'
import { UsageLedger } from '../application/usage.js'
import { ResponseControls } from '../application/response-controls.js'
import { Jobs } from '../application/jobs.js'
import type { HistoryExport } from '../infrastructure/history-export.js'

export interface CommandContext {
  owner: string
  thread: string
  text(value: string): Promise<void>
  file(bytes: Uint8Array, name: string): Promise<void>
  repliedDocument(): Promise<Document | undefined>
  input(prompt: string): JobInput
}
export interface PromptOverride {
  prompt: string
  images: Image[]
  documents: Document[]
  analysisOnly: boolean
}
export class ProCommands {
  constructor(
    private readonly profiles: Profiles,
    private readonly conversations: Conversations,
    private readonly workspaces: Workspaces,
    private readonly usage: UsageLedger,
    private readonly controls: ResponseControls,
    private readonly jobs: Jobs,
    private readonly exports: Pick<HistoryExport, 'markdown' | 'json' | 'pdf'>,
    private readonly store?: StateStore
  ) {}
  async handle(
    ctx: CommandContext,
    text: string
  ): Promise<boolean | PromptOverride> {
    const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+|$)/)
    if (!match) return false
    const command = match[1]!.toLowerCase()
    const argument = text.slice(match[0].length).trim()
    const session = `${ctx.owner}:${ctx.thread}`
    switch (command) {
      case 'usage':
        await ctx.text(this.usage.report(ctx.owner))
        break
      case 'budget': {
        if (!argument) {
          await ctx.text(
            `Daily estimated-spend limit: $${((this.workspaces.get(ctx.owner).budget ?? this.workspaces.operatorBudget()) / 1000000).toFixed(6)}. Set with /budget amount.`
          )
          break
        }
        if (!/^\d+(?:\.\d{1,6})?$/.test(argument))
          throw new UserError(
            'Usage: /budget USD_amount, with at most six decimal places.'
          )
        this.workspaces.limits(
          ctx.owner,
          'budget',
          Math.round(Number(argument) * 1000000)
        )
        await ctx.text('Daily estimated-spend limit updated.')
        break
      }
      case 'limits': {
        if (!argument) {
          await ctx.text(
            'Usage: /limits image|search|voice count. Limits may be lowered up to the operator maximum. /usage shows consumed allowance.'
          )
          break
        }
        const [kind, count, extra] = argument.split(/\s+/)
        if (
          !['image', 'search', 'voice'].includes(kind!) ||
          !/^\d+$/.test(count ?? '') ||
          extra
        )
          throw new UserError('Usage: /limits image|search|voice count.')
        this.workspaces.limits(
          ctx.owner,
          (
            {
              image: 'imageLimit',
              search: 'searchLimit',
              voice: 'voiceLimit'
            } as const
          )[kind as 'image' | 'search' | 'voice'],
          Number(count)
        )
        await ctx.text('Daily feature limit updated.')
        break
      }
      case 'timezone':
        if (argument) this.workspaces.timezone(ctx.owner, argument)
        await ctx.text(`Timezone: ${this.workspaces.get(ctx.owner).timezone}`)
        break
      case 'mode':
        if (argument)
          this.workspaces.configure(ctx.owner, ctx.thread, {
            mode: argument as Mode
          })
        await ctx.text(
          `Mode: ${this.workspaces.thread(ctx.owner, ctx.thread).mode}. Choices: default, developer, editor, translator, custom.`
        )
        break
      case 'instructions':
        if (argument)
          this.workspaces.configure(ctx.owner, ctx.thread, {
            instructions: argument === 'clear' ? '' : argument
          })
        await ctx.text(
          this.workspaces.thread(ctx.owner, ctx.thread).instructions ||
            'No custom instructions. Use /instructions text or /instructions clear.'
        )
        break
      case 'quality':
        if (argument)
          this.workspaces.configure(ctx.owner, ctx.thread, {
            quality: argument as 'high'
          })
        await ctx.text(
          `Image quality: ${this.workspaces.thread(ctx.owner, ctx.thread).quality}. Choices: low, medium, high, auto.`
        )
        break
      case 'size':
        if (argument)
          this.workspaces.configure(ctx.owner, ctx.thread, {
            size: argument as 'auto'
          })
        await ctx.text(
          `Image size: ${this.workspaces.thread(ctx.owner, ctx.thread).size}. Choices: auto, 1024x1024, 1536x1024, 1024x1536.`
        )
        break
      case 'retention': {
        if (argument) {
          const seconds = argument === 'default' ? null : Number(argument)
          this.workspaces.configure(ctx.owner, ctx.thread, {
            retentionSeconds: seconds
          })
          if (seconds !== null) this.conversations.retention(session, seconds)
        }
        await ctx.text(
          `History retention: ${this.workspaces.thread(ctx.owner, ctx.thread).retentionSeconds ?? 'operator default'} seconds. Use /retention 60..86400 or /retention default.`
        )
        break
      }
      case 'projects': {
        const projects = this.workspaces.get(ctx.owner).projects
        await ctx.text(
          projects
            .map(
              project =>
                `${project.id}: ${project.title} (${project.documents.length} files)`
            )
            .join('\n') || 'No projects. Use /project new name.'
        )
        break
      }
      case 'project':
        await this.project(ctx, argument)
        break
      case 'find': {
        const found = this.conversations.search(ctx.owner, argument)
        await ctx.text(
          found
            .map(item => `Conversation ${item.conversation}: ${item.snippet}`)
            .join('\n\n') || 'No retained history matches.'
        )
        break
      }
      case 'export': {
        const messages = this.conversations.history(session)
        if (!messages.length)
          throw new UserError(
            'This conversation has no retained history to export.'
          )
        const format = argument || 'markdown'
        const title = this.profiles
          .get(ctx.owner)
          .threads.find(thread => thread.id === ctx.thread)!.title
        if (format === 'markdown')
          await ctx.file(
            this.exports.markdown(title, messages),
            `conversation-${ctx.thread}.md`
          )
        else if (format === 'pdf')
          await ctx.file(
            await this.exports.pdf(title, messages),
            `conversation-${ctx.thread}.pdf`
          )
        else if (format === 'json')
          await ctx.file(
            this.exports.json({ title, messages }),
            `conversation-${ctx.thread}.json`
          )
        else throw new UserError('Usage: /export markdown|pdf|json.')
        break
      }
      case 'data':
        await ctx.file(
          this.exports.json({
            profile: this.profiles.get(ctx.owner),
            workspace: this.workspaces.get(ctx.owner),
            histories: this.conversations.owned(ctx.owner),
            queue: this.jobs.get(ctx.owner),
            usage: this.usage.get(ctx.owner)
          }),
          'my-data.json'
        )
        break
      case 'erase':
        if (argument !== 'confirm') {
          await ctx.text(
            'Use /erase confirm to delete all local conversation content, attachments, projects, saved notes, settings, jobs and schedules. Minimal daily quota counters remain until the UTC day changes. Provider copies and backups are separate.'
          )
          break
        }
        this.controls.clear(ctx.owner, false)
        this.jobs.erase(ctx.owner)
        this.conversations.forgetOwner(ctx.owner)
        this.store?.deleteOwner(ctx.owner)
        this.profiles.forgetOwner(ctx.owner)
        this.workspaces.forget(ctx.owner)
        await ctx.text(
          'Local content, projects, notes, settings, jobs and schedules deleted. Current-day quota counters are retained.'
        )
        break
      case 'compare': {
        const input = ctx.input(argument)
        if (input.documents.length < 2)
          throw new UserError(
            'Comparison needs at least two reference documents. Upload them first or select a project with two files.'
          )
        return {
          prompt: `Compare these document versions. Provide a summary, then a change table with location, before, after, impact and evidence. Cite page/section references when available; explicitly mark missing or uncertain evidence. User question: ${argument || 'Identify substantive changes.'}`,
          documents: input.documents,
          images: input.images,
          analysisOnly: true
        }
      }
      case 'versions': {
        const versions = this.conversations.versions(session)
        await ctx.text(
          versions
            .map((version, index) => `${index + 1}. ${version.id}`)
            .join('\n') || 'No generated images remain in this conversation.'
        )
        break
      }
      case 'revert': {
        const versions = this.conversations.versions(session)
        if (!versions.some(version => version.id === argument))
          throw new UserError(
            'Image version is not retained in this conversation. Use /versions.'
          )
        this.workspaces.configure(ctx.owner, ctx.thread, {
          imageVersion: argument
        })
        await ctx.text('Image source selected for the next edit.')
        break
      }
      case 'job': {
        if (argument.startsWith('delete ')) {
          this.jobs.remove(ctx.owner, argument.slice(7).trim())
          await ctx.text('Job record removed.')
          break
        }
        const match = argument.match(/^(research|compare|summary)\s+([\s\S]+)$/)
        const kind = match
          ? (match[1] as 'research' | 'compare' | 'summary')
          : 'research'
        const prompt = match ? match[2]! : argument
        if (!prompt)
          throw new UserError(
            'Usage: /job [research|compare|summary] instructions, or /job delete id.'
          )
        const input = ctx.input(prompt)
        if (kind === 'compare' && input.documents.length < 2)
          throw new UserError(
            'Comparison needs at least two reference documents.'
          )
        const job = this.jobs.enqueue(ctx.owner, ctx.thread, kind, input)
        await ctx.text(
          `Job ${job.id} queued for conversation ${ctx.thread}. Use /jobs, /cancel id or /result id.`
        )
        break
      }
      case 'jobs':
        await ctx.text(
          this.jobs
            .get(ctx.owner)
            .jobs.map(
              job =>
                `${job.id}: ${job.kind}, ${job.state}, delivery ${job.delivery}${job.error ? ` — ${job.error}` : ''}`
            )
            .join('\n') || 'No jobs.'
        )
        break
      case 'cancel':
        this.jobs.cancel(ctx.owner, argument)
        await ctx.text(
          'Job cancelled. Any paid attempt already started may still be billed.'
        )
        break
      case 'result':
        await this.jobs.result(ctx.owner, argument)
        break
      case 'remind':
      case 'summary': {
        const separator = argument.indexOf('|')
        if (separator < 0)
          throw new UserError(
            `Usage: /${command} YYYY-MM-DD HH:MM | text, or /${command} every 2h | text.`
          )
        const schedule = this.jobs.schedule(
          ctx.owner,
          ctx.thread,
          command === 'remind' ? 'reminder' : 'summary',
          argument.slice(0, separator).trim(),
          argument.slice(separator + 1).trim(),
          this.workspaces.get(ctx.owner).timezone
        )
        await ctx.text(
          `Schedule ${schedule.id} saved. Next occurrence: ${new Date(schedule.dueAt).toISOString()} (${schedule.timezone}). Use /schedules or /unschedule id.`
        )
        break
      }
      case 'schedules':
        await ctx.text(
          this.jobs
            .get(ctx.owner)
            .schedules.map(
              schedule =>
                `${schedule.id}: ${schedule.kind}, ${new Date(schedule.dueAt).toISOString()}, timezone ${schedule.timezone}${schedule.intervalMs ? `, every ${schedule.intervalMs / 60000} minutes` : ''}`
            )
            .join('\n') || 'No schedules.'
        )
        break
      case 'unschedule':
        this.jobs.unschedule(ctx.owner, argument)
        await ctx.text(
          'Schedule removed. Already queued occurrences remain visible in /jobs and can be cancelled separately.'
        )
        break
      default:
        return false
    }
    return true
  }
  private async project(ctx: CommandContext, argument: string): Promise<void> {
    const [action, ...parts] = argument.split(/\s+/)
    const value = parts.join(' ')
    if (action === 'new') {
      const project = this.workspaces.create(ctx.owner, value)
      this.workspaces.configure(ctx.owner, ctx.thread, { project: project.id })
      await ctx.text(`Project ${project.id} created and selected.`)
      return
    }
    if (action === 'use') {
      this.workspaces.configure(ctx.owner, ctx.thread, {
        project: value === 'none' ? null : value
      })
      await ctx.text('Project selection updated.')
      return
    }
    if (action === 'delete') {
      this.workspaces.deleteProject(ctx.owner, value)
      await ctx.text('Project removed; conversation histories remain.')
      return
    }
    const project = this.workspaces.project(ctx.owner, ctx.thread)
    if (!project)
      throw new UserError(
        'Select a project with /project new name or /project use id.'
      )
    if (!action || action === 'info') {
      await ctx.text(
        `${project.id}: ${project.title}\nInstructions: ${project.instructions || '(none)'}\nFiles: ${project.documents.map(file => file.name).join(', ') || '(none)'}\nNotes:\n${project.notes.map((note, i) => `${i + 1}. ${note}`).join('\n') || '(none)'}`
      )
      return
    }
    if (action === 'attach') {
      const file = await ctx.repliedDocument()
      if (!file)
        throw new UserError('Reply to a document with /project attach.')
      this.workspaces.updateProject(ctx.owner, project.id, 'attach', file)
    } else if (
      ['instructions', 'remember', 'forget', 'remove'].includes(action)
    )
      this.workspaces.updateProject(
        ctx.owner,
        project.id,
        action as 'instructions',
        value === 'clear' && action === 'instructions' ? '' : value
      )
    else
      throw new UserError(
        'Project actions: new, use, delete, info, attach, remove, instructions, remember, forget.'
      )
    await ctx.text('Project updated.')
  }
}
