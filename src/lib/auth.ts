import crypto from 'node:crypto'
import open from 'open'
import {Client} from './client.js'
import {resolveCompanySlug, resolveHost, writeConfig, writeToken, type StoredToken} from './config.js'

export const DEFAULT_SCOPES = [
  'customer.orders.read',
  'customer.returns.read',
  'customer.returns.create',
  'customer.address.read',
]

export interface LoginOptions {
  host?: string
  companySlug?: string
  email: string
  agentName?: string
  scopes?: string[]
  openBrowser?: boolean
}

interface AuthorizationStart {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
  scopes: string[]
  delivery?: string
}

export async function customerLogin(opts: LoginOptions): Promise<StoredToken> {
  const host = await resolveHost(opts.host)
  const companySlug = await resolveCompanySlug(opts.companySlug)
  const client = await Client.create({host, companySlug, token: null})
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())

  const start = await client.mcpPost<AuthorizationStart>('/customer_authorizations', {
    email: opts.email,
    agent_name: opts.agentName || 'Buckmason CLI',
    requested_scopes: opts.scopes?.length ? opts.scopes : DEFAULT_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    source: 'buckmason-cli',
  })

  process.stderr.write(`\nSecurity code: ${start.user_code}\n`)
  process.stderr.write(`If ${opts.email} belongs to a Buck Mason customer, PIMA sent a magic link. Open it and click "Authorize your agent".\n`)

  if (opts.openBrowser !== false && start.verification_uri && !start.verification_uri.includes('EMAIL_LINK_ONLY')) {
    try {
      await open(start.verification_uri_complete ?? start.verification_uri)
    } catch {
      /* Email link remains the primary path. */
    }
  }

  const deadline = Date.now() + start.expires_in * 1000
  let interval = start.interval || 5

  while (Date.now() < deadline) {
    await sleep(interval * 1000)
    const res = await fetch(`${host}/mcp/${companySlug}/customer_authorizations/token`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'buckmason-cli/0.1'},
      body: JSON.stringify({device_code: start.device_code, code_verifier: verifier}),
    })
    const body = (await res.json()) as Record<string, any>
    if (res.ok && body.access_token) {
      const token: StoredToken = {
        access_token: body.access_token,
        token_type: 'Bearer',
        expires_at: body.expires_in ? Math.floor(Date.now() / 1000) + body.expires_in : undefined,
        scopes: body.scopes || start.scopes,
        company: body.company,
        company_slug: body.company_slug,
        customer: body.customer,
      }
      await writeToken(host, companySlug, token)
      await writeConfig({host, companySlug})
      return token
    }

    if (body.error === 'authorization_pending') continue
    if (body.error === 'slow_down') {
      interval += 5
      continue
    }
    if (body.error === 'access_denied') throw new Error('Authorization was denied.')
    if (body.error === 'expired_token') throw new Error('Authorization expired. Run login again.')
    throw new Error(`Authorization failed: ${body.error ?? res.status}`)
  }

  throw new Error('Timed out waiting for authorization.')
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
