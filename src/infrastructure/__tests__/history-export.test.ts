import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

let output = '%PDF-mocked'
let fail = false
let font = ''
let content = ''
let destroyed = 0
mock.module('pdfkit', {
  exports: {
    default: class extends EventEmitter {
      font(value: string) {
        font = value
        return this
      }
      fontSize(value: number) {
        assert.equal(value, 11)
        return this
      }
      text(value: string, options: { lineGap: number }) {
        content = value
        assert.equal(options.lineGap, 4)
        return this
      }
      end() {
        if (fail) this.emit('error', new Error('private font path'))
        else {
          this.emit('data', Buffer.from(output))
          this.emit('end')
        }
      }
      destroy() {
        destroyed++
      }
    }
  }
})
const { HistoryExport } = await import('../history-export.js')

void test('Markdown and JSON exports retain owned text and media metadata without rendering assets', () => {
  const exporter = new HistoryExport(10000)
  const messages = [
    {
      role: 'user' as const,
      content: 'Question',
      documents: [
        { name: 'terms.pdf', mime: 'application/pdf', data: 'private-bytes' }
      ],
      images: [{ data: 'private-image', mime: 'image/png' as const }]
    },
    { role: 'assistant' as const, content: 'Answer with sources.' }
  ]
  const markdown = exporter.markdown('Work', messages).toString()
  assert.match(markdown, /# Work/)
  assert.match(markdown, /## User/)
  assert.match(markdown, /## Assistant/)
  assert.match(markdown, /Document: terms.pdf/)
  assert.match(markdown, /Image 1: image\/png/)
  assert.ok(!markdown.includes('private-bytes'))
  assert.equal(
    (
      JSON.parse(exporter.json({ messages }).toString()) as {
        messages: unknown[]
      }
    ).messages.length,
    2
  )
  assert.throws(() => new HistoryExport(1).json({ too: 'large' }), /size limit/)
})
void test('PDF delegates layout and the bundled font through a mocked renderer and enforces output bounds', async () => {
  const exporter = new HistoryExport(10000)
  assert.equal(
    (
      await exporter.pdf('Work', [
        { role: 'user', content: 'English — Ελληνικά' }
      ])
    ).toString(),
    output
  )
  assert.ok(font.endsWith('assets/fonts/NotoSans-Regular.ttf'))
  assert.ok(content.includes('English'))
  await assert.rejects(exporter.pdf('Emoji 🌍', []), /lossless/)
  await assert.rejects(exporter.pdf('Arrow →', []), /lossless/)
  output = 'x'.repeat(1000)
  await assert.rejects(new HistoryExport(100).pdf('Work', []), /size limit/)
  assert.equal(destroyed, 1)
  fail = true
  await assert.rejects(exporter.pdf('Work', []), /PDF export failed/)
})
