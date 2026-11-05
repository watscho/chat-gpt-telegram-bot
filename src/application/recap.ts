import type { Message } from '../domain/conversation.js'
import type { Recap } from '../domain/workflow.js'

export function compact(
  previous: Recap | undefined,
  removed: readonly Message[]
): Recap {
  const summary: Recap = structuredClone(
    previous ?? { decisions: [], constraints: [], questions: [], context: [] }
  )
  for (const message of removed) {
    for (const line of message.content.split(/\n|(?<=[.!?])\s+/)) {
      const text = line.trim().slice(0, 300)
      if (!text) continue
      const category = /\?|\b(unresolved|pending|question)\b/i.test(text)
        ? 'questions'
        : /\b(must|limit|constraint|never|require)\b/i.test(text)
          ? 'constraints'
          : /\b(decid|agree|chosen|will use|decision)/i.test(text)
            ? 'decisions'
            : 'context'
      const entry = `${message.role}: ${text}`
      summary[category] = [
        ...summary[category].filter(item => item !== entry),
        entry
      ].slice(-3)
    }
  }
  return summary
}
export function recapText(summary?: Recap): string {
  if (!summary) return ''
  return [
    'Extractive excerpts from trimmed history; quoted claims are not verified facts.',
    ...(['decisions', 'constraints', 'questions', 'context'] as const).map(
      category => `${category}:\n${summary[category].join('\n') || '(none)'}`
    )
  ].join('\n\n')
}
