import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTable, tableCSV, filterTable, chartValues } from '../table.js'
void test('table parsing preserves quoted commas/newlines, escaped quotes, nulls and exact text without evaluating formulas', () => {
  assert.deepEqual(
    parseTable(
      '\uFEFFName,Value\r\n"A, B","2"\r\n"Quote ""x""","line\nbreak"\n'
    ).rows,
    [
      ['A, B', '2'],
      ['Quote "x"', 'line\nbreak']
    ]
  )
  assert.deepEqual(parseTable('A,B\r1,2\r3,4').rows, [
    ['1', '2'],
    ['3', '4']
  ])
  assert.deepEqual(parseTable('A\n""').rows, [['']])
  assert.deepEqual(parseTable('A\n1\n').columns, ['A'])
  const data = parseTable(
    '{"columns":["Name","Amount"],"rows":[["A","2"],["B",null]]}'
  )
  assert.equal(data.rows[1]![1], null)
  assert.match(
    tableCSV({
      columns: ['X'],
      rows: [
        ['=SUM(A1)'],
        ['+x'],
        ['-1'],
        ['@x'],
        ['\tx'],
        [null],
        ['"quoted"']
      ]
    }),
    /'=SUM/
  )
  for (const raw of [
    '',
    'x'.repeat(1000001),
    '{bad',
    '{}',
    '[]',
    'A,A\n1,2',
    ',B\n1,2',
    'A\n"unclosed',
    'A\n"x"after',
    'A,B\n1',
    '{"columns":[1],"rows":[]}',
    '{"columns":["A"],"rows":[[1]]}',
    'A\n' + '1\n'.repeat(501)
  ])
    assert.throws(() => parseTable(raw))
})
void test('table filters, numeric sorting and chart extraction operate locally with bounded explicit numeric cells', () => {
  const table = {
    columns: ['Name', 'Value'],
    rows: [
      ['B', '10'],
      ['A', '2'],
      ['C', '-3']
    ]
  }
  assert.equal(filterTable(table, '', 1, false).rows[0]![0], 'C')
  assert.equal(filterTable(table, '', 1, true).rows[0]![0], 'B')
  assert.equal(filterTable(table, '', 0, false).rows[0]![0], 'A')
  assert.equal(filterTable(table, 'A', -1, false).rows.length, 1)
  const nullable = {
    columns: ['Label', 'Value'],
    rows: [
      [null, '1'],
      ['A', null]
    ]
  }
  assert.equal(filterTable(nullable, '', 0, false).rows.length, 2)
  assert.equal(
    filterTable(
      { ...nullable, rows: [...nullable.rows].reverse() },
      '',
      0,
      false
    ).rows.length,
    2
  )
  assert.equal(
    chartValues({ ...nullable, rows: [nullable.rows[0]!] }, 0, 1)[0]!.label,
    '(empty)'
  )
  assert.deepEqual(
    chartValues(table, 0, 1).map(item => item.value),
    [10, 2, -3]
  )
  for (const column of [-2, 2, NaN])
    assert.throws(() => filterTable(table, '', column, false))
  assert.throws(() => filterTable(table, 'x'.repeat(201), 0, false))
  assert.throws(() => chartValues(table, 3, 1))
  assert.throws(() => chartValues(table, 0, 3))
  for (const value of [null, '$1', '1,000', '1e3', '1000000000000001'])
    assert.throws(() =>
      chartValues({ columns: ['L', 'V'], rows: [['A', value]] }, 0, 1)
    )
})
