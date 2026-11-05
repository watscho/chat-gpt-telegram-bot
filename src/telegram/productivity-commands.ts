import { randomUUID } from 'node:crypto'
import type { Document } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import type { ContextDraft, PreparedRequest } from '../domain/productivity.js'
import { Productivity } from '../application/productivity.js'
import { Library } from '../application/library.js'
import { Profiles } from '../application/profiles.js'
import { Workspaces } from '../application/workspaces.js'
import { Conversations } from '../application/conversations.js'

export type Keyboard = {
  inline_keyboard: { text: string; callback_data: string }[][]
}
export interface ProductivityContext {
  owner: string
  thread: string
  text(value: string, keyboard?: Keyboard): Promise<void>
  repliedDocument(): Promise<Document | undefined>
  prepare(prompt: string): PreparedRequest
}
export class ProductivityCommands {
  private readonly menus = new Map<
    string,
    { token: string; thread: string; expiresAt: number }
  >()
  constructor(
    readonly data: Productivity,
    readonly library: Library,
    private readonly profiles: Profiles,
    private readonly workspaces: Workspaces,
    private readonly conversations: Conversations,
    private readonly defaultModel: string,
    private readonly now = Date.now,
    private readonly imageEstimate: (
      prompt: string
    ) => number | undefined = () => undefined
  ) {}
  private revision(ctx: ProductivityContext): string | undefined {
    return this.conversations.history(`${ctx.owner}:${ctx.thread}`).at(-1)?.id
  }
  async review(
    ctx: ProductivityContext,
    request: PreparedRequest
  ): Promise<void> {
    const draft = this.data.stage(
      ctx.owner,
      ctx.thread,
      this.revision(ctx),
      request
    )
    const estimate = this.imageEstimate(request.prompt)
    if (estimate !== undefined) {
      this.data.setEstimate(ctx.owner, estimate)
      draft.estimate = estimate
    }
    await this.showDraft(ctx, draft, 0)
  }
  private async showDraft(
    ctx: ProductivityContext,
    draft: ContextDraft,
    page: number
  ): Promise<void> {
    if (
      !Number.isInteger(page) ||
      page < 0 ||
      page > Math.floor(draft.parts.length / 8)
    )
      throw new UserError('Invalid context page.')
    const start = page * 8
    const items = draft.parts.slice(start, start + 8)
    const button = (text: string, action: string) => ({
      text,
      callback_data: `context:${draft.token}:${action}`
    })
    await ctx.text(
      `${draft.structured ? `Output format: ${draft.structured.format}; fields: ${draft.structured.fields.join(', ')}.\n` : ''}Review before sending.${draft.estimate !== undefined ? ` Configured estimated cost: $${(draft.estimate / 1000000).toFixed(6)}; actual provider charges may differ.` : ''} Request: ${draft.prompt}\n${items.map(part => `${part.enabled ? '[x]' : '[ ]'} ${part.id}: ${part.label}`).join('\n')}\nUse /context show ID for full text or file metadata. History text and all deduplicated attachments are separate controls. Preview expires after 10 minutes.`,
      {
        inline_keyboard: [
          ...items.map(part => [
            button(
              `${part.enabled ? 'Exclude' : 'Include'} ${part.id}: ${part.label.slice(0, 35)}`,
              `toggle:${part.id}:${page}`
            )
          ]),
          [
            button('Previous', `page:${Math.max(0, page - 1)}`),
            button(
              'Next',
              `page:${Math.min(Math.floor(draft.parts.length / 8), page + 1)}`
            )
          ],
          [button('Send selected context', 'send'), button('Cancel', 'cancel')]
        ]
      }
    )
  }
  private async menu(
    ctx: ProductivityContext,
    section = 'home',
    page = 0
  ): Promise<void> {
    const token = randomUUID().slice(0, 12)
    this.menus.set(ctx.owner, {
      token,
      thread: ctx.thread,
      expiresAt: this.now() + 600000
    })
    const row = (text: string, action: string) => [
      { text, callback_data: `menu:${token}:${action}` }
    ]
    const settings = this.workspaces.thread(ctx.owner, ctx.thread)
    let rows: Keyboard['inline_keyboard']
    if (section === 'mode')
      rows = ['default', 'developer', 'editor', 'translator', 'custom'].map(
        value => row(value, `mode:${value}`)
      )
    else if (section === 'model')
      rows = [
        row('Operator default', 'model:default'),
        row('GPT-6.1 Sol', 'model:gpt-6.1-sol'),
        row('Custom model: /model ID', 'help:model')
      ]
    else if (section === 'voice')
      rows = ['off', 'on', 'auto'].map(value => row(value, `voice:${value}`))
    else if (section === 'limits')
      rows = [0, 1, 5, 10]
        .map(value => row(`Estimated budget: $${value}/day`, `budget:${value}`))
        .concat(
          ['image', 'search', 'voice'].flatMap(kind => [
            row(`Disable ${kind}`, `limit:${kind}:0`),
            row(`${kind}: 1/day`, `limit:${kind}:1`)
          ])
        )
    else if (section === 'project') {
      if (!Number.isInteger(page) || page < 0)
        throw new UserError('Invalid project page.')
      const projects = this.workspaces.get(ctx.owner).projects
      rows = [
        row('No project', 'project:none'),
        ...projects
          .slice(page * 8, page * 8 + 8)
          .map(project =>
            row(`${project.id}: ${project.title}`, `project:${project.id}`)
          ),
        row('Previous page', `open:project:${Math.max(0, page - 1)}`),
        row(
          'Next page',
          `open:project:${Math.min(Math.floor(projects.length / 8), page + 1)}`
        )
      ]
    } else
      rows = ['model', 'project', 'mode', 'voice', 'limits']
        .map(value => row(value, `open:${value}`))
        .concat([
          row(
            `Context review: ${settings.reviewContext ? 'on' : 'off'}`,
            `review:${settings.reviewContext ? 'off' : 'on'}`
          )
        ])
    if (section !== 'home') rows.push(row('Back to settings', 'open:home'))
    await ctx.text(
      `Settings · conversation ${ctx.thread}\nModel: ${settings.model ?? this.defaultModel}\nProject: ${settings.project ?? 'none'}\nMode: ${settings.mode}\nVoice: ${this.profiles.get(ctx.owner).voice}\nBudget: $${((this.workspaces.get(ctx.owner).budget ?? this.workspaces.operatorBudget()) / 1000000).toFixed(2)} in configured estimates\nCustom limits: image ${this.workspaces.get(ctx.owner).imageLimit ?? 'operator default'}, search ${this.workspaces.get(ctx.owner).searchLimit ?? 'operator default'}, voice ${this.workspaces.get(ctx.owner).voiceLimit ?? 'operator default'}\n${section === 'model' ? 'Custom model: /model ID; availability is not checked by a paid request.' : ''}`,
      { inline_keyboard: rows }
    )
  }
  async callback(
    ctx: ProductivityContext,
    value: string
  ): Promise<PreparedRequest | true | false> {
    const [scope, token, action, ...args] = value.split(':')
    if (scope === 'context') {
      const draft = this.data.draft(
        ctx.owner,
        ctx.thread,
        token!,
        this.revision(ctx)
      )
      if (action === 'send') {
        const estimate = this.imageEstimate(draft.prompt)
        if (estimate !== undefined && estimate !== draft.estimate)
          throw new UserError(
            'The estimated cost changed. Create a new preview before confirming.'
          )
        return this.data.consume(
          ctx.owner,
          ctx.thread,
          token!,
          this.revision(ctx)
        )
      }
      if (action === 'cancel') {
        this.data.discard(ctx.owner)
        await ctx.text('Context preview cancelled. No provider call was made.')
        return true
      }
      if (action === 'toggle')
        this.data.toggle(
          ctx.owner,
          ctx.thread,
          token!,
          this.revision(ctx),
          args[0]!
        )
      else if (action !== 'page') throw new UserError('Unknown context action.')
      await this.showDraft(
        ctx,
        this.data.draft(ctx.owner, ctx.thread, token!, this.revision(ctx)),
        Number(args[action === 'toggle' ? 1 : 0])
      )
      return true
    }
    if (scope !== 'menu') return false
    const menu = this.menus.get(ctx.owner)
    if (
      !menu ||
      menu.token !== token ||
      menu.thread !== ctx.thread ||
      menu.expiresAt <= this.now()
    )
      throw new UserError(
        'Settings menu expired or conversation changed. Use /settings.'
      )
    const argument = args[0]!
    if (action === 'open') {
      await this.menu(ctx, argument, Number(args[1] ?? 0))
      return true
    }
    if (action === 'mode')
      this.workspaces.configure(ctx.owner, ctx.thread, {
        mode: argument as 'default'
      })
    else if (action === 'model')
      this.workspaces.configure(ctx.owner, ctx.thread, {
        model: argument === 'default' ? null : argument
      })
    else if (action === 'project')
      this.workspaces.configure(ctx.owner, ctx.thread, {
        project: argument === 'none' ? null : argument
      })
    else if (action === 'voice') this.profiles.voice(ctx.owner, argument)
    else if (action === 'review')
      this.workspaces.configure(ctx.owner, ctx.thread, {
        reviewContext: argument === 'on'
      })
    else if (action === 'budget')
      this.workspaces.limits(ctx.owner, 'budget', Number(argument) * 1000000)
    else if (action === 'limit') {
      if (!['image', 'search', 'voice'].includes(argument))
        throw new UserError('Unknown limit.')
      this.workspaces.limits(
        ctx.owner,
        (
          {
            image: 'imageLimit',
            search: 'searchLimit',
            voice: 'voiceLimit'
          } as const
        )[argument as 'image'],
        Number(args[1])
      )
    } else if (action === 'help') {
      await ctx.text(
        'Use /model model-id or /model default. Your project must have access to the configured model.'
      )
      return true
    } else throw new UserError('Unknown settings action.')
    await this.menu(ctx)
    return true
  }
  async handle(
    ctx: ProductivityContext,
    text: string
  ): Promise<PreparedRequest | true | false> {
    const match = text.match(/^\/(\w+)(?:@\w+)?(?:\s+|$)/)
    if (!match) return false
    const command = match[1]!.toLowerCase(),
      arg = text.slice(match[0].length).trim()
    if (command === 'settings' || command === 'menu') {
      await this.menu(ctx)
      return true
    }
    if (command === 'model') {
      if (arg)
        this.workspaces.configure(ctx.owner, ctx.thread, {
          model: arg === 'default' ? null : arg
        })
      await ctx.text(
        `Chat model: ${this.workspaces.thread(ctx.owner, ctx.thread).model ?? this.defaultModel}. Use /model ID or /model default.`
      )
      return true
    }
    if (command === 'templates') {
      await ctx.text(
        this.data
          .get(ctx.owner)
          .templates.map(item => `${item.name}: ${item.body.slice(0, 100)}`)
          .join('\n') ||
          'No templates. Use /template save name | prompt with {{variable}}.'
      )
      return true
    }
    if (command === 'template') {
      const [action, name] = arg.split(/\s+/)
      if (action === 'save') {
        const split = arg.indexOf('|')
        if (split < 0 || !name || arg.slice(5, split).trim() !== name)
          throw new UserError(
            'Usage: /template save name | body with {{variable}}.'
          )
        this.data.template(ctx.owner, name, arg.slice(split + 1).trim())
      } else if (action === 'delete')
        this.data.removeTemplate(ctx.owner, name ?? '')
      else if (action === 'show') {
        const template = this.data
          .get(ctx.owner)
          .templates.find(item => item.name === name)
        if (!template) throw new UserError('Template not found.')
        await ctx.text(template.body)
        return true
      } else
        throw new UserError(
          'Usage: /template save name | body, /template show name, /template delete name.'
        )
      await ctx.text('Template updated.')
      return true
    }
    if (command === 'run') {
      const match = arg.match(/^(\S+)(?:\s+([\s\S]+))?$/)
      if (!match) throw new UserError('Usage: /run name {"variable":"value"}.')
      let values: unknown
      try {
        values = JSON.parse(match[2] ?? '{}')
      } catch {
        throw new UserError(
          'Template variables must be a JSON object of strings.'
        )
      }
      if (
        !values ||
        Array.isArray(values) ||
        typeof values !== 'object' ||
        Object.values(values).some(value => typeof value !== 'string')
      )
        throw new UserError(
          'Template variables must be a JSON object of strings.'
        )
      return ctx.prepare(
        this.data.render(ctx.owner, match[1]!, values as Record<string, string>)
      )
    }
    if (command === 'turns') {
      await ctx.text(
        this.conversations
          .history(`${ctx.owner}:${ctx.thread}`)
          .filter(item => item.role === 'user')
          .map((item, index) => `${index + 1}: ${item.content.slice(0, 100)}`)
          .join('\n') || 'No retained turns.'
      )
      return true
    }
    if (command === 'branch' || command === 'revise') {
      const split = arg.indexOf('|'),
        turn = Number(split < 0 ? arg : arg.slice(0, split).trim()),
        value = split < 0 ? '' : arg.slice(split + 1).trim()
      const source = `${ctx.owner}:${ctx.thread}`,
        history = this.conversations.history(source)
      if (
        !Number.isInteger(turn) ||
        turn < 1 ||
        turn > history.length / 2 ||
        (command === 'revise' && !value)
      )
        throw new UserError(
          'Use a retained turn from /turns: /branch N | title, or /revise N | replacement request.'
        )
      const request = history[(turn - 1) * 2]!
      const settings = this.workspaces.thread(ctx.owner, ctx.thread)
      const profile = this.profiles.create(
        ctx.owner,
        command === 'branch'
          ? value || `Branch at ${turn}`
          : `Revised turn ${turn}`
      )
      try {
        this.conversations.fork(
          source,
          `${ctx.owner}:${profile.active}`,
          command === 'branch' ? turn : turn - 1
        )
        this.workspaces.configure(ctx.owner, profile.active, settings)
      } catch (error) {
        this.profiles.switch(ctx.owner, ctx.thread)
        this.profiles.delete(ctx.owner, profile.active)
        this.conversations.reset(`${ctx.owner}:${profile.active}`)
        throw error
      }
      await ctx.text(
        `Branch ${profile.active} created and selected. Original conversation ${ctx.thread} is preserved.`
      )
      if (command === 'branch') return true
      const prepared = ctx.prepare(value)
      prepared.images = request.images ?? []
      prepared.documents = request.documents ?? []
      prepared.history = history.slice(0, (turn - 1) * 2)
      return prepared
    }
    if (command === 'collect') {
      if (arg === 'on' || arg === 'off') {
        this.data.collecting(ctx.owner, ctx.thread, arg === 'on')
        await ctx.text(
          `Forward collection ${arg}. Text/captions only; no automatic model calls.`
        )
        return true
      }
      if (arg === 'clear') {
        this.data.clearForwards(ctx.owner, ctx.thread)
        await ctx.text('Forward collection cleared.')
        return true
      }
      const entries = this.data.get(ctx.owner).forwards[ctx.thread] ?? []
      if (arg === 'show') {
        await ctx.text(
          entries
            .map((item, index) => `[F${index + 1}] ${item.text}`)
            .join('\n\n') || 'No collected forwards.'
        )
        return true
      }
      if (arg.startsWith('summarize')) {
        if (!entries.length)
          throw new UserError(
            'Forward some text messages after /collect on first.'
          )
        const prepared = ctx.prepare(
          `Summarize the forwarded excerpts, decisions and tasks. Cite [F#], distinguish quoted claims from facts, and flag uncertain attribution. ${arg.slice(9).trim()}`
        )
        prepared.references = entries
          .map((item, index) => `[F${index + 1}] ${item.text}`)
          .join('\n\n')
        prepared.analysisOnly = true
        return prepared
      }
      throw new UserError(
        'Usage: /collect on|off|show|clear|summarize [focus].'
      )
    }
    if (command === 'library' || command === 'ask') {
      const project = this.workspaces.thread(ctx.owner, ctx.thread).project
      if (!project)
        throw new UserError(
          'Select a project with /project use or /project new first.'
        )
      if (command === 'ask') {
        const hits = this.library.search(ctx.owner, project, arg)
        if (!hits.length)
          throw new UserError(
            'No matching library passages. Use /library find or index more references.'
          )
        const prepared = ctx.prepare(arg)
        prepared.references = this.library.references(hits)
        prepared.evidence = hits.map((hit, index) => ({
          label: `L${index + 1}`,
          title: `${hit.name} (${hit.location})`,
          text: hit.text
        }))
        prepared.analysisOnly = true
        return prepared
      }
      if (arg === 'add') {
        const file = await ctx.repliedDocument()
        if (!file)
          throw new UserError('Reply to a PDF/text document with /library add.')
        const indexed = await this.library.add(ctx.owner, project, file)
        await ctx.text(
          `Indexed ${indexed.id}: ${indexed.name} (${indexed.passages.length} passages). No model call was made.`
        )
      } else if (arg.startsWith('remove ')) {
        this.library.remove(ctx.owner, project, arg.slice(7).trim())
        await ctx.text('Library document removed.')
      } else if (arg.startsWith('find '))
        await ctx.text(
          this.library.references(
            this.library.search(ctx.owner, project, arg.slice(5))
          ) || 'No matching passages.'
        )
      else if (!arg || arg === 'list')
        await ctx.text(
          this.library
            .get(ctx.owner)
            .filter(item => item.project === project)
            .map(
              item =>
                `${item.id}: ${item.name} (${item.passages.length} passages)`
            )
            .join('\n') ||
            'No indexed documents. Reply to a PDF/text document with /library add.'
        )
      else
        throw new UserError(
          'Usage: /library add|list|find query|remove ID; /ask question.'
        )
      return true
    }
    if (command === 'context') {
      if (arg === 'on' || arg === 'off') {
        this.workspaces.configure(ctx.owner, ctx.thread, {
          reviewContext: arg === 'on'
        })
        await ctx.text(`Context review ${arg}.`)
        return true
      }
      if (arg.startsWith('show ')) {
        const draft = this.data.get(ctx.owner).draft
        if (
          !draft ||
          draft.thread !== ctx.thread ||
          draft.revision !== this.revision(ctx)
        )
          throw new UserError('No current context preview.')
        const part = draft.parts.find(item => item.id === arg.slice(5))
        if (!part) throw new UserError('Context item not found.')
        await ctx.text(
          typeof part.value === 'string'
            ? part.value
            : Array.isArray(part.value)
              ? part.value
                  .map(item => `${item.role}: ${item.content}`)
                  .join('\n\n')
              : 'name' in part.value
                ? `${part.value.name}: ${part.value.mime}; ${Buffer.byteLength(part.value.data, 'base64')} bytes`
                : `${part.value.mime}; ${Buffer.byteLength(part.value.data, 'base64')} bytes`
        )
        return true
      }
      if (!arg)
        throw new UserError(
          'Usage: /context request, /context on|off, /context show ID.'
        )
      await this.review(ctx, ctx.prepare(arg))
      return true
    }
    if (command === 'feedback') {
      await ctx.text(
        this.data
          .get(ctx.owner)
          .feedback.filter(item => item.thread === ctx.thread)
          .map(item => `${item.revision}: ${item.rating}, ${item.reason}`)
          .join('\n') ||
          'No feedback for this conversation. Use the answer rating buttons.'
      )
      return true
    }
    return false
  }
}
