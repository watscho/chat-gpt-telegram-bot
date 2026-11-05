import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mockZip, zipDouble, zipEntry, zipBytes } from '../../__tests__/zip.js'
import type { Image } from '../../domain/conversation.js'
mockZip()
const wordNodes: { type: string; options: unknown }[] = []
let wordOutput = Buffer.from('unit-docx'),
  presentationOutput = Buffer.from('unit-pptx')
const nodeClass = (type: string) =>
  class {
    constructor(options: unknown) {
      wordNodes.push({ type, options })
    }
  }
mock.module('docx', {
  namedExports: {
    Document: nodeClass('document'),
    Paragraph: nodeClass('paragraph'),
    TextRun: nodeClass('text'),
    Header: nodeClass('header'),
    Footer: nodeClass('footer'),
    Table: nodeClass('table'),
    TableRow: nodeClass('row'),
    TableCell: nodeClass('cell'),
    ImageRun: nodeClass('image'),
    WidthType: { PERCENTAGE: 'pct' },
    Packer: { toBuffer: () => Promise.resolve(wordOutput) }
  }
})
const slides: { type: string; value: unknown; options: unknown }[] = []
mock.module('pptxgenjs', {
  defaultExport: class {
    addSlide() {
      return {
        addText: (value: unknown, options: unknown) => {
          slides.push({ type: 'text', value, options })
        },
        addImage: (options: unknown) => {
          slides.push({ type: 'image', value: null, options })
        },
        addTable: (value: unknown, options: unknown) => {
          slides.push({ type: 'table', value, options })
        }
      }
    }
    write() {
      return Promise.resolve(presentationOutput)
    }
  }
})
const pdfState = {
  height: 20,
  y: 70,
  error: false,
  output: Buffer.from('unit-pdf'),
  destroyed: 0,
  pages: 0,
  failFont: false,
  nonError: false
}
class FakePdf extends EventEmitter {
  page = { width: 595, height: 842 }
  x = 48
  y = pdfState.y
  font() {
    if (pdfState.nonError) throw JSON.parse('null') as unknown
    if (pdfState.failFont) throw new Error('Font unavailable')
    return this
  }
  fillColor() {
    return this
  }
  fontSize() {
    return this
  }
  text() {
    return this
  }
  moveDown() {
    return this
  }
  rect() {
    return this
  }
  lineWidth() {
    return this
  }
  strokeColor() {
    return this
  }
  stroke() {
    return this
  }
  image() {
    return this
  }
  heightOfString() {
    return pdfState.height
  }
  addPage() {
    pdfState.pages++
    this.y = 48
    return this
  }
  bufferedPageRange() {
    return { start: 0, count: 2 }
  }
  switchToPage() {
    return this
  }
  destroy() {
    pdfState.destroyed++
  }
  end() {
    if (pdfState.error) this.emit('error', new Error('renderer details'))
    else {
      this.emit('data', pdfState.output)
      this.emit('end')
    }
  }
}
mock.module('pdfkit', { defaultExport: FakePdf })
const {
  BrandedDocuments,
  documentBlocks,
  imageSize,
  annotateScreenshot,
  templateFromDocument
} = await import('../branded-documents.js')
const template = {
  name: 'default',
  revision: 1,
  brand: 'Example',
  accent: '287F78',
  font: 'Noto Sans',
  footer: 'Review draft',
  headings: []
}
function png(width = 200, height = 100): Image {
  const data = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data)
  data.write('IHDR', 12)
  data.writeUInt32BE(width, 16)
  data.writeUInt32BE(height, 20)
  return { mime: 'image/png', data: data.toString('base64') }
}
function jpeg(width = 200, height = 100): Image {
  const data = Buffer.from([255, 216, 255, 192, 0, 8, 8, 0, 0, 0, 0, 0])
  data.writeUInt16BE(height, 7)
  data.writeUInt16BE(width, 9)
  return { mime: 'image/jpeg', data: data.toString('base64') }
}
const table = '| Name | Value |\n| --- | --- |\n| A | 10 |'
void test('document blocks preserve invalid Markdown and bound actual editable tables', () => {
  assert.equal(documentBlocks(`Intro\n${table}\nEnd`)[1]!.kind, 'table')
  for (const text of [
    '| A |',
    '| A |\n| B | C |',
    `${'| A |\n'.repeat(31)}`,
    `| ${'A |'.repeat(9)}\n| ${'B |'.repeat(9)}`,
    `| A |\n| ${'x'.repeat(301)} |`,
    '| --- |'
  ])
    assert.ok(documentBlocks(text).every(block => block.kind === 'text'))
  assert.deepEqual(documentBlocks('Plain\ntext'), [
    { kind: 'text', text: 'Plain\ntext' }
  ])
})
void test('preserved-image artifacts validate raster dimensions and escape every annotation without executing image decoders', () => {
  assert.deepEqual(imageSize(png()), { width: 200, height: 100 })
  assert.deepEqual(imageSize(jpeg()), { width: 200, height: 100 })
  for (const image of [
    png(0),
    png(1, 0),
    png(8193, 1),
    png(1, 8193),
    png(5000, 5000),
    { ...png(), mime: 'image/jpeg' as const },
    {
      mime: 'image/webp' as const,
      data: Buffer.from('RIFF0000WEBP').toString('base64')
    },
    {
      mime: 'image/png' as const,
      data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')
    }
  ])
    assert.throws(() => imageSize(image))
  const wrongHeader = Buffer.from(png().data, 'base64')
  wrongHeader.write('NOPE', 12)
  assert.throws(() =>
    imageSize({ mime: 'image/png', data: wrongHeader.toString('base64') })
  )
  const images = [
    [255, 216, 255, 224, 0, 2, 1, 1, 1, 1, 1],
    [255, 216, 255, 224, 0, 2, 1, 1, 1, 1],
    [255, 216, 255, 224, 0, 1, 1, 1],
    [255, 216, 255, 224, 0, 20, 1],
    [255, 216, 255, 192, 0, 2, 1, 1],
    [255, 216, 255, 255, 255, 255, 255, 255],
    [255, 216, 255, 224, 0, 2, 255, 192, 0, 8, 8, 0, 100, 0, 200, 0]
  ]
  for (const bytes of images.slice(0, -1))
    assert.throws(() =>
      imageSize({
        mime: 'image/jpeg',
        data: Buffer.from(bytes).toString('base64')
      })
    )
  assert.deepEqual(
    imageSize({
      mime: 'image/jpeg',
      data: Buffer.from(images.at(-1)!).toString('base64')
    }),
    { width: 200, height: 100 }
  )
  const row = {
      x: '10',
      y: '20',
      width: '100',
      height: '200',
      label: '<&>"\'',
      action: '<script>bad()</script>'
    },
    result = annotateScreenshot(png(), [row], 10000),
    svg = Buffer.from(result.data, 'base64').toString()
  assert.match(svg, /&lt;script&gt;/)
  assert.doesNotMatch(svg, /<script>/)
  assert.match(svg, /data:image\/png;base64/)
  for (const rows of [
    [],
    Array(13).fill(row),
    [{ ...row, x: null }],
    [{ ...row, x: 'no' }],
    [{ ...row, width: '0' }],
    [{ ...row, height: '0' }],
    [{ ...row, x: '1000' }],
    [{ ...row, y: '1000' }],
    [{ ...row, label: null }],
    [{ ...row, label: 'x'.repeat(81) }]
  ])
    assert.throws(() =>
      annotateScreenshot(
        png(),
        rows as import('../../domain/suite.js').SuiteRow[],
        10000
      )
    )
  assert.throws(() => annotateScreenshot(png(), [row], 1), /export limit/)
  assert.ok(
    annotateScreenshot(png(4000, 100), [{ ...row, action: null }], 10000).data
  )
})
void test('reference templates extract bounded palette, font and headings from allowlisted XML without parsing external entities', async () => {
  const file = {
    name: 'brand.docx',
    mime: 'application/octet-stream',
    get data() {
      return zipBytes().toString('base64')
    }
  }
  await assert.rejects(
    templateFromDocument({ ...file, name: 'brand.pdf' }, 'company', 100000),
    /DOCX/
  )
  for (const text of ['', '<!DOCTYPE x>', '<!ENTITY x>', 'x'.repeat(2000001)]) {
    zipDouble.entries = [['word/document.xml', zipEntry(text)]]
    await assert.rejects(templateFromDocument(file, 'company', 3000000), /XML/)
  }
  zipDouble.entries = [
    [
      'word/document.xml',
      zipEntry(
        '<w:rFonts w:ascii="Example Font"/><w:color w:val="abcdef"/><w:t>Company &amp; &lt;name&gt;</w:t>'
      )
    ],
    ['ignored.xml', zipEntry('Ignored')]
  ]
  const word = await templateFromDocument(file, 'company', 10000)
  assert.equal(word.accent, 'ABCDEF')
  assert.equal(word.font, 'Example Font')
  assert.equal(word.brand, 'Company & <name>')
  zipDouble.entries = [
    [
      'ppt/theme/theme1.xml',
      zipEntry(
        '<a:accent1><a:srgbClr val="123456"/></a:accent1><a:latin typeface="Slide Font"/><a:t>Slides</a:t>'
      )
    ]
  ]
  const pptx = await templateFromDocument(
    { ...file, name: 'brand.PPTX' },
    'company',
    10000
  )
  assert.equal(pptx.accent, '123456')
  assert.equal(pptx.font, 'Slide Font')
  zipDouble.entries = [['word/styles.xml', zipEntry('<styles/>')]]
  const fallback = await templateFromDocument(file, 'fallback', 10000)
  assert.equal(fallback.brand, 'fallback')
  assert.equal(fallback.accent, '287F78')
  assert.equal(fallback.font, 'Noto Sans')
})
void test('document adapters generate editable Word/PowerPoint structures and preserved images through mocked libraries only', async () => {
  const documents = new BrandedDocuments(1000000),
    sections = [
      { heading: 'Evidence', text: `Intro\n${table}\nEnd`, image: png() },
      { heading: 'Second', text: 'Text', image: jpeg() }
    ]
  assert.equal(
    (await documents.render(template, 'docx', 'Report', sections)).name,
    'report.docx'
  )
  assert.ok(wordNodes.some(node => node.type === 'table'))
  assert.ok(wordNodes.some(node => node.type === 'image'))
  assert.equal(
    (await documents.render(template, 'pptx', 'Report', sections)).name,
    'report.pptx'
  )
  assert.ok(slides.some(slide => slide.type === 'table'))
  assert.ok(slides.some(slide => slide.type === 'image'))
  await documents.render(template, 'docx', 'Short', [
    { heading: 'Text', text: 'Plain' }
  ])
  await documents.render(template, 'pptx', 'Short', [
    { heading: 'Text', text: 'Plain' }
  ])
  for (const [title, content] of [
    ['', sections],
    ['x'.repeat(201), sections],
    ['Report', []],
    ['Report', Array(21).fill(sections[0])],
    ['Report', [{ heading: '', text: 'x'.repeat(16001) }]],
    [
      'Report',
      [
        {
          heading: '',
          text: '',
          image: { mime: 'image/png', data: 'x'.repeat(500001) }
        }
      ]
    ]
  ] as [string, typeof sections][])
    await assert.rejects(documents.render(template, 'docx', title, content))
  wordOutput = Buffer.alloc(0)
  await assert.rejects(
    documents.render(template, 'docx', 'Title', [{ heading: '', text: '' }]),
    /output/
  )
  wordOutput = Buffer.from('unit-docx')
  presentationOutput = Buffer.alloc(1000001)
  await assert.rejects(
    documents.render(template, 'pptx', 'Title', [{ heading: '', text: '' }]),
    /output/
  )
  presentationOutput = Buffer.from('unit-pptx')
  await assert.rejects(
    documents.render(
      template,
      'pptx',
      'Long',
      Array.from({ length: 20 }, () => ({
        heading: '',
        text: `${table}\nText\n${table}\nText`
      }))
    ),
    /32 slides/
  )
})
void test('PDF adapter paginates measured tables, preserves screenshots and bounds streams with deterministic cleanup', async () => {
  const documents = new BrandedDocuments(10000),
    sections = [{ heading: 'Evidence', text: table, image: png() }]
  pdfState.y = 770
  assert.equal(
    (await documents.render(template, 'pdf', 'Report', sections)).name,
    'report.pdf'
  )
  assert.ok(pdfState.pages > 0)
  pdfState.y = 770
  await documents.render(template, 'pdf', 'Image only', [
    { heading: '', text: '', image: png() }
  ])
  pdfState.y = 70
  await documents.render(template, 'pdf', 'Greek Ελληνικά Русский —', [
    { heading: 'Text', text: 'Text' }
  ])
  await documents.render(template, 'pdf', 'Report', [
    { heading: '', text: '', image: png() }
  ])
  await assert.rejects(
    documents.render(template, 'pdf', '日本語', sections),
    /font coverage/
  )
  pdfState.height = 900
  await assert.rejects(
    documents.render(template, 'pdf', 'Report', sections),
    /too tall/
  )
  pdfState.height = 20
  pdfState.nonError = true
  await assert.rejects(
    documents.render(template, 'pdf', 'Report', sections),
    /rendering failed/
  )
  pdfState.nonError = false
  pdfState.failFont = true
  await assert.rejects(
    documents.render(template, 'pdf', 'Report', sections),
    /Font unavailable/
  )
  pdfState.failFont = false
  pdfState.error = true
  await assert.rejects(
    documents.render(template, 'pdf', 'Report', sections),
    /rendering failed/
  )
  pdfState.error = false
  pdfState.output = Buffer.alloc(10001)
  await assert.rejects(
    documents.render(template, 'pdf', 'Report', sections),
    /byte limit/
  )
  assert.ok(pdfState.destroyed >= 3)
  pdfState.output = Buffer.from('unit-pdf')
})
void test('Suite asset composition delegates bounded operations to the independently mocked adapters', async () => {
  const { suiteAssets } = await import('../suite-assets.js'),
    { config } = await import('../../__tests__/helpers.js'),
    assets = suiteAssets(config())
  zipDouble.entries = [['word/document.xml', zipEntry('<w:t>Brand</w:t>')]]
  assert.equal((await assets.archive(zipBytes())).items.length, 1)
  assert.ok(
    (await assets.package([{ name: 'a.txt', data: Uint8Array.of(1) }])).length
  )
  assert.equal(
    (
      await assets.document(template, 'docx', 'Review', [
        { heading: 'One', text: 'Text' }
      ])
    ).name,
    'report.docx'
  )
  assert.equal(
    (
      await assets.annotate(png(), [
        {
          x: '1',
          y: '1',
          width: '10',
          height: '10',
          label: 'One',
          action: 'Review'
        }
      ])
    ).name,
    'annotated-screen.svg'
  )
  assert.equal(
    (
      await assets.template(
        {
          name: 'brand.docx',
          mime: 'application/octet-stream',
          data: zipBytes().toString('base64')
        },
        'company'
      )
    ).name,
    'company'
  )
  await assert.rejects(
    assets.video(
      Uint8Array.of(1),
      {
        file: 'id',
        name: 'bad.mp4',
        bytes: null,
        seconds: null,
        start: 0,
        audio: false
      },
      new AbortController().signal
    ),
    /bounded MP4/
  )
})
