import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { UserError } from '../domain/conversation.js'

export interface Article {
  url: string
  title: string
  text: string
  truncated: boolean
}
export interface ArticleResponse {
  status: number
  location?: string
  type: string
  encoding?: string
  body: Uint8Array
}
export interface ArticlePorts {
  resolve(host: string): Promise<{ address: string; family: number }[]>
  get(
    url: URL,
    address: { address: string; family: number },
    signal: AbortSignal
  ): Promise<ArticleResponse>
}
const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const)
  blocked.addSubnet(address, prefix, 'ipv4')
blocked.addSubnet('2001::', 23, 'ipv6')
blocked.addSubnet('2001:db8::', 32, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6')
blocked.addSubnet('3fff::', 20, 'ipv6')
blocked.addSubnet('3ffe::', 16, 'ipv6')
export function publicArticleAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family === 6)
    return /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6')
  return false
}
export function articleURL(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new UserError('Use a valid public HTTPS article URL.')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    value.length > 2048 ||
    isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
    !url.hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname) ||
    url.hostname.endsWith('.')
  )
    throw new UserError(
      'Article links must use public HTTPS hosts on port 443 without credentials or IP literals.'
    )
  url.hash = ''
  return url
}
function decode(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (whole: string, entity: string) => {
      if (!entity.startsWith('#')) return named[entity.toLowerCase()]!
      const point =
        entity[1]!.toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1))
      return point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : whole
    }
  )
}
function visibleHTML(raw: string): string {
  const lower = raw.replace(/[A-Z]/g, character => character.toLowerCase()),
    chunks: string[] = []
  let position = 0
  while (position < raw.length) {
    const opening = raw.indexOf('<', position)
    if (opening < 0) {
      chunks.push(raw.slice(position))
      break
    }
    chunks.push(raw.slice(position, opening))
    if (lower.startsWith('<!--', opening)) {
      const end = raw.indexOf('-->', opening + 4)
      position = end < 0 ? raw.length : end + 3
      continue
    }
    const end = raw.indexOf('>', opening + 1)
    if (end < 0) break
    const tag =
      lower
        .slice(opening + 1, Math.min(end, opening + 32))
        .match(/^\s*([a-z]+)\b/)?.[1] ?? ''
    position = end + 1
    if (['script', 'style', 'noscript', 'svg'].includes(tag)) {
      const close = lower.indexOf(`</${tag}`, position)
      if (close < 0) break
      const closing = raw.indexOf('>', close)
      position = closing < 0 ? raw.length : closing + 1
    }
    chunks.push('\n')
  }
  return chunks.join('')
}
function articleTitle(raw: string): string {
  const lower = raw.replace(/[A-Z]/g, character => character.toLowerCase()),
    opening = lower.indexOf('<title')
  if (opening < 0) return 'Article'
  const start = raw.indexOf('>', opening + 6),
    end = lower.indexOf('</title', start + 1)
  if (start < 0 || end < 0) return 'Article'
  return (
    decode(visibleHTML(raw.slice(start + 1, Math.min(end, start + 1025))))
      .trim()
      .slice(0, 256) || 'Article'
  )
}
export function articleText(
  body: Uint8Array,
  html: boolean
): { title: string; text: string; truncated: boolean } {
  let raw: string
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    throw new UserError('Article text must be valid UTF-8.')
  }
  const title = html ? articleTitle(raw) : 'Article'
  const text = (html ? decode(visibleHTML(raw)) : raw)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()
  if (text.length < 80)
    throw new UserError(
      'Too little readable article text. The page may require login or JavaScript; upload its text instead.'
    )
  return { title, text: text.slice(0, 20000), truncated: text.length > 20000 }
}
export const articlePorts: ArticlePorts = {
  resolve: host => lookup(host, { all: true, verbatim: true }),
  get: (url, address, signal) =>
    new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          signal,
          method: 'GET',
          agent: false,
          rejectUnauthorized: true,
          headers: {
            'User-Agent': 'TelegramAIReader/7.0',
            Accept: 'text/html,text/plain',
            'Accept-Encoding': 'identity'
          },
          // Pin the validated DNS result while preserving hostname/SNI and TLS verification.
          lookup: (_host, options, done) =>
            options.all
              ? done(null, [address])
              : done(null, address.address, address.family)
        },
        response => {
          const chunks: Buffer[] = []
          let bytes = 0
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > 1000000) {
              response.destroy()
              reject(new UserError('Article exceeds the 1 MB download limit.'))
              return
            }
            chunks.push(chunk)
          })
          response.on('error', reject)
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              type: response.headers['content-type'] ?? '',
              ...(response.headers.location
                ? { location: response.headers.location }
                : {}),
              ...(response.headers['content-encoding']
                ? { encoding: response.headers['content-encoding'] }
                : {}),
              body: Buffer.concat(chunks)
            })
          )
        }
      )
      req.on('error', reject)
      req.end()
    })
}
export async function readArticle(
  value: string,
  signal?: AbortSignal,
  ports: ArticlePorts = articlePorts
): Promise<Article> {
  const deadline = AbortSignal.timeout(10000),
    combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  try {
    let url = articleURL(value)
    for (let redirects = 0; ; redirects++) {
      combined.throwIfAborted()
      const addresses = await new Promise<
        { address: string; family: number }[]
      >((resolve, reject) => {
        const abort = () => reject(new Error('Article lookup cancelled'))
        combined.addEventListener('abort', abort, { once: true })
        ports
          .resolve(url.hostname)
          .then(resolve, reject)
          .finally(() => combined.removeEventListener('abort', abort))
      })
      combined.throwIfAborted()
      if (
        !addresses.length ||
        addresses.some(
          item =>
            !publicArticleAddress(item.address) ||
            item.family !== isIP(item.address)
        )
      )
        throw new UserError(
          'Article host resolved to a non-public or invalid network address.'
        )
      const response = await ports.get(url, addresses[0]!, combined)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location || redirects === 3)
          throw new UserError(
            'Article redirect limit exceeded or redirect target is missing.'
          )
        url = articleURL(new URL(response.location, url).href)
        continue
      }
      if (response.status !== 200)
        throw new UserError(
          'Article is unavailable. Login, paywalls and blocked pages are not bypassed.'
        )
      if (response.encoding && response.encoding !== 'identity')
        throw new UserError(
          'Compressed article responses are not supported. Upload the text instead.'
        )
      if (
        !/^text\/(html|plain)(?:;|$)/i.test(response.type) ||
        (/charset=/i.test(response.type) &&
          !/charset\s*=\s*["']?utf-8\b/i.test(response.type))
      )
        throw new UserError('Article must be HTML or plain UTF-8 text.')
      if (response.body.length > 1000000)
        throw new UserError('Article exceeds the 1 MB download limit.')
      return {
        url: url.href,
        ...articleText(response.body, /^text\/html/i.test(response.type))
      }
    }
  } catch (error) {
    if (error instanceof UserError) throw error
    throw new UserError(
      'Unable to read this article safely. Try uploading its text; no model request was started.'
    )
  }
}
