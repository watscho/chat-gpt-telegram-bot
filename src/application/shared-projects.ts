import { randomUUID } from 'node:crypto'
import type { Config } from '../config.js'
import type { Document } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import type { StateStore } from '../domain/state.js'
import type { Team, TeamRole } from '../domain/shared.js'
const id = () => randomUUID().slice(0, 12)
export class SharedProjects {
  constructor(
    private readonly config: Config,
    private readonly store?: StateStore,
    private readonly now = Date.now
  ) {}
  private actor(owner: string): void {
    const parts = owner.split(':')
    if (
      parts.length !== 2 ||
      parts[0] !== parts[1] ||
      !this.config.allowedUsers.has(Number(parts[0]))
    )
      throw new UserError('Shared projects are unavailable for this user.')
    if (!this.store || this.config.statePath === ':memory:')
      throw new UserError('Shared projects require persistent state.')
  }
  private all(): Team[] {
    return (this.store?.records<Team>('teams') ?? []).map(([, team]) => team)
  }
  private read(
    owner: string,
    teamId: string,
    edit = false,
    admin = false
  ): Team {
    this.actor(owner)
    const team = this.store!.getRecord<Team>('teams', teamId),
      member = team?.members.find(member => member.owner === owner)
    if (
      !team ||
      !member ||
      (edit && member.role === 'reader') ||
      (admin && member.role !== 'owner')
    )
      throw new UserError(
        'Shared project is unavailable or this action needs a stronger role.'
      )
    return structuredClone(team)
  }
  private save(team: Team, actor: string, action: string, target = ''): Team {
    const owned = this.all().filter(
        item => item.owner === team.owner && item.id !== team.id
      ),
      bytes = (item: Team) =>
        item.files.reduce((sum, file) => sum + file.file.data.length, 0)
    if (
      team.members.length > 20 ||
      team.invites.length > 20 ||
      team.files.length > 20 ||
      team.notes.length > 100 ||
      team.tasks.length > 100 ||
      owned.length >= 10 ||
      bytes(team) + owned.reduce((sum, item) => sum + bytes(item), 0) >
        this.config.maxProjectBytes
    )
      throw new UserError(
        'Shared project member/content/storage capacity is full.'
      )
    team.revision++
    team.audit = [
      ...team.audit,
      { at: this.now(), actor, action, target }
    ].slice(-100)
    if (Buffer.byteLength(JSON.stringify(team)) > this.config.maxJobBytes)
      throw new UserError('Shared project record exceeds the byte limit.')
    this.store!.putRecord('teams', team.id, team)
    return structuredClone(team)
  }
  private revision(team: Team, expected: number): void {
    if (team.revision !== expected)
      throw new UserError('Shared project changed. Open a fresh review.')
  }
  create(owner: string, title: string): ReturnType<SharedProjects['inspect']> {
    this.actor(owner)
    if (!title.trim() || title.length > 100)
      throw new UserError('Use a shared project title of 1..100 characters.')
    const team: Team = {
      id: id(),
      owner,
      title: title.trim(),
      revision: 0,
      members: [{ owner, role: 'owner' }],
      invites: [],
      files: [],
      notes: [],
      tasks: [],
      audit: []
    }
    this.save(team, owner, 'create')
    return this.inspect(owner, team.id)
  }
  list(owner: string) {
    this.actor(owner)
    return this.all()
      .filter(team => team.members.some(member => member.owner === owner))
      .map(team => this.inspect(owner, team.id))
  }
  inspect(owner: string, teamId: string) {
    const team = this.read(owner, teamId)
    return {
      id: team.id,
      owner: team.owner,
      title: team.title,
      revision: team.revision,
      role: team.members.find(member => member.owner === owner)!.role,
      members: team.members,
      files: team.files.map(item => ({
        id: item.id,
        name: item.file.name,
        mime: item.file.mime,
        bytes: Buffer.byteLength(item.file.data, 'base64'),
        author: item.author
      })),
      notes: team.notes,
      tasks: team.tasks,
      audit: team.audit
    }
  }
  export(owner: string) {
    return this.list(owner).map(summary => ({
      ...summary,
      files: this.read(owner, summary.id).files
    }))
  }
  invitations(owner: string) {
    this.actor(owner)
    return this.all().flatMap(team =>
      team.invites
        .filter(
          invite => invite.target === owner && invite.expiresAt > this.now()
        )
        .map(invite => ({
          team: team.id,
          title: team.title,
          owner: team.owner,
          ...invite
        }))
    )
  }
  invite(
    owner: string,
    teamId: string,
    expected: number,
    target: string,
    role: string
  ): { token: string; expiresAt: number } {
    const team = this.read(owner, teamId, false, true)
    this.revision(team, expected)
    this.actor(target)
    if (
      target === owner ||
      team.members.some(member => member.owner === target) ||
      !['editor', 'reader'].includes(role)
    )
      throw new UserError(
        'Invite a different allowlisted non-member as editor or reader.'
      )
    const invite = {
      target,
      role: role as 'editor' | 'reader',
      token: id(),
      expiresAt: this.now() + 600000
    }
    team.invites = [
      ...team.invites.filter(
        item => item.target !== target && item.expiresAt > this.now()
      ),
      invite
    ]
    this.save(team, owner, 'invite', target)
    return { token: invite.token, expiresAt: invite.expiresAt }
  }
  accept(
    owner: string,
    teamId: string,
    token: string
  ): ReturnType<SharedProjects['inspect']> {
    this.actor(owner)
    const team = this.store!.getRecord<Team>('teams', teamId),
      invite = team?.invites.find(
        invite =>
          invite.target === owner &&
          invite.token === token &&
          invite.expiresAt > this.now()
      )
    if (!team || !invite)
      throw new UserError(
        'Invitation expired, changed or belongs to another user.'
      )
    if (team.members.some(member => member.owner === owner))
      throw new UserError('You already have shared-project access.')
    team.members.push({ owner, role: invite.role })
    team.invites = team.invites.filter(item => item.target !== owner)
    this.save(team, owner, 'accept')
    return this.inspect(owner, teamId)
  }
  revoke(
    owner: string,
    teamId: string,
    expected: number,
    target: string
  ): void {
    const team = this.read(owner, teamId, false, true)
    this.revision(team, expected)
    if (
      target === team.owner ||
      (!team.members.some(member => member.owner === target) &&
        !team.invites.some(invite => invite.target === target))
    )
      throw new UserError('Choose an existing non-owner member or invite.')
    team.members = team.members.filter(member => member.owner !== target)
    team.invites = team.invites.filter(invite => invite.target !== target)
    this.save(team, owner, 'revoke', target)
  }
  role(
    owner: string,
    teamId: string,
    expected: number,
    target: string,
    role: string
  ): void {
    const team = this.read(owner, teamId, false, true)
    this.revision(team, expected)
    const member = team.members.find(member => member.owner === target)
    if (
      !member ||
      member.role === 'owner' ||
      !['editor', 'reader'].includes(role)
    )
      throw new UserError(
        'Choose an existing non-owner member and editor/reader role.'
      )
    member.role = role as TeamRole
    this.save(team, owner, 'role', target)
  }
  publish(
    owner: string,
    teamId: string,
    expected: number,
    files: Document[],
    notes: string[]
  ): void {
    const team = this.read(owner, teamId, true)
    this.revision(team, expected)
    if (
      (!files.length && !notes.length) ||
      files.length > 10 ||
      notes.length > 10 ||
      files.some(
        file =>
          !file.name ||
          file.name.length > 160 ||
          !file.data ||
          Buffer.byteLength(file.data, 'base64') > this.config.maxDocumentBytes
      ) ||
      notes.some(note => !note.trim() || note.length > 6000)
    )
      throw new UserError(
        'Choose 1..10 bounded files/notes to publish explicitly.'
      )
    for (const file of files)
      team.files.push({ id: id(), author: owner, file: structuredClone(file) })
    for (const text of notes) team.notes.push({ id: id(), author: owner, text })
    this.save(
      team,
      owner,
      'publish',
      `${files.length} files, ${notes.length} notes`
    )
  }
  file(owner: string, teamId: string, fileId: string): Document {
    const file = this.read(owner, teamId).files.find(file => file.id === fileId)
    if (!file) throw new UserError('Shared file not found.')
    return file.file
  }
  removeContent(
    owner: string,
    teamId: string,
    expected: number,
    contentId: string
  ): void {
    const team = this.read(owner, teamId, true)
    this.revision(team, expected)
    const before = team.files.length + team.notes.length
    team.files = team.files.filter(item => item.id !== contentId)
    team.notes = team.notes.filter(item => item.id !== contentId)
    if (before === team.files.length + team.notes.length)
      throw new UserError('Shared content not found.')
    this.save(team, owner, 'remove', contentId)
  }
  task(
    owner: string,
    teamId: string,
    expected: number,
    title: string,
    assignee: string | null,
    taskId?: string,
    done = false
  ): void {
    const team = this.read(owner, teamId, true)
    this.revision(team, expected)
    if (
      !title.trim() ||
      title.length > 1000 ||
      (assignee !== null &&
        !team.members.some(member => member.owner === assignee))
    )
      throw new UserError('Use a task title and an existing assignee or none.')
    const task = taskId
      ? team.tasks.find(item => item.id === taskId)
      : undefined
    if (taskId && !task) throw new UserError('Shared task not found.')
    if (task) {
      task.title = title
      task.assignee = assignee
      task.done = done
    } else team.tasks.push({ id: id(), author: owner, title, assignee, done })
    this.save(team, owner, task ? 'task-update' : 'task-create', taskId ?? '')
  }
  leave(owner: string, teamId: string, expected: number): void {
    const team = this.read(owner, teamId)
    this.revision(team, expected)
    if (team.owner === owner)
      throw new UserError(
        'The owner must close the shared project instead of leaving.'
      )
    team.members = team.members.filter(member => member.owner !== owner)
    this.save(team, owner, 'leave')
  }
  close(owner: string, teamId: string, expected: number): void {
    const team = this.read(owner, teamId, false, true)
    this.revision(team, expected)
    this.store!.deleteRecord('teams', teamId)
  }
  erase(owner: string): void {
    for (const team of this.all()) {
      if (team.owner === owner) {
        this.store!.deleteRecord('teams', team.id)
        continue
      }
      if (
        !team.members.some(member => member.owner === owner) &&
        !team.invites.some(invite => invite.target === owner) &&
        !team.files.some(file => file.author === owner) &&
        !team.notes.some(note => note.author === owner) &&
        !team.tasks.some(
          task => task.author === owner || task.assignee === owner
        ) &&
        !team.audit.some(
          event => event.actor === owner || event.target === owner
        )
      )
        continue
      team.members = team.members.filter(member => member.owner !== owner)
      team.invites = team.invites.filter(invite => invite.target !== owner)
      team.files = team.files.filter(file => file.author !== owner)
      team.notes = team.notes.filter(note => note.author !== owner)
      team.tasks = team.tasks
        .filter(task => task.author !== owner)
        .map(task => ({
          ...task,
          assignee: task.assignee === owner ? null : task.assignee
        }))
      team.audit = team.audit.filter(
        event => event.actor !== owner && event.target !== owner
      )
      team.revision++
      this.store!.putRecord('teams', team.id, team)
    }
  }
}
