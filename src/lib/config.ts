import os from 'node:os'
import path from 'node:path'
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'

export const DEFAULT_HOST = 'https://pima.io'
export const DEFAULT_COMPANY_SLUG = 'buckmason'

export interface StoredConfig {
  host?: string
  companySlug?: string
}

export interface StoredToken {
  access_token: string
  token_type: 'Bearer'
  expires_at?: number
  scopes: string[]
  company?: string
  company_slug?: string
  customer?: {email?: string; name?: string}
  source?: 'env'
}

export function configDir(): string {
  return process.env.BUCKMASON_CONFIG_DIR || path.join(os.homedir(), '.buckmason')
}

export async function readConfig(): Promise<StoredConfig> {
  try {
    return JSON.parse(await readFile(path.join(configDir(), 'config.json'), 'utf8')) as StoredConfig
  } catch {
    return {}
  }
}

export async function writeConfig(config: StoredConfig): Promise<void> {
  await mkdir(configDir(), {recursive: true})
  const current = await readConfig()
  await writeFile(path.join(configDir(), 'config.json'), JSON.stringify({...current, ...config}, null, 2))
}

export async function resolveHost(host?: string): Promise<string> {
  const config = await readConfig()
  return normalizeHost(host || process.env.BUCKMASON_HOST || config.host || DEFAULT_HOST)
}

export async function resolveCompanySlug(slug?: string): Promise<string> {
  const config = await readConfig()
  return slug || process.env.BUCKMASON_COMPANY_SLUG || config.companySlug || DEFAULT_COMPANY_SLUG
}

export function resolvePimaKey(key?: string): string {
  const resolved = key || process.env.BUCKMASON_PIMA_KEY
  if (!resolved) {
    throw new Error('Missing PIMA public API key. Pass --key or set BUCKMASON_PIMA_KEY.')
  }
  return resolved
}

export async function readToken(host: string, companySlug: string): Promise<StoredToken | null> {
  if (process.env.BUCKMASON_TOKEN) {
    return {access_token: process.env.BUCKMASON_TOKEN, token_type: 'Bearer', scopes: [], source: 'env'}
  }

  try {
    return JSON.parse(await readFile(tokenPath(host, companySlug), 'utf8')) as StoredToken
  } catch {
    return null
  }
}

export async function writeToken(host: string, companySlug: string, token: StoredToken): Promise<void> {
  await mkdir(path.dirname(tokenPath(host, companySlug)), {recursive: true})
  await writeFile(tokenPath(host, companySlug), JSON.stringify(token, null, 2))
}

export async function deleteToken(host: string, companySlug: string): Promise<boolean> {
  try {
    await rm(tokenPath(host, companySlug))
    return true
  } catch {
    return false
  }
}

function tokenPath(host: string, companySlug: string): string {
  const key = createHash('sha256').update(`${host}:${companySlug}`).digest('hex').slice(0, 16)
  return path.join(configDir(), 'tokens', `${key}.json`)
}

function normalizeHost(host: string): string {
  return host.replace(/\/+$/, '')
}
