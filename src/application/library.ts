import { createHash } from 'node:crypto'
import type { StateStore } from '../domain/state.js'
import type { Document } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import type { TextPage } from '../infrastructure/document-text.js'

export interface LibraryFile {
  id: string
  project: string
  name: string
  digest: string
  passages: { location: string; text: string }[]
}
export interface LibraryHit {
  file: string
  name: string
  location: string
  text: string
  score: number
}
export class Library {
  private readonly cache = new Map<string, LibraryFile[]>()
  constructor(
    private readonly extract: (file: Document) => Promise<TextPage[]>,
    private readonly store?: StateStore
  ) {}
  get(owner: string): LibraryFile[] {
    return structuredClone(
      this.cache.get(owner) ??
        this.store?.getRecord<LibraryFile[]>('library', owner) ??
        []
    )
  }
  private save(owner: string, files: LibraryFile[]): void {
    if (Buffer.byteLength(JSON.stringify(files)) > 20000000)
      throw new UserError(
        'Library text budget reached (20 MB). Remove unused documents.'
      )
    this.store?.putRecord('library', owner, files)
    this.cache.set(owner, structuredClone(files))
  }
  async add(
    owner: string,
    project: string,
    file: Document
  ): Promise<LibraryFile> {
    if (!project)
      throw new UserError('Select a project before indexing documents.')
    const digest = createHash('sha256').update(file.data).digest('hex')
    const current = this.get(owner)
    const previous = current.find(
      item => item.project === project && item.name === file.name
    )
    if (previous?.digest === digest) return previous
    if (current.length >= 500 && !previous)
      throw new UserError(
        'Library limit reached (500 documents). Remove a document first.'
      )
    const pages = await this.extract(file)
    const passages: LibraryFile['passages'] = []
    let characters = 0
    for (const page of pages) {
      if (page.text.trim()) {
        characters += page.text.length
        if (characters > 1000000)
          throw new UserError('Extracted text exceeds one million characters.')
        for (let offset = 0; offset < page.text.length; offset += 1000) {
          passages.push({
            location: `${page.location}, passage ${Math.floor(offset / 1000) + 1}`,
            text: page.text.slice(offset, offset + 1200)
          })
        }
      }
    }
    if (!passages.length)
      throw new UserError(
        'No searchable text found. Scanned PDFs need OCR before indexing.'
      )
    const indexed = {
      id:
        previous?.id ??
        createHash('sha256')
          .update(`${project}\0${file.name}`)
          .digest('hex')
          .slice(0, 16),
      project,
      name: file.name,
      digest,
      passages
    }
    // Re-read after extraction so pending asynchronous work never overwrites newer library state.
    const files = this.get(owner).filter(
      item => item.project !== project || item.name !== file.name
    )
    if (files.length >= 500)
      throw new UserError(
        'Library limit reached (500 documents). Remove a document first.'
      )
    files.push(indexed)
    this.save(owner, files)
    return structuredClone(indexed)
  }
  remove(owner: string, project: string, id: string): void {
    const files = this.get(owner)
    if (!files.some(item => item.project === project && item.id === id))
      throw new UserError('Library document not found in the selected project.')
    this.save(
      owner,
      files.filter(item => item.project !== project || item.id !== id)
    )
  }
  deleteProject(owner: string, project: string): void {
    this.save(
      owner,
      this.get(owner).filter(item => item.project !== project)
    )
  }
  search(owner: string, project: string, query: string): LibraryHit[] {
    if (!query.trim() || query.length > 1000)
      throw new UserError('Library query must contain 1..1000 characters.')
    const words = [
      ...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])
    ].slice(0, 40)
    const candidates = this.get(owner)
      .filter(file => file.project === project)
      .flatMap(file =>
        file.passages.map(passage => ({
          file: file.id,
          name: file.name,
          ...passage
        }))
      )
    const frequencies = words.map(
      word =>
        candidates.filter(item => item.text.toLocaleLowerCase().includes(word))
          .length
    )
    return candidates
      .map(item => {
        const text = item.text.toLocaleLowerCase()
        const score = words.reduce(
          (sum, word, index) =>
            sum +
            (text.includes(word)
              ? Math.log(1 + candidates.length / (1 + frequencies[index]!))
              : 0),
          0
        )
        return { ...item, score }
      })
      .filter(item => item.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.file.localeCompare(b.file) ||
          a.location.localeCompare(b.location)
      )
      .slice(0, 8)
  }
  references(hits: LibraryHit[]): string {
    return hits
      .map(
        (hit, index) =>
          `[L${index + 1}] ${hit.name} (${hit.location})\n${hit.text}`
      )
      .join('\n\n')
  }
  refresh(owner: string): void {
    this.cache.delete(owner)
  }
  erase(owner: string): void {
    this.store?.deleteRecord('library', owner)
    this.cache.delete(owner)
  }
}
