import {
  Document as WordDocument,
  Paragraph,
  TextRun,
  Header,
  Footer,
  Packer,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun
} from 'docx'
import PptxGenJS from 'pptxgenjs'
// The export map selects an ESM constructor; the declarations describe a CJS namespace.
const Presentation = PptxGenJS as unknown as typeof PptxGenJS.default
import PDFDocument from 'pdfkit'
import { fileURLToPath } from 'node:url'
import { UserError, type Document, type Image } from '../domain/conversation.js'
import type {
  BrandTemplate,
  DocumentSection,
  SuiteRow
} from '../domain/suite.js'
import { readArchive } from './archive.js'
import { imageFromBytes } from './images.js'
export type DocumentBlock =
  { kind: 'text'; text: string } | { kind: 'table'; rows: string[][] }
export function documentBlocks(text: string): DocumentBlock[] {
  const lines = text.split('\n'),
    blocks: DocumentBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const group: string[] = []
      while (
        i < lines.length &&
        lines[i]!.trim().startsWith('|') &&
        lines[i]!.trim().endsWith('|')
      )
        group.push(lines[i++]!)
      const rows = group
        .filter(line => !/^\|[\s:|-]+\|$/.test(line.trim()))
        .map(line =>
          line
            .trim()
            .slice(1, -1)
            .split('|')
            .map(cell => cell.trim())
        )
      if (
        rows.length >= 2 &&
        rows.length <= 30 &&
        rows[0]!.length <= 8 &&
        rows.every(
          row =>
            row.length === rows[0]!.length &&
            row.every(cell => cell.length <= 300)
        )
      )
        blocks.push({ kind: 'table', rows })
      else blocks.push({ kind: 'text', text: group.join('\n') })
    } else {
      const group = [line]
      i++
      while (
        i < lines.length &&
        !(lines[i]!.trim().startsWith('|') && lines[i]!.trim().endsWith('|'))
      )
        group.push(lines[i++]!)
      blocks.push({ kind: 'text', text: group.join('\n') })
    }
  }
  return blocks
}
export function imageSize(image: Image): { width: number; height: number } {
  const bytes = Buffer.from(image.data, 'base64'),
    detected = imageFromBytes(bytes, 10000000)
  if (detected.mime !== image.mime || image.mime === 'image/webp')
    throw new UserError(
      'Use a PNG or JPEG image for exact preserved-image artifacts.'
    )
  let width = 0,
    height = 0
  if (image.mime === 'image/png') {
    if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR')
      throw new UserError('Image dimensions are missing.')
    width = bytes.readUInt32BE(16)
    height = bytes.readUInt32BE(20)
  } else {
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 255) throw new UserError('Invalid JPEG markers.')
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]!
      if (offset + 2 > bytes.length) break
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length)
        throw new UserError('Invalid JPEG marker length.')
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207
        ].includes(marker)
      ) {
        if (length < 8) throw new UserError('Invalid JPEG dimensions.')
        height = bytes.readUInt16BE(offset + 3)
        width = bytes.readUInt16BE(offset + 5)
        break
      }
      offset += length
    }
  }
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 16777216
  )
    throw new UserError('Image dimensions are invalid or too large.')
  return { width, height }
}
const xml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
export function annotateScreenshot(
  image: Image,
  rows: SuiteRow[],
  maxBytes: number
): Document {
  const size = imageSize(image)
  if (!rows.length || rows.length > 12)
    throw new UserError('Annotation needs 1..12 reviewed regions.')
  const content = rows
    .map((row, index) => {
      const numbers = ['x', 'y', 'width', 'height'].map(key => {
        const raw = row[key]
        if (typeof raw !== 'string' || !/^\d+(?:\.\d+)?$/.test(raw))
          throw new UserError('Region coordinates must be normalized numbers.')
        return Number(raw)
      })
      const [x, y, w, h] = numbers as [number, number, number, number]
      if (
        w <= 0 ||
        h <= 0 ||
        x + w > 1000 ||
        y + h > 1000 ||
        !row.label ||
        row.label.length > 80
      )
        throw new UserError(
          'Region extends outside the screenshot or has an invalid label.'
        )
      return `<g><rect x="${(x / 1000) * size.width}" y="${(y / 1000) * size.height}" width="${(w / 1000) * size.width}" height="${(h / 1000) * size.height}" fill="none" stroke="#00a389" stroke-width="${Math.max(2, size.width / 400)}"/><text x="${(x / 1000) * size.width + 4}" y="${(y / 1000) * size.height + 18}" font-family="sans-serif" font-size="${Math.max(16, size.width / 70)}" fill="#003d36" stroke="white" stroke-width="0.4">${index + 1}. ${xml(row.label)}</text><title>${xml(row.action ?? '')}</title></g>`
    })
    .join('')
  const data = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}"><desc>AI-proposed regions; inspect alignment and instructions before acting. Original screenshot pixels are embedded unchanged.</desc><image width="${size.width}" height="${size.height}" href="data:${image.mime};base64,${Buffer.from(image.data, 'base64').toString('base64')}"/>${content}</svg>`
  )
  if (data.length > maxBytes)
    throw new UserError('Annotated screenshot exceeds the export limit.')
  return {
    name: 'annotated-screen.svg',
    mime: 'image/svg+xml',
    data: data.toString('base64')
  }
}
export async function templateFromDocument(
  file: Document,
  name: string,
  maxBytes: number
): Promise<BrandTemplate> {
  if (!/\.(docx|pptx)$/i.test(file.name))
    throw new UserError(
      'Use a DOCX or PPTX branding reference; choose editable template values for PDF references.'
    )
  const entries = await readArchive(Buffer.from(file.data, 'base64'), maxBytes),
    text = entries
      .filter(entry =>
        /^(word\/(document|styles)\.xml|ppt\/(theme\/theme\d+|slides\/slide\d+)\.xml)$/.test(
          entry.name
        )
      )
      .map(entry =>
        new TextDecoder('utf-8', { fatal: true }).decode(entry.data)
      )
      .join('\n')
  if (!text || text.length > 2000000 || /<!DOCTYPE|<!ENTITY/i.test(text))
    throw new UserError(
      'Brand reference XML is missing, oversized or contains unsupported declarations.'
    )
  const accent =
    text.match(/<w:color\b[^>]*\bw:val="([a-fA-F0-9]{6})"/)?.[1] ??
    text.match(/<a:accent1>[\s\S]{0,100}?\bval="([a-fA-F0-9]{6})"/)?.[1] ??
    '287F78'
  const font =
    text.match(/\bw:ascii="([a-zA-Z0-9 -]{1,60})"/)?.[1] ??
    text.match(/<a:latin\b[^>]*\btypeface="([a-zA-Z0-9 -]{1,60})"/)?.[1] ??
    'Noto Sans'
  const headings = [
    ...text.matchAll(/<(?:w|a):t(?:\s[^>]*)?>([^<]{1,100})<\/(?:w|a):t>/g)
  ]
    .slice(0, 8)
    .map(match =>
      match[1]!
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
    )
  return {
    name,
    revision: 1,
    brand: headings[0] ?? name,
    accent: accent.toUpperCase(),
    font,
    footer: 'Prepared for review',
    headings
  }
}
export class BrandedDocuments {
  constructor(private readonly maxBytes: number) {}
  private output(format: 'docx' | 'pptx' | 'pdf', data: Uint8Array): Document {
    if (!data.length || data.length > this.maxBytes)
      throw new UserError('Document output exceeds the byte limit.')
    return {
      name: `report.${format}`,
      mime:
        format === 'pdf'
          ? 'application/pdf'
          : format === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      data: Buffer.from(data).toString('base64')
    }
  }
  async render(
    template: BrandTemplate,
    format: 'docx' | 'pptx' | 'pdf',
    title: string,
    sections: DocumentSection[]
  ): Promise<Document> {
    if (
      !title.trim() ||
      title.length > 200 ||
      !sections.length ||
      sections.length > 20 ||
      sections.reduce(
        (sum, section) => sum + section.heading.length + section.text.length,
        0
      ) > 16000 ||
      sections.reduce(
        (sum, section) => sum + (section.image?.data.length ?? 0),
        0
      ) >
        this.maxBytes / 2
    )
      throw new UserError(
        'Use a title and 1..20 concise sections within the document/image budget.'
      )
    if (format === 'pdf')
      return this.output(format, await this.pdf(template, title, sections))
    if (format === 'docx') {
      const paragraphs: (Paragraph | Table)[] = [
        new Paragraph({
          children: [
            new TextRun({
              text: title,
              size: 40,
              color: template.accent,
              bold: true
            })
          ],
          spacing: { after: 320 }
        })
      ]
      for (const section of sections) {
        paragraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: section.heading,
                size: 28,
                color: template.accent,
                bold: true
              })
            ],
            spacing: { before: 240, after: 160 }
          })
        )
        for (const block of documentBlocks(section.text)) {
          if (block.kind === 'table')
            paragraphs.push(
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: block.rows.map(
                  (row, index) =>
                    new TableRow({
                      children: row.map(
                        cell =>
                          new TableCell({
                            children: [
                              new Paragraph({
                                children: [
                                  new TextRun({ text: cell, bold: index === 0 })
                                ]
                              })
                            ]
                          })
                      )
                    })
                )
              })
            )
          else
            for (const line of block.text.split('\n'))
              paragraphs.push(new Paragraph({ text: line }))
        }
        if (section.image) {
          const size = imageSize(section.image),
            ratio = Math.min(560 / size.width, 360 / size.height)
          paragraphs.push(
            new Paragraph({
              children: [
                new ImageRun({
                  type: section.image.mime === 'image/png' ? 'png' : 'jpg',
                  data: Buffer.from(section.image.data, 'base64'),
                  transformation: {
                    width: Math.round(size.width * ratio),
                    height: Math.round(size.height * ratio)
                  }
                })
              ]
            })
          )
        }
      }
      const document = new WordDocument({
        creator: 'Telegram AI Bot Pro',
        title,
        styles: {
          default: {
            document: {
              run: { font: template.font, size: 22 },
              paragraph: { spacing: { after: 160, line: 300 } }
            }
          }
        },
        sections: [
          {
            headers: {
              default: new Header({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: template.brand,
                        color: template.accent,
                        size: 18
                      })
                    ]
                  })
                ]
              })
            },
            footers: {
              default: new Footer({
                children: [new Paragraph({ text: template.footer })]
              })
            },
            children: paragraphs
          }
        ]
      })
      return this.output(format, await Packer.toBuffer(document))
    }
    const presentation = new Presentation()
    presentation.layout = 'LAYOUT_WIDE'
    presentation.author = 'Telegram AI Bot Pro'
    presentation.subject = title
    presentation.title = title
    presentation.company = template.brand
    presentation.theme = {
      headFontFace: template.font,
      bodyFontFace: template.font
    }
    let count = 0
    const slide = (heading: string) => {
      if (++count > 32)
        throw new UserError(
          'Presentation needs more than 32 slides. Request a shorter brief.'
        )
      const slide = presentation.addSlide()
      slide.background = { color: 'FFFFFF' }
      slide.addText(template.brand, {
        x: 0.7,
        y: 0.3,
        w: 11.9,
        h: 0.3,
        fontSize: 11,
        color: template.accent,
        margin: 0
      })
      slide.addText(heading, {
        x: 0.7,
        y: 0.95,
        w: 11.9,
        h: 0.7,
        fontSize: 28,
        color: '1F2933',
        bold: true,
        margin: 0
      })
      slide.addText(`${template.footer} · ${count}`, {
        x: 0.7,
        y: 7.05,
        w: 11.9,
        h: 0.2,
        fontSize: 9,
        color: '637079',
        margin: 0
      })
      return slide
    }
    slide(title).addText(sections.map(section => section.heading).join('\n'), {
      x: 0.7,
      y: 2,
      w: 11.9,
      h: 4.6,
      fontSize: 22,
      color: '334155',
      margin: 0,
      breakLine: false
    })
    for (const section of sections) {
      for (const block of documentBlocks(section.text)) {
        if (block.kind === 'table') {
          for (let offset = 1; offset < block.rows.length; offset += 14)
            slide(section.heading).addTable(
              [block.rows[0]!, ...block.rows.slice(offset, offset + 14)].map(
                row => row.map(text => ({ text }))
              ),
              {
                x: 0.7,
                y: 1.9,
                w: 11.9,
                h: 4.7,
                fontSize: 14,
                border: { color: 'CBD5E1', pt: 0.5 },
                color: '1F2933',
                margin: 0.07
              }
            )
        } else {
          const characters = [...block.text]
          for (let offset = 0; offset < characters.length; offset += 900)
            slide(section.heading).addText(
              characters.slice(offset, offset + 900).join(''),
              {
                x: 0.7,
                y: 1.9,
                w: 11.9,
                h: 4.8,
                fontSize: 20,
                color: '334155',
                margin: 0,
                fit: 'shrink',
                valign: 'top'
              }
            )
        }
      }
      if (section.image) {
        const size = imageSize(section.image),
          ratio = Math.min(11.9 / size.width, 4.8 / size.height),
          w = size.width * ratio,
          h = size.height * ratio
        slide(section.heading).addImage({
          data: `data:${section.image.mime};base64,${section.image.data}`,
          x: 0.7 + (11.9 - w) / 2,
          y: 1.9,
          w,
          h
        })
      }
    }
    const data = await presentation.write({
      outputType: 'nodebuffer',
      compression: false
    })
    return this.output(format, Buffer.from(data as ArrayBuffer))
  }
  private async pdf(
    template: BrandTemplate,
    title: string,
    sections: DocumentSection[]
  ): Promise<Uint8Array> {
    const all = [
      title,
      template.brand,
      template.footer,
      ...sections.flatMap(section => [section.heading, section.text])
    ].join('\n')
    if (
      [...all].some(character => {
        const code = character.codePointAt(0)!
        return code > 0x052f && !(code >= 0x2000 && code <= 0x206f)
      })
    )
      throw new UserError(
        'PDF font coverage is limited to Latin/Greek/Cyrillic and punctuation. Use DOCX/PPTX for lossless text.'
      )
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({
          size: 'A4',
          margin: 48,
          bufferPages: true,
          info: { Title: title, Creator: template.brand }
        }),
        chunks: Buffer[] = []
      let length = 0
      document.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > this.maxBytes) {
          document.destroy()
          reject(new UserError('PDF output exceeds the byte limit.'))
        } else chunks.push(chunk)
      })
      document.on('error', () =>
        reject(new Error('Document rendering failed.'))
      )
      document.on('end', () => resolve(Buffer.concat(chunks)))
      try {
        document.font(
          fileURLToPath(
            new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url)
          )
        )
        document.fillColor(template.accent).fontSize(10).text(template.brand)
        document
          .moveDown()
          .fillColor('1F2933')
          .fontSize(26)
          .text(title)
          .moveDown()
        for (const section of sections) {
          document
            .fontSize(16)
            .fillColor(template.accent)
            .text(section.heading)
            .moveDown(0.4)
            .fillColor('1F2933')
            .fontSize(11)
          for (const block of documentBlocks(section.text)) {
            if (block.kind === 'text')
              document.text(block.text, { lineGap: 4 }).moveDown()
            else {
              const width = (document.page.width - 96) / block.rows[0]!.length
              for (const row of block.rows) {
                const height =
                  Math.max(
                    ...row.map(cell =>
                      document.heightOfString(cell, {
                        width: width - 10,
                        lineGap: 2
                      })
                    )
                  ) + 10
                if (height > document.page.height - 120)
                  throw new UserError(
                    'A table row is too tall for PDF. Use DOCX.'
                  )
                if (document.y + height > document.page.height - 60)
                  document.addPage()
                const y = document.y
                row.forEach((cell, index) => {
                  document
                    .rect(48 + index * width, y, width, height)
                    .lineWidth(0.4)
                    .strokeColor('CBD5E1')
                    .stroke()
                  document.text(cell, 53 + index * width, y + 5, {
                    width: width - 10,
                    height: height - 10,
                    lineGap: 2
                  })
                })
                document.x = 48
                document.y = y + height
              }
              document.moveDown()
            }
          }
          if (section.image) {
            imageSize(section.image)
            if (document.y + 280 > document.page.height - 60) document.addPage()
            document.image(Buffer.from(section.image.data, 'base64'), {
              fit: [document.page.width - 96, 260]
            })
            document.moveDown()
          }
        }
        const range = document.bufferedPageRange()
        for (let index = 0; index < range.count; index++) {
          document.switchToPage(range.start + index)
          document
            .fillColor('637079')
            .fontSize(9)
            .text(
              `${template.footer} · ${index + 1}`,
              48,
              document.page.height - 35,
              { width: document.page.width - 96, height: 14, lineBreak: false }
            )
        }
        document.end()
      } catch (error) {
        document.destroy()
        reject(
          error instanceof Error
            ? error
            : new Error('Document rendering failed.')
        )
      }
    })
  }
}
