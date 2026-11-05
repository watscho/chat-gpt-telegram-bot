import { extname, basename } from 'node:path'
import type { Document } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'
import { downloadTelegramFile } from './telegram-file.js'

const formats: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json'
}
export function documentFromBytes(
  bytes: Uint8Array,
  filename: string,
  maxBytes: number
): Document {
  if (!bytes.length || bytes.length > maxBytes)
    throw new UserError('Document is empty or too large.')
  const name = [...basename(filename)]
    .filter(character => character.charCodeAt(0) >= 32)
    .join('')
    .slice(-160)
  const extension = extname(name).toLowerCase()
  const mime = formats[extension]
  if (!mime)
    throw new UserError(
      'Supported documents: PDF, DOCX, XLSX, PPTX, TXT, MD, CSV and JSON.'
    )
  const data = Buffer.from(bytes)
  if (extension === '.pdf' && data.toString('ascii', 0, 5) !== '%PDF-')
    throw new UserError('Invalid PDF file.')
  if (
    ['.docx', '.xlsx', '.pptx'].includes(extension) &&
    !data.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
  )
    throw new UserError('Invalid Office document. Use DOCX, XLSX or PPTX.')
  if (mime.startsWith('text/') || extension === '.json') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data)
    } catch {
      throw new UserError('Text documents must use UTF-8 encoding.')
    }
    if (data.includes(0))
      throw new UserError('Text document contains binary data.')
  }
  return { name, mime, data: data.toString('base64') }
}
export async function downloadTelegramDocument(
  url: URL,
  filename: string,
  maxBytes: number,
  timeoutMs: number,
  fetcher: typeof fetch = fetch
): Promise<Document> {
  // Reject unsupported names before downloading content.
  if (!formats[extname(filename).toLowerCase()])
    throw new UserError(
      'Supported documents: PDF, DOCX, XLSX, PPTX, TXT, MD, CSV and JSON.'
    )
  return documentFromBytes(
    await downloadTelegramFile(url, maxBytes, timeoutMs, fetcher, 'Document'),
    filename,
    maxBytes
  )
}
