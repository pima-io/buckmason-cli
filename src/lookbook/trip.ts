import {mkdir, readFile, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {Client} from '../lib/client.js'
import {parseProfile} from './profile.js'

export interface TripPlanProduct {
  id: string | number
  size?: string
  rationale?: string
  try_on_image_index?: number
}

export interface TripPlanLook {
  id?: string
  eyebrow?: string
  title: string
  note?: string
  setting?: string
  composition?: string
  products: TripPlanProduct[]
}

export interface TripPlan {
  person?: string
  profile?: string
  destination: string
  month: string
  lookbook_id?: string
  title?: string
  subtitle?: string
  project?: string
  near_zip?: string
  radius_mi?: number
  preferred_location?: string
  looks: TripPlanLook[]
}

export interface TripArtifacts {
  runDir: string
  looksDir: string
  deployDir: string
  profilePath: string
  configPath: string
  picksPath: string
  imagePlanPath: string
  lookbookId: string
  project: string
}

export interface SmokeResult {
  url: string
  page_status: number
  manifest_ok: boolean
  manifest_title?: string
  manifest_tier?: string
  votes_status?: number
  live_status?: number
  og_status?: number
  og_content_type?: string
  ok: boolean
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72)
}

export function defaultPeopleDir(): string {
  return path.join(os.homedir(), '.buckmason/people')
}

export function defaultRunsDir(): string {
  return path.join(os.homedir(), '.buckmason/runs')
}

export function resolvePersonProfile(options: {
  plan: TripPlan
  profile?: string
  person?: string
  peopleDir?: string
}): string {
  const explicit = options.profile || options.plan.profile
  if (explicit) return expandHome(explicit)
  const person = options.person || options.plan.person
  if (!person) throw new Error('Trip lookbook requires --profile, plan.profile, --person, or plan.person.')
  return path.join(expandHome(options.peopleDir || defaultPeopleDir()), person, 'profile.md')
}

export function buildTripArtifacts(options: {
  plan: TripPlan
  runsDir?: string
  runDir?: string
  project?: string
}): TripArtifacts {
  const lookbookId = options.plan.lookbook_id || `${options.plan.month}-${slugify(options.plan.person || options.plan.destination)}`
  const project = options.project || options.plan.project || `buckmason-${lookbookId}`
  const runDir = expandHome(options.runDir || path.join(expandHome(options.runsDir || defaultRunsDir()), lookbookId))
  return {
    runDir,
    looksDir: path.join(runDir, 'looks'),
    deployDir: path.join(runDir, 'deploy'),
    profilePath: path.join(runDir, 'profile.md'),
    configPath: path.join(runDir, 'config.json'),
    picksPath: path.join(runDir, 'picks.json'),
    imagePlanPath: path.join(runDir, 'image-plan.json'),
    lookbookId,
    project,
  }
}

export function buildTripConfig(plan: TripPlan, artifacts: Pick<TripArtifacts, 'lookbookId' | 'project'>): Record<string, any> {
  const preferredLocation = plan.preferred_location || 'Hayes Valley'
  const nearZip = plan.near_zip || '94102'
  const radiusMi = plan.radius_mi || 25
  return {
    lookbook_id: artifacts.lookbookId,
    lookbook_title: plan.title || `${titleCase(plan.person || 'Customer')} · ${titleCase(plan.destination)} ${monthLabel(plan.month)} Edit`,
    lookbook_date: plan.month,
    subtitle: plan.subtitle || `${titleCase(plan.destination)} travel looks for ${monthLabel(plan.month)}, built from live Buck Mason product and stock checks.`,
    page_url: `https://${artifacts.project}.pages.dev/`,
    near_zip: nearZip,
    radius_mi: radiusMi,
    preferred_location: preferredLocation,
    stock_refresh: {
      base_url: 'https://pima.io/mcp/buckmason',
      near_zip: nearZip,
      radius_mi: radiusMi,
      cache_ttl_seconds: 60,
      preferred_location: preferredLocation,
    },
    looks: plan.looks.map((look, index) => ({
      id: look.id || `look${index + 1}`,
      eyebrow: look.eyebrow || `Look ${String(index + 1).padStart(2, '0')}`,
      title: look.title,
      note: look.note || '',
      setting: look.setting || `${titleCase(plan.destination)} travel setting with natural light.`,
      composition: look.composition || 'Full-body editorial travel photograph, natural posture, 35mm.',
    })),
  }
}

