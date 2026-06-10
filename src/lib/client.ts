import {readToken, resolveCompanySlug, resolveHost, resolvePimaKey, type StoredToken} from './config.js'

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public headers: Record<string, string> = {},
  ) {
    super(typeof body === 'string' ? body : ((body as any)?.error ?? `HTTP ${status}`))
  }
}

export interface ClientOptions {
  host?: string
  companySlug?: string
  token?: StoredToken | null
  key?: string
}

export interface RequestOptions {
  authenticated?: boolean
  headers?: Record<string, string | undefined>
  acceptStatuses?: number[]
}

export interface ClientResponse<T = any> {
  status: number
  headers: Record<string, string>
  body: T
}

export class Client {
  private constructor(
    public readonly host: string,
    public readonly companySlug: string,
    private readonly token: StoredToken | null,
    private readonly key?: string,
  ) {}

  static async create(opts: ClientOptions = {}): Promise<Client> {
    const host = await resolveHost(opts.host)
    const companySlug = await resolveCompanySlug(opts.companySlug)
    const token = opts.token === undefined ? await readToken(host, companySlug) : opts.token
    return new Client(host, companySlug, token, opts.key)
  }

  mcpPath(path: string): string {
    return `/mcp/${this.companySlug}${path.startsWith('/') ? path : `/${path}`}`
  }

  async mcpGet<T = any>(path: string, params: Record<string, any> = {}): Promise<T> {
    return this.request<T>('GET', this.mcpPath(path), undefined, params)
  }

  async mcpPost<T = any>(path: string, body?: unknown, params: Record<string, any> = {}, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', this.mcpPath(path), body, params, options)
  }

  async mcpPostResponse<T = any>(
    path: string,
    body?: unknown,
    params: Record<string, any> = {},
    options: RequestOptions = {},
  ): Promise<ClientResponse<T>> {
    return this.requestResponse<T>('POST', this.mcpPath(path), body, params, options)
  }

  async apiGet<T = any>(path: string, params: Record<string, any> = {}, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, undefined, {...params, key: resolvePimaKey(this.key)}, {
      ...options,
      authenticated: options.authenticated ?? true,
    })
  }

  async apiPost<T = any>(path: string, body: Record<string, any> = {}, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, {...body, key: resolvePimaKey(this.key)}, {}, {
      ...options,
      authenticated: options.authenticated ?? true,
    })
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params: Record<string, any> = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.requestResponse<T>(method, path, body, params, options)
    return response.body
  }

  private async requestResponse<T>(
    method: string,
    path: string,
    body?: unknown,
    params: Record<string, any> = {},
    options: RequestOptions = {},
  ): Promise<ClientResponse<T>> {
    const url = new URL(`${this.host}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value))
    }

    const headers: Record<string, string> = {Accept: 'application/json', 'User-Agent': 'buckmason-cli/0.1'}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    for (const [key, value] of Object.entries(options.headers || {})) {
      if (value) headers[key] = value
    }
    if (options.authenticated ?? false) {
      if (!this.token) throw new Error(`Not authenticated to ${this.host}. Run \`buckmason auth login --email you@example.com\`.`)
      headers.Authorization = `Bearer ${this.token.access_token}`
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    const parsed = text ? safeJson(text) : null
    const responseHeaders = Object.fromEntries(res.headers.entries())
    const accepted = options.acceptStatuses?.includes(res.status)
    if (!res.ok && !accepted) throw new ApiError(res.status, parsed ?? text, responseHeaders)
    return {status: res.status, headers: responseHeaders, body: parsed as T}
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
