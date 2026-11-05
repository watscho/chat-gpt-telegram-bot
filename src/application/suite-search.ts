import type { Profiles } from './profiles.js'
import type { Workspaces } from './workspaces.js'
import type { Conversations } from './conversations.js'
import type { Library } from './library.js'
import type { Workflow } from './workflow.js'
import type { Experience } from './experience.js'
import type { Studio } from './studio.js'
import type { Suite } from './suite.js'
import { WorkSearch, type WorkSource } from './work-search.js'
export function suiteSearch(
  profiles: Profiles,
  ws: Workspaces,
  conversations: Conversations,
  library: Library,
  workflow: Workflow,
  experience: Experience,
  studio: Studio,
  suite: Suite
): WorkSearch {
  return new WorkSearch(owner => {
    const sources: WorkSource[] = []
    const add = (
      key: string,
      kind: string,
      title: string,
      text: string,
      thread = '',
      project: string | null = null,
      at = 0
    ) => sources.push({ key, kind, title, text, thread, project, at })
    const profile = profiles.get(owner)
    for (const thread of profile.threads) {
      for (const [index, message] of conversations
        .history(`${owner}:${thread.id}`)
        .entries())
        add(
          `${thread.id}:${index}`,
          'conversation',
          thread.title,
          message.content,
          thread.id,
          ws.thread(owner, thread.id).project
        )
      add(
        thread.id,
        'recap',
        thread.title,
        conversations.recap(`${owner}:${thread.id}`),
        thread.id,
        ws.thread(owner, thread.id).project
      )
    }
    for (const [index, text] of profile.memories.entries())
      add(String(index), 'note', 'Saved note', text)
    for (const project of ws.get(owner).projects) {
      for (const [index, text] of project.notes.entries())
        add(
          `${project.id}:${index}`,
          'project',
          project.title,
          text,
          '',
          project.id
        )
      for (const file of project.documents)
        if (/^(text\/|application\/json)/.test(file.mime))
          add(
            `${project.id}:${file.name}`,
            'file',
            file.name,
            Buffer.from(file.data, 'base64').toString('utf8'),
            '',
            project.id
          )
    }
    for (const file of library.get(owner))
      for (const passage of file.passages)
        add(
          `${file.id}:${passage.location}`,
          'library',
          `${file.name}: ${passage.location}`,
          passage.text,
          '',
          file.project
        )
    for (const task of workflow.get(owner).tasks)
      add(
        task.id,
        'task',
        task.title.slice(0, 200),
        `${task.title}\n${task.status}\n${task.dueAt === null ? '' : new Date(task.dueAt).toISOString()}`,
        task.thread
      )
    for (const bookmark of experience.get(owner).bookmarks)
      add(
        bookmark.id,
        'bookmark',
        bookmark.title,
        bookmark.text,
        '',
        null,
        bookmark.createdAt
      )
    for (const item of studio.get(owner).inbox)
      add(
        item.id,
        'inbox',
        'Inbox',
        item.text,
        item.thread,
        item.project,
        item.createdAt
      )
    for (const mission of studio.get(owner).missions)
      for (const version of mission.versions)
        add(
          `${mission.id}:${version.id}`,
          'result',
          mission.title,
          version.reply.text,
          mission.thread,
          mission.project,
          version.createdAt
        )
    for (const record of suite.get(owner).records)
      add(
        record.id,
        record.kind,
        record.title,
        JSON.stringify({
          fields: record.fields,
          rows: record.rows,
          sources: record.sources
        }),
        record.thread,
        record.project,
        record.createdAt
      )
    return sources
  })
}
