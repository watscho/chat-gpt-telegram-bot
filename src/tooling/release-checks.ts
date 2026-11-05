import { readFileSync, readdirSync } from 'node:fs'
export interface ReleasePorts {
  read(path: string): string
  documents(): string[]
  log(message: string): void
}
function ports(): ReleasePorts {
  const root = new URL('../../', import.meta.url)
  return {
    read: path => readFileSync(new URL(path, root), 'utf8'),
    documents: () => [
      'README.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      ...readdirSync(new URL('docs/', root))
        .filter(name => name.endsWith('.md'))
        .map(name => `docs/${name}`)
    ],
    log: message => console.log(message)
  }
}
function object(text: string, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must contain an object.`)
  return value as Record<string, unknown>
}
export function checkCatalog(text: string): void {
  const count = text.match(
    /\*\*(\d+) documented capabilities across (\d+) areas\.\*\*/
  )
  if (!count) throw new Error('README feature catalog totals are missing.')
  const sections = [...text.matchAll(/<details>([\s\S]*?)<\/details>/g)]
  let total = 0
  for (const section of sections) {
    const body = section[1]!,
      declared = body.match(/· (\d+) capabilities/)
    const rows = body
      .split('\n')
      .filter(
        line =>
          line.startsWith('|') &&
          !/^\|\s*Capability\s*\|/.test(line) &&
          !/^\|[\s:|-]+$/.test(line)
      ).length
    if (!declared || rows !== Number(declared[1]))
      throw new Error(
        'README feature catalog area count does not match its rows.'
      )
    total += rows
  }
  if (total !== Number(count[1]) || sections.length !== Number(count[2]))
    throw new Error('README feature catalog totals do not match its areas.')
}
export function checkRelease(io: ReleasePorts = ports()): void {
  const pkg = object(io.read('package.json'), 'package.json'),
    version = pkg.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('package.json needs a stable release version.')
  const lock = object(io.read('package-lock.json'), 'package-lock.json'),
    packages = lock.packages as Record<string, { version?: string }> | undefined
  if (lock.version !== version || packages?.['']?.version !== version)
    throw new Error('Package and root lockfile versions must match.')
  const latest = io
    .read('CHANGELOG.md')
    .match(/^## (\d+\.\d+\.\d+)(?:\s|$)/m)?.[1]
  if (latest !== version)
    throw new Error('The latest changelog release must match package.json.')
  const files = io.documents()
  if (!files.includes('README.md'))
    throw new Error(
      'README.md must be included in release documentation checks.'
    )
  for (const file of files) {
    const text = io.read(file),
      declarations = [
        ...text.matchAll(/^Current release: \*\*(\d+\.\d+\.\d+)\*\*\.$/gm)
      ],
      heading = text.match(/^# (.+)$/m)?.[1]
    if (declarations.length !== 1 || declarations[0]![1] !== version)
      throw new Error(
        `${file}: current release must match ${version} exactly once.`
      )
    if (!heading || /\b\d+\.\d+(?:\.\d+)?\b/.test(heading))
      throw new Error(
        `${file}: use an unversioned title and the current-release declaration.`
      )
    if (file === 'README.md') checkCatalog(text)
  }
  io.log(
    `Release ${version}: package, lockfile, changelog, ${files.length} maintained documents and README catalog agree.`
  )
}
