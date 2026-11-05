import { referenceId } from '../application/evidence.js'
import { UserError } from '../domain/conversation.js'
import type { PreparedRequest } from '../domain/productivity.js'
import type { Keyboard } from './productivity-commands.js'
import { Experience } from '../application/experience.js'
import { Jobs } from '../application/jobs.js'
import { Workflow } from '../application/workflow.js'
import { Workspaces } from '../application/workspaces.js'
import { UsageLedger } from '../application/usage.js'
import { Conversations } from '../application/conversations.js'
import { structuredSpec } from '../application/structured.js'
import { localTime } from '../application/scheduling.js'

export interface ExperienceContext {
  owner: string
  thread: string
  text(value: string, keyboard?: Keyboard, raw?: boolean): Promise<void>
  quote(): string
  prepare(prompt: string): PreparedRequest
  flush(): Promise<number>
}
export class ExperienceCommands {
  constructor(
    private readonly data: Experience,
    private readonly jobs: Jobs,
    private readonly workflow: Workflow,
    private readonly ws: Workspaces,
    private readonly usage: UsageLedger,
    private readonly conversations: Conversations
  ) {}
  private answer(ctx: ExperienceContext, revision: string) {
    const answer = this.conversations
      .history(`${ctx.owner}:${ctx.thread}`)
      .find(
        item =>
          item.role === 'assistant' &&
          item.id &&
          (item.id === revision || referenceId(item.id) === revision)
      )
    if (!answer)
      throw new UserError(
        'That answer is no longer retained in the selected conversation.'
      )
    return answer
  }
  async callback(ctx: ExperienceContext, value: string): Promise<boolean> {
    const [scope, action, revision, index] = value.split(':')
    if (scope === 'card') {
      const answer = this.answer(ctx, action!),
        card = answer.evidence?.[Number(revision)]
      if (!card) throw new UserError('Source card not found.')
      await ctx.text(
        `[${card.label}] ${card.title}\n${card.text}${card.url ? `\n${card.url}` : ''}`,
        {
          inline_keyboard: [
            [
              {
                text: 'Save source',
                callback_data: `bookmark:source:${action}:${revision}`
              }
            ]
          ]
        },
        true
      )
      return true
    }
    if (scope === 'bookmark') {
      const answer = this.answer(ctx, revision!)
      let title: string, text: string
      if (action === 'answer') {
        title = answer.content.slice(0, 80) || 'Saved answer'
        text = answer.content.slice(0, 4000)
      } else if (action === 'source') {
        const card = answer.evidence?.[Number(index)]
        if (!card) throw new UserError('Source card not found.')
        title = card.title.slice(0, 80)
        text = `[${card.label}] ${card.title}\n${card.text}${card.url ? `\n${card.url}` : ''}`
      } else throw new UserError('Unknown bookmark control.')
      const saved = this.data.bookmark(ctx.owner, title, text)
      await ctx.text(
        `Bookmark ${saved.id} saved. Use /bookmarks or /bookmark tags ID | tags.`
      )
      return true
    }
    if (scope === 'notice' && action === 'result') {
      await this.jobs.result(ctx.owner, revision!)
      return true
    }
    return false
  }
  async handle(
    ctx: ExperienceContext,
    text: string
  ): Promise<PreparedRequest | boolean> {
    const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+|$)/)
    if (!match) return false
    const command = match[1]!.toLowerCase(),
      arg = text.slice(match[0].length).trim()
    if (command === 'quiet') {
      if (arg) this.data.quiet(ctx.owner, arg)
      const state = this.data.get(ctx.owner)
      const time = (value: number) =>
        `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
      await ctx.text(
        `Quiet hours: ${state.quiet ? `${time(state.quiet.start)}-${time(state.quiet.end)}` : 'off'}\nTimezone: ${this.ws.get(ctx.owner).timezone}. Due tasks remain visible. Use /quiet HH:MM-HH:MM or off.`
      )
      return true
    }
    if (command === 'digest') {
      if (arg === 'now') {
        const count = await ctx.flush()
        await ctx.text(
          `Processed notification items: ${count}. No model call was made.`
        )
        return true
      }
      if (arg) {
        const match = arg.match(/^(\d+)(m|h)$/)
        if (arg !== 'off' && !match)
          throw new UserError('Usage: /digest off|5m|1h or /digest now.')
        this.data.digest(
          ctx.owner,
          arg === 'off' ? 0 : Number(match![1]) * (match![2] === 'h' ? 60 : 1)
        )
      }
      await ctx.text(
        `Digest interval: ${this.data.get(ctx.owner).digestMinutes} minutes (0 = immediate). Use /digest off|5m|1h or now.`
      )
      return true
    }
    if (command === 'notifications') {
      const [action, id] = arg.split(/\s+/)
      if (action === 'drop') {
        const item = this.data
          .get(ctx.owner)
          .notices.find(item => item.id === id)
        if (!item) throw new UserError('Notification not found.')
        this.data.removeNotice(ctx.owner, id!)
        if (item.kind === 'job')
          this.jobs.delivered(ctx.owner, item.target, 'suppressed')
        else this.workflow.delivered(ctx.owner, item.target, 'suppressed')
        await ctx.text(
          'Notification suppressed. Retained results/tasks remain available.'
        )
        return true
      }
      if (action === 'retry') {
        this.data.retryNotice(ctx.owner, id ?? '')
        await ctx.text(
          'Notification delivery rearmed. Paid work will not rerun.'
        )
        return true
      }
      if (arg)
        throw new UserError(
          'Usage: /notifications, /notifications drop ID or retry ID.'
        )
      await ctx.text(
        this.data
          .get(ctx.owner)
          .notices.map(
            item =>
              `${item.id}: ${item.title}, delivery attempts ${item.attempts}/3`
          )
          .join('\n') || 'No pending notifications.'
      )
      return true
    }
    if (command === 'bookmarks') {
      const parts = arg.split('|'),
        query = parts[0]!.trim(),
        page = Number(parts[1]?.trim() || 1),
        items = this.data.find(ctx.owner, query),
        pages = Math.max(1, Math.ceil(items.length / 8))
      if (!Number.isSafeInteger(page) || page < 1 || page > pages)
        throw new UserError(`Choose a bookmark page from 1 to ${pages}.`)
      await ctx.text(
        items
          .slice((page - 1) * 8, page * 8)
          .map(
            item =>
              `${item.id}: ${item.title}\nTags: ${item.tags.join(', ') || '(none)'}`
          )
          .join('\n\n') ||
          'No bookmarks. Save an answer/source or use /bookmark add title | text | tags.',
        undefined,
        true
      )
      return true
    }
    if (command === 'bookmark') {
      const [action, id] = arg.split(/\s+/),
        parts = arg.split('|').map(part => part.trim())
      if (action === 'add' || action === 'reply') {
        const title =
            action === 'reply' ? 'Saved passage' : parts[0]!.slice(4).trim(),
          body =
            action === 'reply'
              ? ctx.quote().split('\n').slice(1).join('\n')
              : (parts[1] ?? ''),
          tags = (parts[action === 'reply' ? 1 : 2] ?? '')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
        const saved = this.data.bookmark(ctx.owner, title, body, tags)
        await ctx.text(
          `Bookmark ${saved.id} saved. Use /bookmarks or /bookmark tags ID | tags.`
        )
      } else if (action === 'show') {
        const item = this.data
          .get(ctx.owner)
          .bookmarks.find(item => item.id === id)
        if (!item) throw new UserError('Bookmark not found.')
        await ctx.text(
          `${item.title}\n${item.text}\nTags: ${item.tags.join(', ')}`,
          undefined,
          true
        )
      } else if (action === 'tags') {
        this.data.editBookmark(
          ctx.owner,
          id ?? '',
          (parts[1] ?? '')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
        )
        await ctx.text('Bookmark tags updated.')
      } else if (action === 'delete') {
        this.data.editBookmark(ctx.owner, id ?? '', null)
        await ctx.text('Bookmark removed.')
      } else
        throw new UserError(
          'Usage: /bookmark add title | text | tags, reply | tags, show ID, tags ID | tags, or delete ID.'
        )
      return true
    }
    if (command === 'sources') {
      const answer = this.conversations
        .history(`${ctx.owner}:${ctx.thread}`)
        .findLast(item => item.role === 'assistant')
      if (!answer?.id || !answer.evidence?.length)
        throw new UserError('No source cards remain for the latest answer.')
      await ctx.text('Open a source card:', {
        inline_keyboard: answer.evidence.map((card, index) => [
          {
            text: `[${card.label}] ${card.title.slice(0, 50)}`,
            callback_data: `card:${referenceId(answer.id!)}:${index}`
          }
        ])
      })
      return true
    }
    if (command === 'project_budget' || command === 'project_usage') {
      const project = this.ws.thread(ctx.owner, ctx.thread).project
      if (!project) throw new UserError('Select a project first.')
      if (command === 'project_budget' && arg) {
        if (!/^\d+(?:\.\d{1,6})?$/.test(arg))
          throw new UserError('Use a USD amount with up to six decimal places.')
        this.ws.projectBudget(
          ctx.owner,
          project,
          Math.round(Number(arg) * 1000000)
        )
      }
      await ctx.text(this.usage.projectReport(ctx.owner, project))
      return true
    }
    if (command === 'queue') {
      await ctx.text(
        this.jobs
          .queue(ctx.owner)
          .map(
            job =>
              `${job.position}. ${job.id}, conversation ${job.thread}, priority ${job.priority}, start ${job.notBefore ? new Date(job.notBefore).toISOString() : 'now'}`
          )
          .join('\n') || 'No queued jobs.'
      )
      return true
    }
    if (command === 'priority') {
      const [id, value, extra] = arg.split(/\s+/)
      if (!id || value === undefined || extra)
        throw new UserError('Usage: /priority job-id 0..9.')
      this.jobs.prioritize(ctx.owner, id, Number(value))
      await ctx.text('Queue priority updated. Running work is unchanged.')
      return true
    }
    if (command === 'defer') {
      const split = arg.indexOf('|')
      if (split < 0)
        throw new UserError('Usage: /defer job-id | YYYY-MM-DD HH:MM or now.')
      const expression = arg.slice(split + 1).trim()
      this.jobs.defer(
        ctx.owner,
        arg.slice(0, split).trim(),
        expression === 'now'
          ? 0
          : localTime(expression, this.ws.get(ctx.owner).timezone, Date.now())
      )
      await ctx.text(
        'Queued start time updated. Paid work will not retry automatically.'
      )
      return true
    }
    if (command === 'language') {
      const [kind, value, extra] = arg.split(/\s+/)
      if (extra)
        throw new UserError(
          'Usage: /language ui en|ru|es or /language answer auto|language-code.'
        )
      if (kind === 'ui' && value) this.data.language(ctx.owner, value)
      else if (kind === 'answer' && value)
        this.ws.configure(ctx.owner, ctx.thread, { answerLanguage: value })
      else if (arg)
        throw new UserError(
          'Usage: /language ui en|ru|es or /language answer auto|language-code.'
        )
      await ctx.text(
        `UI language: ${this.data.get(ctx.owner).language}\nAnswer language: ${this.ws.thread(ctx.owner, ctx.thread).answerLanguage ?? 'auto'}. UI applies to navigation/control messages; generated content follows the answer preference.`
      )
      return true
    }
    if (command === 'output') {
      const split = arg.indexOf('|'),
        head = (split < 0 ? arg : arg.slice(0, split)).trim(),
        space = head.indexOf(' ')
      if (split < 0 || space < 0 || !arg.slice(split + 1).trim())
        throw new UserError('Usage: /output json|csv field1,field2 | request.')
      const spec = structuredSpec(
          head.slice(0, space),
          head
            .slice(space + 1)
            .split(',')
            .map(item => item.trim())
        ),
        prepared = ctx.prepare(arg.slice(split + 1).trim())
      prepared.structured = spec
      prepared.analysisOnly = true
      return prepared
    }
    return false
  }
}
