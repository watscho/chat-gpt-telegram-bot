import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  structuredSpec,
  structuredSchema,
  structuredArtifact
} from '../structured.js'
void test('structured output schema and local validation enforce exact nullable text fields without paid repairs', () => {
  for (const [format, fields] of [
    ['bad', ['name']],
    ['json', []],
    ['csv', ['name', 'name']],
    ['json', ['Bad']],
    ['json', ['']],
    ['json', ['x'.repeat(33)]],
    ['json', Array.from({ length: 11 }, (_, index) => `f${index}`)]
  ] as [string, string[]][])
    assert.throws(() => structuredSpec(format, fields))
  const spec = structuredSpec('json', ['name', 'amount'])
  assert.equal(structuredSchema(spec).additionalProperties, false)
  const artifact = structuredArtifact(
    '{"rows":[{"name":"First","amount":null}]}',
    spec,
    10000
  )
  assert.equal(artifact.rows, 1)
  assert.equal(artifact.mime, 'application/json')
  assert.equal(
    (
      JSON.parse(Buffer.from(artifact.data, 'base64').toString()) as {
        rows: { amount: string | null }[]
      }
    ).rows[0]!.amount,
    null
  )
  for (const raw of [
    'bad',
    'null',
    '[]',
    '{"other":[]}',
    '{"rows":[],"extra":1}',
    '{"rows":{}}',
    JSON.stringify({
      rows: Array.from({ length: 101 }, () => ({ name: 'x', amount: '1' }))
    }),
    '{"rows":[null]}',
    '{"rows":[[]]}',
    '{"rows":[{}]}',
    '{"rows":[{"name":"x","wrong":"1"}]}',
    '{"rows":[{"name":1,"amount":"1"}]}',
    JSON.stringify({ rows: [{ name: 'x'.repeat(2001), amount: '1' }] })
  ])
    assert.throws(() => structuredArtifact(raw, spec, 10000))
  assert.throws(() => structuredArtifact('x'.repeat(2000001), spec, 10000))
  assert.throws(() => structuredArtifact('{"rows":[]}', spec, 1), /size limit/)
})
void test('CSV serialization quotes cells, preserves newlines and neutralizes common spreadsheet formula prefixes', () => {
  const spec = structuredSpec('csv', ['name', 'value'])
  const artifact = structuredArtifact(
    JSON.stringify({
      rows: [
        { name: 'Hello "world"\nNext', value: ' =SUM(A1)' },
        { name: null, value: '-2' }
      ]
    }),
    spec,
    10000
  )
  assert.equal(artifact.mime, 'text/csv')
  assert.equal(artifact.rows, 2)
  assert.equal(
    Buffer.from(artifact.data, 'base64').toString(),
    '"name","value"\r\n"Hello ""world""\nNext","\' =SUM(A1)"\r\n"","\'-2"'
  )
})

void test('CSV prefix filtering also handles leading controls and blank cells', () => {
  const artifact = structuredArtifact(
    JSON.stringify({ rows: [{ value: '\t=1' }, { value: '   ' }] }),
    structuredSpec('csv', ['value']),
    10000
  )
  assert.ok(Buffer.from(artifact.data, 'base64').toString().includes("'\t=1"))
})
