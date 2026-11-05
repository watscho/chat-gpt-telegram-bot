import { createHash } from 'node:crypto'
import { UserError } from '../domain/conversation.js'
import type { SourceQuote } from '../domain/suite.js'
export interface WorkSource {
  key: string
  kind: string
  title: string
  text: string
  thread: string
  project: string | null
  at: number
}
export interface WorkHit extends SourceQuote {
  kind: string
  score: number
  excerpt: string
  at: number
}
export class WorkSearch {
  constructor(private readonly sources: (owner: string) => WorkSource[]) {}
  private entries(owner: string): WorkHit[] {
    const entries: WorkHit[] = []
    for (const source of this.sources(owner)) {
      if (!source.text.trim()) continue
      const characters = [...source.text]
      for (let offset = 0; offset < characters.length; offset += 10000) {
        if (entries.length >= 10000)
          throw new UserError(
            'Search corpus exceeds 10000 excerpts. Remove unused retained material first.'
          )
        const text = characters.slice(offset, offset + 11000).join(''),
          id = createHash('sha256')
            .update(`${source.kind}:${source.key}:${offset}:${text}`)
            .digest('hex')
            .slice(0, 20)
        entries.push({
          id,
          kind: source.kind,
          title:
            `${source.title}${offset ? ` · excerpt ${Math.floor(offset / 10000) + 1}` : ''}`.slice(
              0,
              200
            ),
          text,
          thread: source.thread,
          project: source.project,
          at: source.at,
          score: 0,
          excerpt: ''
        })
      }
    }
    return entries
  }
  search(owner: string, query: string): WorkHit[] {
    if (!query.trim() || query.length > 120)
      throw new UserError('Use a search query of 1..120 characters.')
    const normalized = query.normalize('NFKC').toLowerCase(),
      stop = new Set([
        'where',
        'when',
        'what',
        'which',
        'with',
        'that',
        'this',
        'about',
        'have',
        'does',
        'were',
        'from',
        'your',
        'find',
        'the',
        'and',
        'for',
        'our',
        'did',
        'how',
        'why',
        'was',
        'are',
        'can',
        'you'
      ]),
      tokens = [
        ...new Set(
          (normalized.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []).filter(
            token => !stop.has(token)
          )
        )
      ].slice(0, 12)
    if (!tokens.length)
      throw new UserError(
        'Include a name, topic, number or distinctive keyword.'
      )
    return this.entries(owner)
      .flatMap(entry => {
        const text = entry.text.normalize('NFKC').toLowerCase(),
          title = entry.title.normalize('NFKC').toLowerCase()
        let score = text.includes(normalized) ? 12 : 0,
          position = -1
        for (const token of tokens) {
          const exact = text.indexOf(token),
            stem =
              token.length >= 4
                ? token.slice(0, token.length > 6 ? -2 : -1)
                : token,
            partial = exact >= 0 ? exact : text.indexOf(stem)
          if (partial >= 0) {
            score += exact >= 0 ? 6 : 2
            if (title.includes(token)) score += 5
            if (position < 0) position = partial
          }
        }
        if (!score) return []
        return [
          {
            ...entry,
            score,
            excerpt: entry.text.slice(
              Math.max(0, position - 120),
              Math.max(0, position - 120) + 600
            )
          }
        ]
      })
      .sort(
        (a, b) => b.score - a.score || b.at - a.at || a.id.localeCompare(b.id)
      )
      .slice(0, 20)
  }
  open(owner: string, id: string): WorkHit {
    const entry = this.entries(owner).find(entry => entry.id === id)
    if (!entry)
      throw new UserError(
        'Source is no longer retained or belongs to another owner. Search again.'
      )
    return entry
  }
}
