import { UserError } from './conversation.js'
export interface TableView {
  columns: string[]
  rows: (string | null)[][]
}
export function parseTable(raw: string): TableView {
  if (raw.length > 1000000) throw new UserError('Table input exceeds 1 MB.')
  let columns: string[], rows: (string | null)[][]
  if (raw.trimStart().startsWith('{') || raw.trimStart().startsWith('[')) {
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new UserError('Invalid table JSON.')
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !('columns' in value) ||
      !('rows' in value) ||
      !Array.isArray(value.columns) ||
      !Array.isArray(value.rows)
    )
      throw new UserError('JSON tables need columns and rows arrays.')
    columns = value.columns as string[]
    rows = value.rows as (string | null)[][]
  } else {
    const data: string[][] = [],
      row: string[] = []
    let field = '',
      quoted = false,
      closed = false
    const input = raw.replace(/^\uFEFF/, '')
    for (let i = 0; i < input.length; i++) {
      const c = input[i]!
      if (quoted) {
        if (c === '"') {
          if (input[i + 1] === '"') {
            field += '"'
            i++
          } else {
            quoted = false
            closed = true
          }
        } else field += c
      } else if (c === '"' && !field && !closed) quoted = true
      else if (c === ',' || c === '\n' || c === '\r') {
        row.push(field)
        field = ''
        closed = false
        if (c !== ',') {
          if (c === '\r' && input[i + 1] === '\n') i++
          data.push(row.splice(0))
          if (data.length > 501)
            throw new UserError('Use at most 500 data rows.')
        }
      } else {
        if (closed)
          throw new UserError('Unexpected text after a quoted CSV field.')
        field += c
      }
    }
    if (quoted) throw new UserError('Unclosed CSV quote.')
    if (field || row.length || closed) {
      row.push(field)
      data.push(row)
    }
    columns = data.shift() ?? []
    rows = data
  }
  if (
    !columns.length ||
    columns.length > 20 ||
    columns.some(
      value => typeof value !== 'string' || !value.trim() || value.length > 80
    ) ||
    new Set(columns).size !== columns.length ||
    rows.length > 500 ||
    rows.some(
      row =>
        !Array.isArray(row) ||
        row.length !== columns.length ||
        row.some(
          value =>
            value !== null && (typeof value !== 'string' || value.length > 2000)
        )
    )
  )
    throw new UserError(
      'Use 1..20 unique columns and at most 500 rectangular text/null rows.'
    )
  return { columns, rows }
}
export function tableCSV(table: TableView): string {
  return [table.columns, ...table.rows]
    .map(row =>
      row
        .map(
          value =>
            '"' +
            (value === null
              ? ''
              : /^[=+\-@\t\r\n]/.test(value)
                ? "'" + value
                : value
            ).replaceAll('"', '""') +
            '"'
        )
        .join(',')
    )
    .join('\r\n')
}
export function filterTable(
  table: TableView,
  query: string,
  column: number,
  descending: boolean
): TableView {
  if (
    query.length > 200 ||
    !Number.isSafeInteger(column) ||
    column < -1 ||
    column >= table.columns.length
  )
    throw new UserError('Choose a valid filter and sort column.')
  const rows = table.rows.filter(row =>
    row.some(value => (value ?? '').toLowerCase().includes(query.toLowerCase()))
  )
  if (column >= 0)
    rows.sort((a, b) => {
      const x = a[column] ?? '',
        y = b[column] ?? '',
        numeric = /^-?\d+(?:\.\d+)?$/
      return (
        (numeric.test(x) && numeric.test(y)
          ? Number(x) - Number(y)
          : x.localeCompare(y)) * (descending ? -1 : 1)
      )
    })
  return { columns: table.columns, rows }
}
export function chartValues(
  table: TableView,
  label: number,
  value: number
): { label: string; value: number }[] {
  if (!table.columns[label] || !table.columns[value])
    throw new UserError('Choose label and numeric value columns.')
  return table.rows.slice(0, 50).map(row => {
    const raw = row[value]
    if (
      raw === null ||
      raw === undefined ||
      !/^-?\d+(?:\.\d+)?$/.test(raw) ||
      !Number.isFinite(Number(raw)) ||
      Math.abs(Number(raw)) > 1e15
    )
      throw new UserError(
        'Chart values must be explicit finite numeric cells, without currency symbols or ambiguous separators.'
      )
    return { label: row[label] ?? '(empty)', value: Number(raw) }
  })
}
