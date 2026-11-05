import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { ReleasePorts } from '../release-checks.js'
const version = '10.0.1',
  declaration = `Current release: **${version}**.`,
  guide = `# Guide\n\n${declaration}\n`,
  catalog =
    '**1 documented capabilities across 1 areas.**\n<details>\n<summary>Area · 1 capabilities</summary>\n\n| Capability | Entry point |\n| --- | --- |\n| One | /start |\n\n</details>'
function documents() {
  return new Map<string, string>([
    ['package.json', JSON.stringify({ version })],
    [
      'package-lock.json',
      JSON.stringify({ version, packages: { '': { version } } })
    ],
    [
      'CHANGELOG.md',
      `# Changelog\n\n## ${version} — Current\n\n## 9.0.0 — Historical`
    ],
    ['README.md', `${guide}\n${catalog}`],
    ['CONTRIBUTING.md', guide],
    ['SECURITY.md', guide],
    ['docs/guide.md', guide]
  ])
}
const files = documents()
mock.module('node:fs', {
  namedExports: {
    readFileSync: (url: URL) => {
      const file = [...files.keys()].find(file =>
        url.pathname.endsWith(`/${file}`)
      )
      if (!file) throw new Error('Unexpected release read')
      return files.get(file)!
    },
    readdirSync: () => ['guide.md', 'ignored.txt']
  }
})
const { checkCatalog, checkRelease } = await import('../release-checks.js')
function setup() {
  const data = documents(),
    messages: string[] = [],
    io: ReleasePorts = {
      read: path => {
        const value = data.get(path)
        if (value === undefined) throw new Error('Missing fixture')
        return value
      },
      documents: () => ['README.md', 'docs/guide.md'],
      log: message => messages.push(message)
    }
  return { data, messages, io }
}
void test('release validation uses the package version as source across lockfile, latest changelog and maintained docs', () => {
  const s = setup()
  checkRelease(s.io)
  assert.match(s.messages[0]!, /Release 10.0.1/)
  assert.match(s.messages[0]!, /2 maintained documents/)
  assert.ok(s.data.get('CHANGELOG.md')!.includes('9.0.0'))
})
void test('release validation rejects malformed manifests, mismatched root lock metadata and stale or missing changelog releases', () => {
  for (const json of ['invalid JSON', 'null', '[]', '1', 'false']) {
    const s = setup()
    s.data.set('package.json', json)
    assert.throws(() => checkRelease(s.io))
  }
  for (const value of [undefined, 10, '10.0', '10.0.1-beta']) {
    const s = setup()
    s.data.set('package.json', JSON.stringify({ version: value }))
    assert.throws(() => checkRelease(s.io), /stable release/)
  }
  for (const lock of [
    { version: '9.0.0', packages: { '': { version } } },
    { version },
    { version, packages: {} },
    { version, packages: { '': { version: '9.0.0' } } }
  ]) {
    const s = setup()
    s.data.set('package-lock.json', JSON.stringify(lock))
    assert.throws(() => checkRelease(s.io), /lockfile/)
  }
  for (const text of ['# Changelog', '# Changelog\n## 9.0.0 — Old']) {
    const s = setup()
    s.data.set('CHANGELOG.md', text)
    assert.throws(() => checkRelease(s.io), /latest changelog/)
  }
})
void test('living guides require one matching current declaration and unversioned titles, while explicit history remains valid', () => {
  for (const text of [
    '# Guide',
    guide.replace('10.0.1', '9.0.0'),
    `${guide}\n${declaration}`,
    `${declaration}\nNo title`,
    guide.replace('# Guide', '# Guide (9.0)')
  ]) {
    const s = setup()
    s.data.set('docs/guide.md', text)
    assert.throws(() => checkRelease(s.io))
  }
  const s = setup()
  s.data.set(
    'docs/guide.md',
    `${guide}\nHistorical introduction evidence (9.0.0): 329 tests. Database schema 3. Dependency 4.0.1.`
  )
  checkRelease(s.io)
  s.io.documents = () => ['docs/guide.md']
  assert.throws(() => checkRelease(s.io), /README/)
})
void test('README area and capability totals must match actual table rows with headers and separators excluded', () => {
  checkCatalog(catalog)
  for (const text of [
    '',
    catalog.replace('· 1 capabilities', 'Area'),
    catalog.replace('· 1 capabilities', '· 2 capabilities'),
    catalog.replace('**1 documented', '**2 documented'),
    catalog.replace('across 1 areas', 'across 2 areas')
  ])
    assert.throws(() => checkCatalog(text), /catalog/)
  const s = setup()
  s.data.set('README.md', guide)
  assert.throws(() => checkRelease(s.io), /catalog/)
})
void test('default release ports read only mocked repository metadata and include every Markdown guide', t => {
  const messages: string[] = []
  t.mock.method(console, 'log', (message: string) => messages.push(message))
  checkRelease()
  assert.match(messages[0]!, /4 maintained documents/)
})
