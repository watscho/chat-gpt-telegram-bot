import { createHash } from 'node:crypto'
import type { Evidence } from '../domain/conversation.js'
import { safeSource } from './sources.js'

export function evidenceCards(values: readonly Evidence[]): Evidence[] {
  return values.slice(0, 16).map((value, index) => {
    const source = value.url
      ? safeSource({ title: value.title, url: value.url })
      : undefined
    return {
      label: /^[A-Z]\d{1,2}$/.test(value.label) ? value.label : `S${index + 1}`,
      title: value.title.slice(0, 256),
      text: [...value.text]
        .filter(
          character =>
            character.charCodeAt(0) >= 32 ||
            [9, 10, 13].includes(character.charCodeAt(0))
        )
        .join('')
        .slice(0, 1200),
      ...(source ? { url: source.url } : {})
    }
  })
}

export function referenceId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 24)
}
