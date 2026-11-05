import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
let pages = 2,
  fail = false,
  destroyed = 0,
  long = false
mock.module('pdfjs-dist/legacy/build/pdf.mjs', {
  exports: {
    getDocument: () => ({
      promise: fail
        ? Promise.reject(new Error('private'))
        : Promise.resolve({
            numPages: pages,
            getPage: () =>
              Promise.resolve({
                getTextContent: () =>
                  Promise.resolve({
                    items: [
                      { str: long ? 'x'.repeat(1000001) : 'Page text' },
                      { type: 'markedContent' }
                    ]
                  })
              })
          }),
      destroy: () => {
        destroyed++
        return Promise.resolve()
      }
    })
  }
})
const { extractDocumentText } = await import('../document-text.js')
const file = {
  name: 'text.txt',
  mime: 'text/plain',
  data: Buffer.from('First\nSecond').toString('base64')
}
void test('document extraction handles text and PDF page contracts without native rendering', async () => {
  assert.deepEqual(await extractDocumentText(file), [
    { location: 'line 1', text: 'First' },
    { location: 'line 2', text: 'Second' }
  ])
  const pdf = { ...file, name: 'TEXT.PDF' }
  assert.deepEqual(await extractDocumentText(pdf), [
    { location: 'page 1', text: 'Page text ' },
    { location: 'page 2', text: 'Page text ' }
  ])
  pages = 501
  await assert.rejects(extractDocumentText(pdf), /500 pages/)
  pages = 2
  long = true
  await assert.rejects(extractDocumentText(pdf), /million/)
  long = false
  fail = true
  await assert.rejects(extractDocumentText(pdf), /Unable to extract/)
  assert.equal(destroyed, 4)
  await assert.rejects(
    extractDocumentText({ ...file, name: 'a.docx' }),
    /Office/
  )
  await assert.rejects(
    extractDocumentText({
      ...file,
      data: Buffer.from([255]).toString('base64')
    }),
    /UTF-8/
  )
  await assert.rejects(
    extractDocumentText({
      ...file,
      data: Buffer.alloc(10000001).toString('base64')
    }),
    /10 MB/
  )
  await assert.rejects(
    extractDocumentText({
      ...file,
      data: Buffer.from('x'.repeat(1000001)).toString('base64')
    }),
    /million/
  )
})

void test('PDF module loading accepts the package default namespace form', async () => {
  const getDocument = () => ({
    promise: Promise.resolve({ numPages: 0 }),
    destroy: () => Promise.resolve()
  })
  mock.restoreAll()
  mock.module('pdfjs-dist/legacy/build/pdf.mjs', {
    exports: { default: { __esModule: true, getDocument }, getDocument }
  })
  assert.deepEqual(
    await extractDocumentText({ ...file, name: 'empty.pdf' }),
    []
  )
})
