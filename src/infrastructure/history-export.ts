import PDFDocument from 'pdfkit'
import { fileURLToPath } from 'node:url'
import type { Message } from '../domain/conversation.js'
import { UserError } from '../domain/conversation.js'

export class HistoryExport {
  constructor(private readonly maxBytes: number) {}
  private bound(data: string | Uint8Array): Buffer {
    const bytes = Buffer.from(data)
    if (bytes.length > this.maxBytes)
      throw new UserError(
        'Export exceeds the configured size limit. Export one conversation or remove large attachments first.'
      )
    return bytes
  }
  json(value: unknown): Buffer {
    return this.bound(JSON.stringify(value, null, 2))
  }
  markdown(title: string, messages: readonly Message[]): Buffer {
    const text = [
      `# ${title}`,
      ...messages.map(message => {
        const files = [
          ...(message.documents ?? []).map(file => `Document: ${file.name}`),
          ...(message.images ?? []).map(
            (image, i) => `Image ${i + 1}: ${image.mime}`
          )
        ]
        return `## ${message.role === 'user' ? 'User' : 'Assistant'}\n\n${message.content}${files.length ? `\n\n${files.join('\n')}` : ''}`
      })
    ].join('\n\n')
    return this.bound(text)
  }
  async pdf(title: string, messages: readonly Message[]): Promise<Buffer> {
    const text = this.markdown(title, messages).toString('utf8')
    // The bundled Latin/Greek/Cyrillic font does not cover every Unicode script.
    if (
      [...text].some(character => {
        const code = character.codePointAt(0)!
        return code > 0x052f && !(code >= 0x2000 && code <= 0x206f)
      })
    )
      throw new UserError(
        'Some characters are outside the PDF font coverage. Use Markdown or JSON for a lossless export.'
      )
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({
        size: 'A4',
        margin: 48,
        info: { Title: title, Creator: 'Telegram AI Bot Pro' }
      })
      const chunks: Buffer[] = []
      let size = 0
      document.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > this.maxBytes) {
          document.destroy()
          reject(new UserError('PDF export exceeds the configured size limit.'))
        } else chunks.push(chunk)
      })
      document.on('error', () => reject(new Error('PDF export failed')))
      document.on('end', () => resolve(Buffer.concat(chunks)))
      document.font(
        fileURLToPath(
          new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)
        )
      )
      document.fontSize(11).text(text, { lineGap: 4 })
      document.end()
    })
  }
}
