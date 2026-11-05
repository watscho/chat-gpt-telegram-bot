import { XMLParser } from 'fast-xml-parser'
import { UserError } from '../domain/conversation.js'
import type { ReadingEntry } from '../domain/routine.js'
import { canonicalReadingURL } from '../application/routine-rules.js'
import {
  articleURL,
  articlePorts,
  readPublic,
  readableMarkup,
  readArticle,
  type ArticlePorts
} from './article-reader.js'
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}
function text(value: unknown): string {
  if (typeof value === 'string') return value
  const node = record(value)
  return typeof node['#text'] === 'string' ? node['#text'] : ''
}
export function parseReadingFeed(
  bytes: Uint8Array,
  base: string
): ReadingEntry[] {
  let xml: string
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new UserError('Feed must use valid UTF-8.')
  }
  if (
    bytes.length > 1000000 ||
    !xml.trim() ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    (xml.match(/</g) ?? []).length > 5000
  )
    throw new UserError(
      'Feed is empty, oversized or uses unsupported XML declarations/tag counts.'
    )
  let parsed: unknown
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@',
      removeNSPrefix: true,
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: false,
      maxNestedTags: 32
    }).parse(xml, true) as unknown
  } catch {
    throw new UserError('Feed XML is invalid or exceeds its nesting limit.')
  }
  const root = record(parsed),
    rss = record(root.rss),
    channel = record(rss.channel),
    feed = record(root.feed),
    atom = Object.hasOwn(root, 'feed'),
    entries = list(atom ? feed.entry : channel.item)
  if (!Object.hasOwn(root, 'rss') && !atom)
    throw new UserError('Use an RSS 2.0 or Atom feed.')
  if (entries.length > 100)
    throw new UserError('Feed exceeds 100 entries. Choose a bounded source.')
  const result: ReadingEntry[] = [],
    seen = new Set<string>(),
    feedBase = text((atom ? feed : channel)['@base'])
  for (const value of entries) {
    const item = record(value),
      links = list(item.link),
      link = atom
        ? links
            .map(record)
            .find(link => !link['@rel'] || link['@rel'] === 'alternate')?.[
            '@href'
          ]
        : text(item.link),
      title = readableMarkup(text(item.title)).trim().slice(0, 200)
    if (typeof link !== 'string' || !link.trim() || !title) continue
    let url: string
    try {
      const rootBase = feedBase ? new URL(feedBase, base).href : base,
        itemBase = text(item['@base'])
      url = canonicalReadingURL(
        articleURL(
          new URL(
            readableMarkup(link),
            itemBase ? new URL(itemBase, rootBase) : rootBase
          ).href
        ).href
      )
    } catch {
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    const raw = text(
        atom
          ? (item.summary ?? item.content)
          : (item.description ?? item.encoded)
      ),
      excerpt = readableMarkup(raw).replace(/\s+/g, ' ').trim().slice(0, 2000),
      date = Date.parse(
        text(atom ? (item.published ?? item.updated) : item.pubDate)
      )
    result.push({
      url,
      title,
      excerpt,
      published: Number.isFinite(date) ? date : null
    })
  }
  return result
}
export async function readReadingSource(
  kind: 'rss' | 'page',
  url: string,
  signal: AbortSignal,
  ports: ArticlePorts = articlePorts
): Promise<ReadingEntry[]> {
  if (kind === 'page') {
    const article = await readArticle(url, signal, ports)
    return [
      {
        url: canonicalReadingURL(article.url),
        title: article.title.slice(0, 200),
        excerpt: article.text.slice(0, 2000),
        published: null
      }
    ]
  }
  const source = await readPublic(url, signal, ports)
  if (
    !/^(?:(?:application|text)\/(?:rss\+xml|atom\+xml|xml)|text\/plain)(?:;|$)/i.test(
      source.type
    )
  )
    throw new UserError('RSS/Atom sources must return XML or plain UTF-8 text.')
  return parseReadingFeed(source.body, source.url)
}
