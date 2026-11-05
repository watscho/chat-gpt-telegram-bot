import { UserError } from '../domain/conversation.js'
import type { StructuredSpec, Artifact } from '../domain/conversation.js'

export function structuredSpec(
  format: string,
  fields: string[]
): StructuredSpec {
  if (
    !['csv', 'json'].includes(format) ||
    !fields.length ||
    fields.length > 10 ||
    new Set(fields).size !== fields.length ||
    fields.some(field => !/^[a-z][a-z0-9_]{0,31}$/.test(field))
  )
    throw new UserError(
      'Use csv or json and 1..10 unique lowercase field names (letters, digits, underscores).'
    )
  return { format: format as 'csv' | 'json', fields }
}
export function structuredSchema(
  spec: StructuredSpec
): Record<string, unknown> {
  structuredSpec(spec.format, spec.fields)
  return {
    type: 'object',
    properties: {
      rows: {
        type: 'array',
        items: {
          type: 'object',
          properties: Object.fromEntries(
            spec.fields.map(field => [field, { type: ['string', 'null'] }])
          ),
          required: spec.fields,
          additionalProperties: false
        }
      }
    },
    required: ['rows'],
    additionalProperties: false
  }
}
export function structuredArtifact(
  raw: string,
  spec: StructuredSpec,
  maxBytes: number
): Artifact {
  structuredSpec(spec.format, spec.fields)
  if (raw.length > 2000000)
    throw new UserError('Structured response exceeds the validation limit.')
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new UserError(
      'The provider did not return valid structured JSON. No automatic paid retry was made.'
    )
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('rows' in value) ||
    !Array.isArray(value.rows) ||
    value.rows.length > 100
  )
    throw new UserError(
      'Structured output must contain only rows (maximum 100).'
    )
  const rows = value.rows as unknown[]
  for (const row of rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).length !== spec.fields.length ||
      spec.fields.some(
        field =>
          !Object.hasOwn(row, field) ||
          ((row as Record<string, unknown>)[field] !== null &&
            (typeof (row as Record<string, unknown>)[field] !== 'string' ||
              (row as Record<string, string>)[field]!.length > 2000))
      )
    )
      throw new UserError(
        'Structured rows do not match the requested fields or cell limits.'
      )
  }
  const cell = (value: unknown) => {
    const text = value === null ? '' : (value as string)
    let start = 0
    while (
      start < text.length &&
      (text.charCodeAt(start) < 32 || /\s/.test(text[start]!))
    )
      start++
    const safe = /^[=+@-]/.test(text.slice(start)) ? `'${text}` : text
    return `"${safe.replaceAll('"', '""')}"`
  }
  const content =
    spec.format === 'json'
      ? JSON.stringify({ rows }, null, 2)
      : [
          spec.fields.map(cell).join(','),
          ...rows.map(row =>
            spec.fields
              .map(field => cell((row as Record<string, unknown>)[field]))
              .join(',')
          )
        ].join('\r\n')
  const bytes = Buffer.from(content)
  if (bytes.length > maxBytes)
    throw new UserError('Structured export exceeds the configured size limit.')
  return {
    rows: rows.length,
    name: `result.${spec.format}`,
    mime: spec.format === 'json' ? 'application/json' : 'text/csv',
    data: bytes.toString('base64')
  }
}