export async function buildTripPicks(options: {
  client: Client
  plan: TripPlan
  profile: Record<string, any>
}): Promise<Record<string, any>[]> {
  const products = await Promise.all(uniqueProductIds(options.plan).map(async (id) => {
    const product = await options.client.mcpGet(`/products/${encodeURIComponent(String(id))}`, {
      near_zip: options.plan.near_zip,
      radius_mi: options.plan.radius_mi || 25,
    })
    return [String(id), product] as const
  }))
  const productById = new Map(products)
  const picks: Record<string, any>[] = []

  for (const [lookIndex, look] of options.plan.looks.entries()) {
    const lookId = look.id || `look${lookIndex + 1}`
    for (const requested of look.products) {
      const product = productById.get(String(requested.id)) as any
      if (!product) throw new Error(`Product ${requested.id} was not returned by PIMA.`)
      picks.push(pickFromProduct({product, requested, lookId, profile: options.profile}))
    }
  }

  enforceCompleteLooks(options.plan, picks)
  return picks
}

export async function writeTripInputs(options: {
  plan: TripPlan
  artifacts: TripArtifacts
  profileSourcePath: string
  profileText: string
  config: Record<string, any>
  picks: Record<string, any>[]
}): Promise<void> {
  await mkdir(options.artifacts.looksDir, {recursive: true})
  await mkdir(options.artifacts.deployDir, {recursive: true})
  await writeFile(options.artifacts.profilePath, options.profileText)
  await writeFile(options.artifacts.configPath, `${JSON.stringify(options.config, null, 2)}\n`)
  await writeFile(options.artifacts.picksPath, `${JSON.stringify(options.picks, null, 2)}\n`)
  await writeFile(path.join(options.artifacts.runDir, 'source-profile.txt'), `${options.profileSourcePath}\n`)
}

export async function readTripPlan(planPath: string): Promise<TripPlan> {
  const plan = JSON.parse(await readFile(expandHome(planPath), 'utf8')) as TripPlan
  validateTripPlan(plan)
  return plan
}

export function parseTripProfile(text: string): Record<string, any> {
  return parseProfile(text)
}

export async function smokeCheckLookbook(url: string, fetchImpl: typeof fetch = fetch): Promise<SmokeResult> {
  const base = normalizeUrl(url)
  const page = await fetchImpl(base)
  let manifestOk = false
  let manifestTitle: string | undefined
  let manifestTier: string | undefined
  const manifest = await fetchImpl(new URL('lookbook.json', base))
  if (manifest.ok) {
    const body = await manifest.json() as any
    manifestOk = body?.schema === 'buck-mason-lookbook-manifest'
    manifestTitle = body?.title
    manifestTier = body?.tier
  }
  const votes = await fetchImpl(new URL('api/votes?public=1&fresh=1', base))
  const live = await fetchImpl(new URL('api/votes/live', base))
  const og = await fetchImpl(new URL('og.jpg', base))
  return {
    url: base,
    page_status: page.status,
    manifest_ok: manifestOk,
    manifest_title: manifestTitle,
    manifest_tier: manifestTier,
    votes_status: votes.status,
    live_status: live.status,
    og_status: og.status,
    og_content_type: og.headers.get('content-type') || undefined,
    ok: page.ok && manifestOk && votes.ok && live.status === 426 && og.ok,
  }
}

