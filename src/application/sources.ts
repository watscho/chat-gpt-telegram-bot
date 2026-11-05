import type { Source } from '../domain/conversation.js'

export function safeSource(source: Source): Source | undefined {
  try {
    const url = new URL(source.url)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      source.url.length > 2048
    )
      return undefined
    return {
      url: url.href,
      title:
        [...source.title]
          .map(character => (character.charCodeAt(0) < 32 ? ' ' : character))
          .join('')
          .slice(0, 160) || url.hostname
    }
  } catch {
    return undefined
  }
}
export function sourceList(sources: readonly Source[] = []): Source[] {
  const unique = new Map<string, Source>()
  for (const item of sources) {
    const source = safeSource(item)
    if (source) unique.set(source.url, source)
    if (unique.size === 10) break
  }
  return [...unique.values()]
}
export function formatSources(sources: readonly Source[] = []): string {
  const list = sourceList(sources)
  return list.length
    ? `Sources:\n${list.map((source, i) => `${i + 1}. ${source.title}\n${source.url}`).join('\n')}`
    : ''
}

export function citeText(
  text: string,
  annotations: { title: string; url: string; end_index: number }[],
  sources: Source[]
): string {
  const insertions = new Map<number, Set<number>>()
  for (const annotation of annotations) {
    const source = safeSource(annotation)
    const index = source
      ? sources.findIndex(item => item.url === source.url)
      : -1
    if (
      index < 0 ||
      !Number.isInteger(annotation.end_index) ||
      annotation.end_index < 0 ||
      annotation.end_index > text.length
    )
      continue
    const indices = insertions.get(annotation.end_index) ?? new Set<number>()
    indices.add(index + 1)
    insertions.set(annotation.end_index, indices)
  }
  for (const [position, indices] of [...insertions].sort(([a], [b]) => b - a)) {
    text =
      text.slice(0, position) +
      ` [${[...indices].join(', ')}]` +
      text.slice(position)
  }
  return text.replace(/cite[^]*/g, '')
}
