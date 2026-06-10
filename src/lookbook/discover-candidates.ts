import {readFile} from 'node:fs/promises'

export interface DiscoverCandidateOptions {
  host: string
  company: string
  gender: 'm' | 'w' | 'u'
  sinceDays: number
  wishlistPath?: string
  sizes: Record<string, string>
  avoidColors?: string[]
  max?: number
  reProposeAfterWeeks?: number
}

export async function discoverWeeklyCandidates(options: DiscoverCandidateOptions) {
  const max = options.max || 30
  const avoid = new Set(options.avoidColors || ['vintage_product'])
  const proposed = await readWishlist(options.wishlistPath)
  const recent = await getJson<any>(productsUrl(options, {recently_live: true, recently_live_days: options.sinceDays, per_page: Math.max(max * 4, 60)}))
  const backfill = await getJson<any>(productsUrl(options, {per_page: Math.max(max * 4, 60)}))
  const products = [
    ...((recent.products || []) as any[]).map((product) => ({source: 'recently_live', product})),
    ...((backfill.products || []) as any[]).map((product) => ({source: 'backfill', product})),
  ]

  const candidates: any[] = []
  const seen = new Set<string>()
  for (const {source, product} of products) {
    const id = product.id
    if (!id || seen.has(String(id))) continue
    if (avoid.has(product.color)) continue
    if (product.color_rgb === '#ff0000' && product.color === 'vintage_product') continue
    const targetSize = categorySizeFor(product, options.sizes)
    if (!targetSize) continue

    const detail = await getJson<any>(`${trimSlash(options.host)}/mcp/${options.company}/products/${id}`)
    const variant = (detail.variants || []).find((candidate: any) => String(candidate.size) === String(targetSize))
    if (!variant?.sku) continue
    if (!eligible(variant.sku, proposed, options.reProposeAfterWeeks || 8)) continue
    if (variant.online && variant.online.in_stock === false) continue

    candidates.push({
      source,
      id,
      slug: detail.slug,
      name: detail.name,
      color: detail.color,
      category: detail.category,
      price: detail.price,
      price_cents: detail.price_cents,
      url: detail.url,
      size: targetSize,
      sku: variant.sku,
      shopify_variant_id: variant.shopify_variant_id,
      in_stock_online: variant.online,
      image_url: detail.image_url,
      previously_proposed_at: proposed.get(variant.sku),
    })
    seen.add(String(id))
    if (candidates.length >= max) break
  }

  return {
    generated_at: new Date().toISOString(),
    filter: {
      gender: options.gender,
      since_days: options.sinceDays,
      sizes: options.sizes,
      avoid_colors: [...avoid].sort(),
      wishlist_size: proposed.size,
    },
    candidate_count: candidates.length,
    candidates,
  }
}

function productsUrl(options: DiscoverCandidateOptions, params: Record<string, string | number | boolean>): string {
  const url = new URL(`${trimSlash(options.host)}/mcp/${options.company}/products`)
  url.searchParams.set('gender', options.gender)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  return url.toString()
}

async function readWishlist(path: string | undefined): Promise<Map<string, string>> {
  const proposed = new Map<string, string>()
  if (!path) return proposed

  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return proposed
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      const sku = row.sku
      const timestamp = row.proposed_at || row.purchased_at
      if (sku && timestamp && (!proposed.has(sku) || String(timestamp) > String(proposed.get(sku)))) {
        proposed.set(sku, timestamp)
      }
    } catch {
      continue
    }
  }

  return proposed
}

function eligible(sku: string, proposed: Map<string, string>, reProposeAfterWeeks: number): boolean {
  const timestamp = proposed.get(sku)
  if (!timestamp) return true
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return true
  return Date.now() - parsed > reProposeAfterWeeks * 7 * 24 * 60 * 60 * 1000
}

function categorySizeFor(product: Record<string, any>, sizes: Record<string, string>): string | undefined {
  const category = String(product.category || '').toLowerCase()
  if (category.includes('shirt')) return sizes.shirt
  if (category.includes('tee') || category.includes('polo')) return sizes.tee
  if (category.includes('pant') || category.includes('trouser')) return sizes.pant
  if (category.includes('short')) return sizes.short
  if (category.includes('jacket') || category.includes('outerwear')) return sizes.jacket
  if (category.includes('shoe')) return sizes.shoe
  return undefined
}

async function getJson<T>(url: string, tries = 3): Promise<T> {
  let last: Error | null = null
  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await fetch(url, {headers: {Accept: 'application/json'}})
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json() as T
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error))
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)))
    }
  }

  throw last || new Error(`Failed to fetch ${url}`)
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
