import type { Config } from '../config.js'
import { UserError, type Document } from '../domain/conversation.js'
import type { JobInput } from '../domain/jobs.js'
import { Workflow } from '../application/workflow.js'
import { Jobs } from '../application/jobs.js'
import { Workspaces } from '../application/workspaces.js'
import { Conversations } from '../application/conversations.js'
import { localTime } from '../application/scheduling.js'
import type { ArchiveImport } from '../application/archive.js'
import type { Keyboard } from './productivity-commands.js'

export interface WorkflowContext {
  owner: string
  thread: string
  text(value: string, keyboard?: Keyboard): Promise<void>
  file(bytes: Uint8Array, name: string): Promise<void>
  document(): Promise<Document | undefined>
  quote(): string
  input(prompt: string): JobInput
  imported(): void
}
const sections: Record<string, string> = {
  delivery:
    'Delivery and language\n/quiet 22:00-08:00 and /digest 1h group background notifications. /notifications lists pending items; /digest now delivers them immediately. /language ui en|ru|es changes menus, while /language answer auto|code controls generated prose.',
  saved:
    'Saved answers and sources\nUse Save answer or Save source, then /bookmarks or /bookmarks #tag. /bookmark tags ID | tags organizes saved passages. /sources opens retained citation cards without fetching new pages.',
  outputs:
    'Structured files and queue\n/output json name,amount | request or /output csv name,amount | request creates validated rows and a file. /queue shows owned queued jobs; /priority ID 0..9 changes priority; /defer ID | date or now changes start time. /project_budget USD and /project_usage manage project estimates.',
  start:
    'Start here\nSend a text, voice, photo or document. /new Work creates a separate conversation. /settings opens preferences. Costs are API usage, separate from ChatGPT subscriptions.',
  tasks:
    'Tasks\n/task add Review draft | 2027-01-15 09:00\n/tasks or /tasks all\n/task done ID, /task open ID, /task due ID | date or none, /task delete ID\n/task fromreply uses a retained quoted bot passage. Deadlines use /timezone.',
  context:
    'Context\nReply to a retained bot answer to clarify that exact passage. /recap shows extractive excerpts retained from trimmed turns; /recap clear removes them. /context on lets you inspect/exclude history, recap, notes, files and instructions before sending.',
  documents:
    'Documents\nUpload references or attach them to a project. /batch summarize, /batch extract fields, /batch table instructions process 1..10 retained/project files independently after a cost preview. /batch status GROUP and /batch export GROUP inspect results. /library and /ask search indexed text/PDF passages.',
  projects:
    'Projects and prompts\n/project new Name; /project attach while replying to a file. /glossary set term | preferred spelling or translation; /glossary list; /glossary remove term. /templates and /template manage reusable prompts.',
  costs:
    'Costs and background work\n/usage, /budget, /limits show configured estimates and quotas. Images, jobs and batches show confirmations by default. Estimates are not invoices. Use /image or /edit explicitly for generation. /stop cancels foreground work; /cancel ID cancels a job. /jobs and /result ID inspect it.',
  data: 'Data and transfer\n/data downloads a private archive. Reply to it with /import to preview a merge; confirmation allocates new conversation/project IDs and skips conflicting templates. Jobs, schedules, quotas, callbacks and credentials are not restored. /erase explains local erasure. /retention controls history expiry.'
}
export class WorkflowCommands {
  constructor(
    private readonly data: Workflow,
    private readonly jobs: Jobs,
    private readonly ws: Workspaces,
    private readonly conversations: Conversations,
    private readonly config: Config,
    private readonly archive?: ArchiveImport
  ) {}
  private revision(ctx: WorkflowContext): string | undefined {
    return this.conversations.history(`${ctx.owner}:${ctx.thread}`).at(-1)?.id
  }
  async guide(ctx: WorkflowContext, section = 'start'): Promise<void> {
    await ctx.text(sections[section] ?? sections.start!, {
      inline_keyboard: Object.keys(sections).map(key => [
        {
          text: key[0]!.toUpperCase() + key.slice(1),
          callback_data: `guide:${key}`
        }
      ])
    })
  }
  async callback(ctx: WorkflowContext, value: string): Promise<boolean> {
    const [scope, token, action] = value.split(':')
    if (scope === 'guide') {
      await this.guide(ctx, token)
      return true
    }
    if (scope === 'tasks') {
      await this.handle(
        ctx,
        `/tasks ${token === 'all' ? 'all ' : ''}${action ?? '1'}`
      )
      return true
    }
    if (scope === 'task') {
      if (token !== 'done') throw new UserError('Unknown task control.')
      this.data.task(ctx.owner, action!, 'done')
      await ctx.text('Task completed.')
      return true
    }
    if (scope !== 'work') return false
    const approval = this.data.approval(
      ctx.owner,
      ctx.thread,
      token!,
      this.revision(ctx),
      true
    )
    if (action === 'cancel') {
      await ctx.text('Preview cancelled. No new paid work was started.')
      return true
    }
    if (action !== 'confirm')
      throw new UserError('Unknown work-preview action.')
    if (approval.kind === 'import') {
      if (!this.archive || typeof approval.input !== 'string')
        throw new UserError('Archive import requires durable storage.')
      this.archive.commit(ctx.owner, approval.input)
      ctx.imported()
      await ctx.text(
        'Archive merged. Existing data is preserved. Imported tasks have no deadlines. Use /chats, /projects and /templates to inspect.'
      )
      return true
    }
    if (typeof approval.input === 'string')
      throw new UserError('Invalid work preview.')
    if (approval.kind === 'batch') {
      const group = this.jobs.enqueueBatch(
        ctx.owner,
        ctx.thread,
        approval.action,
        approval.input
      )
      await ctx.text(
        `Batch ${group} queued. Use /batch status ${group}, /batch export ${group}, /jobs or /cancel ID.`
      )
    } else {
      const job = this.jobs.enqueue(
        ctx.owner,
        ctx.thread,
        approval.action as 'research',
        approval.input
      )
      await ctx.text(`Job ${job.id} queued. Use /jobs or /cancel ${job.id}.`)
    }
    return true
  }
  async handle(ctx: WorkflowContext, text: string): Promise<boolean> {
    const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+|$)/)
    if (!match) return false
    const command = match[1]!.toLowerCase(),
      arg = text.slice(match[0].length).trim()
    if (command === 'guide') {
      await this.guide(ctx, arg)
      return true
    }
    if (command === 'tasks') {
      const match = arg.match(/^(all)?(?:\s*(\d+))?$/)
      if (!match) throw new UserError('Usage: /tasks [all] [page].')
      const page = Number(match[2] ?? 1),
        all = match[1] === 'all'
      const tasks = this.data
        .get(ctx.owner)
        .tasks.filter(task => all || task.thread === ctx.thread)
      const pages = Math.max(1, Math.ceil(tasks.length / 8))
      if (!Number.isSafeInteger(page) || page < 1 || page > pages)
        throw new UserError(`Choose a task page from 1 to ${pages}.`)
      if (!tasks.length) {
        await ctx.text('No tasks. Use /task add title | optional future date.')
        return true
      }
      const selected = tasks.slice((page - 1) * 8, page * 8)
      const rows: Keyboard['inline_keyboard'] = selected
        .filter(task => task.status === 'open')
        .map(task => [
          {
            text: `Done: ${task.title.slice(0, 40)}`,
            callback_data: `task:done:${task.id}`
          }
        ])
      const scope = all ? 'all' : 'thread'
      if (page > 1)
        rows.push([
          {
            text: 'Previous tasks',
            callback_data: `tasks:${scope}:${page - 1}`
          }
        ])
      if (page < pages)
        rows.push([
          { text: 'Next tasks', callback_data: `tasks:${scope}:${page + 1}` }
        ])
      await ctx.text(
        `Tasks · page ${page}/${pages}\n${selected.map(task => `${task.id} · conversation ${task.thread} · ${task.status}\n${task.title}\nDue: ${task.dueAt === null ? 'none' : new Date(task.dueAt).toISOString()}\nDelivery: ${task.delivery ?? 'pending'}${task.attempts >= 3 && !task.reminded ? ' (delivery exhausted; set a new deadline to retry)' : ''}`).join('\n\n')}`,
        { inline_keyboard: rows }
      )
      return true
    }
    if (command === 'task') {
      const [action, id] = arg.split(/\s+/),
        split = arg.indexOf('|'),
        timezone = this.ws.get(ctx.owner).timezone
      if (action === 'add' || action === 'fromreply') {
        const title =
          action === 'fromreply'
            ? ctx.quote().split('\n').slice(1).join('\n').slice(0, 1000)
            : (split < 0 ? arg.slice(4) : arg.slice(4, split)).trim()
        const due =
          split < 0
            ? null
            : localTime(arg.slice(split + 1).trim(), timezone, Date.now())
        const task = this.data.addTask(ctx.owner, ctx.thread, title, due)
        await ctx.text(
          `Task ${task.id} created${due === null ? '' : `; due ${new Date(due).toISOString()}`}. Use /tasks.`,
          {
            inline_keyboard: [
              [{ text: 'Done', callback_data: `task:done:${task.id}` }]
            ]
          }
        )
      } else if (
        ['done', 'open', 'delete', 'due'].some(value => value === action)
      ) {
        if (action === 'due' && split < 0)
          throw new UserError('Usage: /task due ID | YYYY-MM-DD HH:MM or none.')
        const expression = split < 0 ? 'none' : arg.slice(split + 1).trim()
        this.data.task(
          ctx.owner,
          id ?? '',
          action as 'done',
          action === 'due' && expression !== 'none'
            ? localTime(expression, timezone, Date.now())
            : null
        )
        await ctx.text('Task updated.')
      } else
        throw new UserError(
          'Use /task add title | date, fromreply, done ID, open ID, due ID | date/none, or delete ID.'
        )
      return true
    }
    if (command === 'glossary') {
      const project = this.ws.thread(ctx.owner, ctx.thread).project
      if (!project)
        throw new UserError('Select a project before editing its glossary.')
      if (!arg || arg === 'list') {
        await ctx.text(
          this.data.terms(ctx.owner, project) ||
            'No project terms. Use /glossary set term | preferred meaning.'
        )
        return true
      }
      if (arg.startsWith('set ')) {
        const split = arg.indexOf('|')
        if (split < 0)
          throw new UserError(
            'Usage: /glossary set term | preferred spelling or translation.'
          )
        this.data.glossary(
          ctx.owner,
          project,
          arg.slice(4, split).trim(),
          arg.slice(split + 1).trim()
        )
      } else if (arg.startsWith('remove '))
        this.data.glossary(ctx.owner, project, arg.slice(7).trim())
      else
        throw new UserError(
          'Use /glossary list, set term | meaning, or remove term.'
        )
      await ctx.text(
        'Project glossary updated. Transcription hints do not guarantee recognition.'
      )
      return true
    }
    if (command === 'recap') {
      if (arg === 'clear') {
        this.conversations.clearRecap(`${ctx.owner}:${ctx.thread}`)
        await ctx.text(
          'Earlier-history recap cleared. Retained history is unchanged.'
        )
        return true
      }
      if (arg) throw new UserError('Usage: /recap or /recap clear.')
      await ctx.text(
        this.conversations.recap(`${ctx.owner}:${ctx.thread}`) ||
          'No trimmed-history recap. It is created locally when complete turns are removed by history limits.'
      )
      return true
    }
    if (
      command === 'batch' &&
      (arg.startsWith('status ') || arg.startsWith('export '))
    ) {
      const [action, group] = arg.split(/\s+/),
        jobs = this.jobs
          .get(ctx.owner)
          .jobs.filter(job => job.batch?.group === group)
      if (!jobs.length) throw new UserError('Batch not found. Use /jobs.')
      if (action === 'status')
        await ctx.text(
          jobs
            .map(
              job =>
                `${job.id}: ${job.batch!.file} — ${job.state}, delivery ${job.delivery}`
            )
            .join('\n')
        )
      else {
        const bytes = Buffer.from(
          JSON.stringify(
            jobs.map(job => ({
              file: job.batch!.file,
              state: job.state,
              error: job.error,
              result: job.result
            })),
            null,
            2
          )
        )
        if (bytes.length > this.config.maxExportBytes)
          throw new UserError(
            'Batch export exceeds the configured limit. Use /result ID separately.'
          )
        await ctx.file(bytes, `batch-${group}.json`)
      }
      return true
    }
    let kind: 'job' | 'batch' | 'import',
      input: JobInput | string,
      action: string,
      estimate = 0,
      description: string
    if (command === 'import') {
      if (!this.archive)
        throw new UserError('Archive import requires durable storage.')
      const file = await ctx.document()
      if (!file || !file.name.toLowerCase().endsWith('.json'))
        throw new UserError('Reply to a /data JSON archive with /import.')
      input = new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.from(file.data, 'base64')
      )
      kind = 'import'
      action = 'merge'
      description = this.archive.preview(ctx.owner, input)
    } else if (command === 'batch') {
      const split = arg.indexOf(' ')
      action = split < 0 ? arg : arg.slice(0, split)
      if (!['summarize', 'extract', 'table'].includes(action))
        throw new UserError(
          'Usage: /batch summarize, /batch extract fields, /batch table instructions, status GROUP or export GROUP.'
        )
      input = ctx.input(split < 0 ? '' : arg.slice(split + 1).trim())
      kind = 'batch'
      if (
        !input.documents.length ||
        input.documents.length > 10 ||
        input.prompt.length > 1000
      )
        throw new UserError(
          'Batch needs 1..10 retained/project documents and at most 1000 instruction characters.'
        )
      estimate = this.config.estimateChat * input.documents.length
      description = `${action}: ${input.documents.map(file => file.name).join(', ')}\nOne independent paid operation per file, processed sequentially. Shared notes/instructions apply; unrelated history is excluded.`
    } else if (
      command === 'job' &&
      this.config.confirmExpensiveRequests &&
      !arg.startsWith('delete ')
    ) {
      const match = arg.match(/^(research|compare|summary)\s+([\s\S]+)$/)
      action = match?.[1] ?? 'research'
      input = ctx.input(match?.[2] ?? arg)
      kind = 'job'
      if (
        !input.prompt.trim() ||
        input.prompt.length > this.config.maxInputCharacters ||
        (action === 'compare' && input.documents.length < 2)
      )
        throw new UserError(
          'Supply valid job instructions; comparison requires two reference files.'
        )
      estimate =
        this.config.estimateChat +
        (action === 'research'
          ? this.config.estimateSearch * this.config.maxWebSearchCalls
          : 0)
      description = `${action} job in conversation ${ctx.thread}; ${input.documents.length} reference files.`
    } else return false
    const approval = this.data.stage(ctx.owner, {
      thread: ctx.thread,
      revision: this.revision(ctx),
      kind,
      input,
      action,
      estimate
    })
    await ctx.text(
      `${description}\nConfigured estimated cost: $${(estimate / 1000000).toFixed(6)}. This is not provider billing; actual charges may differ. Normal quotas are checked at execution. Preview expires in 10 minutes.`,
      {
        inline_keyboard: [
          [
            {
              text: kind === 'import' ? 'Confirm merge' : 'Confirm work',
              callback_data: `work:${approval.token}:confirm`
            },
            { text: 'Cancel', callback_data: `work:${approval.token}:cancel` }
          ]
        ]
      }
    )
    return true
  }
}
