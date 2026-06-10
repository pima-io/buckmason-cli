import Table from 'cli-table3'

export type OutputFormat = 'table' | 'json'

export function printJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function renderRecords(records: any[], columns: string[], format: OutputFormat): string {
  if (format === 'json') return printJson(records)

  const table = new Table({head: columns})
  for (const record of records) table.push(columns.map((column) => formatCell(record[column])))
  return table.toString()
}

export function renderKeyValues(record: Record<string, unknown>, format: OutputFormat): string {
  if (format === 'json') return printJson(record)

  const table = new Table()
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === 'object') continue
    table.push({[key]: formatCell(value)})
  }
  return table.toString()
}

export function formatMoney(cents?: number | null): string {
  if (cents == null) return ''
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
}

function formatCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    const object = value as any
    return object.label ?? object.name ?? object.code ?? JSON.stringify(value)
  }
  return String(value)
}
