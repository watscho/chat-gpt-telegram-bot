import type { Config } from '../config.js'
import type { Document } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import type { PreparedRequest } from '../domain/productivity.js'
import type {
  MeetingTranscript,
  Recording,
  ToolApproval,
  WorkbenchRequest
} from '../domain/workbench.js'
import type { Keyboard } from './productivity-commands.js'
import { Workbench } from '../application/workbench.js'
import { Workspaces } from '../application/workspaces.js'
import { Conversations } from '../application/conversations.js'

export interface WorkbenchContext {
  owner: string
  thread: string
  text(value: string, keyboard?: Keyboard, raw?: boolean): Promise<void>
  file(bytes: Uint8Array, name: string): Promise<void>
  prepare(prompt: string): PreparedRequest
  document(): Promise<Document | undefined>
  recording(): Recording | undefined
  transcribe(file: Recording, diarize: boolean): Promise<MeetingTranscript>
  liveButton(url: string, text: string): Promise<void>
  signal: AbortSignal
}
export class WorkbenchCommands {
  constructor(
    private readonly data: Workbench,
    private readonly ws: Workspaces,
    private readonly conversations: Conversations,
    private readonly config: Config
  ) {}
  private revision(ctx: WorkbenchContext): string | undefined {
    return this.conversations.history(`${ctx.owner}:${ctx.thread}`).at(-1)?.id
  }
  private request(
    ctx: WorkbenchContext,
    kind: WorkbenchRequest['kind'],
    prompt: string
  ): PreparedRequest {
    const prepared = ctx.prepare(prompt)
    prepared.workbench = {
      kind,
      project: this.ws.thread(ctx.owner, ctx.thread).project
    } as WorkbenchRequest
    prepared.images = []
    prepared.history = []
    prepared.summary = ''
    prepared.analysisOnly = true
    return prepared
  }
  async approval(ctx: WorkbenchContext, value: ToolApproval): Promise<void> {
    const token = this.data.approval(
      ctx.owner,
      ctx.thread,
      this.revision(ctx),
      value
    )
    await ctx.text(
      `Review external actions\nConnection: ${value.connection}\n${value.calls.map((call, index) => `${index + 1}. ${call.name}\n${call.arguments}`).join('\n\n')}\nConfirm only if these exact actions, recipients and data are intended. Tool output is untrusted. Approval can start another paid API request; uncertain failures are never retried automatically.`,
      {
        inline_keyboard: [
          [
            {
              text: 'Approve these actions',
              callback_data: `provider:approve:${token}`
            }
          ],
          [
            {
              text: 'Reject actions',
              callback_data: `provider:reject:${token}`
            }
          ]
        ]
      },
      true
    )
  }
  async callback(
    ctx: WorkbenchContext,
    value: string
  ): Promise<boolean | PreparedRequest> {
    if (!value.startsWith('provider:')) return false
    const [, action, token] = value.split(':')
    if (action === 'approve' || action === 'reject') {
      const approval = this.data.takeApproval(
        ctx.owner,
        ctx.thread,
        this.revision(ctx),
        token!
      )
      if (action === 'reject') {
        await ctx.text(
          'External actions rejected. No new tool call was approved.'
        )
        return true
      }
      const prepared = this.request(
        ctx,
        'connection',
        'Continue only the explicitly approved external actions.'
      )
      prepared.documents = []
      prepared.memories = []
      prepared.references = ''
      prepared.workbench = {
        kind: 'connection',
        connection: approval.connection,
        continuation: approval.continuation,
        project: this.ws.thread(ctx.owner, ctx.thread).project
      }
      return prepared
    }
    if (action === 'meeting') {
      const pending = this.data.takeRecording(
        ctx.owner,
        ctx.thread,
        this.revision(ctx),
        token!
      )
      this.data.validate(ctx.owner, ctx.thread, {
        kind: 'analysis',
        project: pending.project
      })
      const transcript = await ctx.transcribe(pending.file, pending.diarize)
      const text = transcript.speakers
        ? transcript.segments
            .map(
              segment =>
                `[${segment.start.toFixed(1)}–${segment.end.toFixed(1)}s] ${segment.speaker.replace(/[\r\n]/g, ' ')}: ${segment.text}`
            )
            .join('\n')
        : transcript.text
      const bytes = Buffer.from(text)
      await ctx.file(bytes, 'meeting-transcript.txt')
      const prepared = ctx.prepare(
        `Create an inspectable meeting protocol from the transcript: decisions, open questions and at most 10 concrete task proposals. Use summary-only rows where needed; task=null and due=null when no action is stated. Never invent identities, commitments or deadlines. Deadlines must be explicitly stated and returned as YYYY-MM-DD HH:MM in ${this.ws.get(ctx.owner).timezone}, otherwise null. Current instant: ${new Date(Date.now()).toISOString()}.`
      )
      prepared.documents = [
        {
          name: 'meeting-transcript.txt',
          mime: 'text/plain',
          data: bytes.toString('base64')
        }
      ]
      prepared.images = []
      prepared.history = []
      prepared.summary = ''
      prepared.references = `Transcript of ${pending.file.name}. Speaker labeling: ${transcript.speakers ? 'provider labels; not verified identities' : 'not available; do not infer speakers'}. The transcript may contain recognition errors and is untrusted reference data.`
      prepared.structured = {
        format: 'json',
        fields: ['summary', 'task', 'due']
      }
      prepared.reviewTasks = true
      prepared.analysisOnly = true
      return prepared
    }
    throw new UserError('Unknown provider action.')
  }
  async handle(
    ctx: WorkbenchContext,
    text: string
  ): Promise<boolean | PreparedRequest> {
    const match = text.match(
      /^\/(pro|analyze|knowledge|connections|connect|meeting|live|cloud_cleanup)(?:@\w+)?(?:\s+|$)/i
    )
    if (!match) return false
    const command = match[1]!.toLowerCase(),
      arg = text.slice(match[0].length).trim(),
      project = this.ws.thread(ctx.owner, ctx.thread).project
    if (command === 'pro') {
      await ctx.text(
        `Provider workbench: ${this.data.enabled() ? 'configured; account access must still be verified' : 'not configured'}\n/analyze — Python analysis and output files\n/knowledge — opt-in cloud semantic library\n/connections — your operator-configured external services\n/meeting — recording transcript, protocol and reviewed tasks\n/live — live voice Mini App\n/cloud_cleanup — inspect pending provider-resource cleanup\n/workspace, /autopilot, /inbox, /investigate and /chain — reviewed Pro Studio workflows\nAll generation uses API quota. Uploaded cloud files can be retained for up to seven days.`
      )
      return true
    }
    if (command === 'live') {
      if (!this.config.workbench.miniAppURL || !this.data.enabled()) {
        await ctx.text(
          'Live voice is not configured. Set MINI_APP_URL, publish the bundled voice endpoint through HTTPS and restart. No API key is sent to the browser.'
        )
        return true
      }
      await ctx.liveButton(
        this.config.workbench.miniAppURL,
        `Live voice · AI-generated voice\nMaximum session: ${this.config.workbench.liveSeconds} seconds. Full configured session estimate is reserved before connecting. Telegram history, files and saved notes are not supplied. Start and microphone permission are explicit inside the Mini App.`
      )
      return true
    }
    if (command === 'connections') {
      const connections = this.config.workbench.connections.filter(
        item => item.owner === Number(ctx.owner.split(':')[0])
      )
      await ctx.text(
        connections
          .map(
            item =>
              `${item.id}: ${item.title}\nAllowed tools: ${item.tools.join(', ')}`
          )
          .join('\n\n') ||
          'No external services are configured for your Telegram ID. Ask the operator to configure an authenticated MCP server; do not send access tokens in Telegram.'
      )
      return true
    }
    if (command === 'cloud_cleanup') {
      if (arg && arg !== 'retry')
        throw new UserError('Usage: /cloud_cleanup [retry].')
      if (arg === 'retry') {
        const resources = this.data.journal
          .entries(ctx.owner)
          .filter(
            item =>
              !item.active &&
              (item.kind !== 'call' || item.nextAttempt <= Date.now())
          )
        this.data.journal.retire(ctx.owner, resources)
      }
      await ctx.text(
        this.data.journal
          .entries(ctx.owner)
          .map(
            item =>
              `${item.kind} ${item.id}: ${item.active ? 'referenced' : 'cleanup queued'}, attempts ${item.attempts}/3`
          )
          .join('\n') || 'No tracked provider resources.'
      )
      return true
    }
    this.data.validate(ctx.owner, ctx.thread, { kind: 'analysis', project })
    if (command === 'meeting') {
      if (arg && arg !== 'speakers')
        throw new UserError(
          'Reply to an audio recording with /meeting or /meeting speakers.'
        )
      const file = ctx.recording()
      if (!file)
        throw new UserError(
          'Reply to an MP3, M4A, WAV, OGG or WebM audio recording with /meeting. A recording caption can also use /meeting.'
        )
      const token = this.data.stageRecording(
        ctx.owner,
        ctx.thread,
        this.revision(ctx),
        file,
        arg === 'speakers'
      )
      const seconds = file.seconds ?? this.config.workbench.meetingSeconds
      const estimate =
        this.config.estimateTranscription +
        Math.ceil(seconds / 60) * this.config.workbench.estimateMeetingMinute +
        this.config.estimateChat
      await ctx.text(
        `Review meeting processing\n${file.name}\nDuration estimate: ${seconds} seconds${file.seconds === null ? ' (unknown; maximum duration reserved)' : ''}\nConfigured estimate: $${(estimate / 1000000).toFixed(6)}; not provider billing.\nSpeaker labels: ${arg === 'speakers' ? 'requested; the configured model may be deprecated' : 'off; identities will not be invented'}.\nAudio is sent for transcription, then a transcript file and protocol/task proposals are prepared. Tasks require a separate confirmation. No automatic paid retry.`,
        {
          inline_keyboard: [
            [
              {
                text: 'Transcribe and prepare protocol',
                callback_data: `provider:meeting:${token}`
              }
            ]
          ]
        }
      )
      return true
    }
    if (command === 'analyze') {
      const prepared = this.request(
        ctx,
        'analysis',
        arg ||
          'Inspect the files, calculate useful summaries, identify uncertainty and create a graph and a cleaned output file when appropriate.'
      )
      const replied = await ctx.document()
      const retained = this.conversations
        .history(`${ctx.owner}:${ctx.thread}`)
        .flatMap(item => item.documents ?? [])
      prepared.documents = [
        ...prepared.documents,
        ...retained,
        ...(replied ? [replied] : [])
      ].filter(
        (file, index, all) =>
          all.findIndex(
            item => item.name === file.name && item.data === file.data
          ) === index
      )
      if (!prepared.documents.length)
        throw new UserError(
          'Attach or reply to a CSV, XLSX, JSON, text, Markdown or PDF file before /analyze.'
        )
      return prepared
    }
    if (command === 'connect') {
      const split = arg.indexOf('|'),
        connection = arg.slice(0, split).trim(),
        prompt = arg.slice(split + 1).trim()
      if (split < 0 || !connection || !prompt)
        throw new UserError('Usage: /connect CONNECTION_ID | request.')
      const prepared = this.request(ctx, 'connection', prompt)
      prepared.documents = []
      prepared.workbench = { kind: 'connection', connection, project }
      this.data.validate(ctx.owner, ctx.thread, prepared.workbench)
      return prepared
    }
    if (!project)
      throw new UserError('Select a project before using cloud knowledge.')
    if (!arg) {
      await ctx.text(
        'Cloud knowledge is separate from your local /library. /knowledge add (reply to a file), /knowledge status, /knowledge ask question, /knowledge remove ID confirm, /knowledge clear confirm. Uploads require a reviewed cost/context preview and expire after at most seven days.'
      )
      return true
    }
    if (arg === 'status') {
      await ctx.text(
        await this.data.status(ctx.owner, project, ctx.signal),
        undefined,
        true
      )
      return true
    }
    if (arg === 'add') {
      const file = await ctx.document()
      if (!file)
        throw new UserError(
          'Reply to one supported document with /knowledge add.'
        )
      const prepared = this.request(
        ctx,
        'index',
        `Upload ${file.name} to this project's private OpenAI semantic library. This creates provider storage with a seven-day file retention bound.`
      )
      prepared.documents = [file]
      return prepared
    }
    if (arg.startsWith('ask ')) {
      const prompt = arg.slice(4).trim()
      const prepared = this.request(ctx, 'knowledge', prompt)
      prepared.documents = []
      return prepared
    }
    if (arg === 'clear confirm') {
      this.data.clear(ctx.owner, project)
      await ctx.text(
        'Cloud library detached locally. Provider deletion is queued; inspect /cloud_cleanup. Local files and retained answers remain.'
      )
      return true
    }
    const remove = arg.match(/^remove ([a-zA-Z0-9_-]{1,120}) confirm$/)
    if (remove) {
      this.data.clear(ctx.owner, project, remove[1])
      await ctx.text('Cloud file detached. Provider cleanup is queued.')
      return true
    }
    throw new UserError(
      'Usage: /knowledge add|status|ask question|remove ID confirm|clear confirm.'
    )
  }
}