export function enforceCompleteLooks(plan: TripPlan, picks: Record<string, any>[]): void {
  for (const [index, look] of plan.looks.entries()) {
    const lookId = look.id || `look${index + 1}`
    const categories = picks.filter((pick) => pick.look === lookId).map((pick) => productBucket(pick))
    if (!categories.includes('top')) throw new Error(`${lookId} is missing a top. Add a shirt, tee, polo, sweater, or knit.`)
    if (!categories.includes('bottom')) throw new Error(`${lookId} is missing a bottom. Add a pant, jean, trouser, or short.`)
  }
}

function validateTripPlan(plan: TripPlan): void {
  if (!plan.destination) throw new Error('Trip plan requires destination.')
  if (!plan.month) throw new Error('Trip plan requires month, for example 2026-08.')
  if (!Array.isArray(plan.looks) || plan.looks.length === 0) throw new Error('Trip plan requires at least one look.')
  for (const [index, look] of plan.looks.entries()) {
    if (!look.title) throw new Error(`Trip plan look ${index + 1} requires title.`)
    if (!Array.isArray(look.products) || look.products.length === 0) throw new Error(`Trip plan look ${index + 1} requires products.`)
  }
}

function pickFromProduct(options: {
  product: any
  requested: TripPlanProduct
  lookId: string
  profile: Record<string, any>
}): Record<string, any> {
  const {product, requested, lookId, profile} = options
  const size = requested.size || preferredSize(product, profile)
  const variant = (product.variants || []).find((v: any) => String(v.size) === String(size))
  if (!variant) throw new Error(`Product ${product.id} ${product.name} does not have size ${size}.`)
  const image = product.images?.[requested.try_on_image_index || 0] || product.images?.[0]
  const online = variant.online || {in_stock: Boolean(product.online_in_stock), status: product.online_in_stock ? 'in_stock' : 'out_of_stock', label: product.online_in_stock ? 'In stock' : 'Out of stock'}
  const preferredPickup = (variant.fulfillment?.pickup_locations || []).find((location: any) => location.short_name === 'HV' || location.name === 'Hayes Valley')
  const stockLabel = preferredPickup
    ? `${online.label} online; pickup available at ${preferredPickup.name} for size ${variant.size}`
    : `${online.label} online for size ${variant.size}`
  return {
    look: lookId,
    id: product.id,
    name: product.name,
    color: product.color,
    category: product.category,
    style: product.style,
    product_line: product.product_line,
    picked_size: String(variant.size),
    sku: variant.sku,
    shopify_variant_id: variant.shopify_variant_id,
    price_cents: product.price_cents,
    price: product.price,
    url: product.url,
    image_url: product.image_url,
    try_on: image?.url ? {url: image.url, type: image.type, position: image.position} : undefined,
    in_stock_online: {
      in_stock: Boolean(online.in_stock),
      status: online.status,
      label: stockLabel,
    },
    fulfillment: variant.fulfillment,
    rationale: requested.rationale || '',
  }
}

function preferredSize(product: any, profile: Record<string, any>): string {
  const sizes = profile.sizes || {}
  const bucket = categoryBucket([product.category, product.style, product.product_line].join(' '))
  if (bucket === 'bottom') return sizes.pant || sizes.jean || sizes.short || '32'
  return sizes.shirt || sizes.tee || sizes.jacket || 'M'
}

function productBucket(product: Record<string, any>): 'top' | 'bottom' | 'other' {
  return categoryBucket([product.category, product.style, product.product_line, product.name].join(' '))
}

function categoryBucket(category: unknown): 'top' | 'bottom' | 'other' {
  const value = String(category || '').toLowerCase()
  if (/(pant|jean|trouser|short)/.test(value)) return 'bottom'
  if (/(shirt|tee|polo|sweater|outerwear|jacket|knit)/.test(value)) return 'top'
  return 'other'
}

function uniqueProductIds(plan: TripPlan): Array<string | number> {
  return [...new Map(plan.looks.flatMap((look) => look.products).map((product) => [String(product.id), product.id])).values()]
}

function monthLabel(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})$/)
  if (!match) return month
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
  return new Intl.DateTimeFormat('en', {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(date)
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function normalizeUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}
