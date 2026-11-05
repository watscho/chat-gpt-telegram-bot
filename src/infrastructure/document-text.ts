import type { Document } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'

export interface TextPage {
  location: string
  text: string
}
export async function extractDocumentText(file: Document): Promise<TextPage[]> {
  const bytes = Uint8Array.from(Buffer.from(file.data, 'base64'))
  if (bytes.length > 10000000)
    throw new UserError('Library files must not exceed 10 MB.')
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = getDocument({
      data: bytes,
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false
    })
    try {
      const pdf = await task.promise
      if (pdf.numPages > 500)
        throw new UserError('Library PDFs must not exceed 500 pages.')
      const pages: TextPage[] = []
      let characters = 0
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index)
        const content = await page.getTextContent()
        const text = content.items
          .map(item => ('str' in item ? item.str : ''))
          .join(' ')
        characters += text.length
        if (characters > 1000000)
          throw new UserError('Extracted text exceeds one million characters.')
        pages.push({ location: `page ${index}`, text })
      }
      return pages
    } catch (error) {
      if (error instanceof UserError) throw error
      throw new UserError(
        'Unable to extract PDF text. Use an unencrypted text PDF or UTF-8 export; scanned pages require OCR outside this bot.'
      )
    } finally {
      await task.destroy()
    }
  }
  if (!/\.(txt|md|csv|json)$/i.test(file.name))
    throw new UserError(
      'Library indexing supports text PDFs and UTF-8 TXT, MD, CSV and JSON. Export Office documents to PDF or text first.'
    )
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new UserError('Library text must use UTF-8.')
  }
  if (text.length > 1000000)
    throw new UserError('Extracted text exceeds one million characters.')
  return text
    .split('\n')
    .map((line, index) => ({ location: `line ${index + 1}`, text: line }))
}
