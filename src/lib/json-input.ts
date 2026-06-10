import {readFile} from 'node:fs/promises'

export async function readJsonValue(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8')
  return JSON.parse(text)
}

export async function readJsonObject(file: string): Promise<Record<string, any>> {
  const value = await readJsonValue(file)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} must contain a JSON object.`)
  }

  return value as Record<string, any>
}

export async function readJsonArray(file: string): Promise<unknown[]> {
  const value = await readJsonValue(file)
  if (!Array.isArray(value)) {
    throw new Error(`${file} must contain a JSON array.`)
  }

  return value
}
