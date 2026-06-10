import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {configDir} from './config.js'

export interface WardrobeItem {
  id: string
  order_code?: string
  order_completed_at?: string
  order_item_id?: unknown
  product?: string
  color?: string
  color_code?: string
  size?: string
  sku?: string
  category?: string
  gender?: string
  status: 'owned' | 'maybe_owned' | 'not_in_hand' | 'returned_or_exchanged'
  fulfillment: 'ship' | 'pickup' | 'unknown'
  pickup_location?: string
  shipment_status?: string
  price_cents?: number
  thumb_url?: string
  product_url?: string
  tags: string[]
  source: 'order_history' | 'manual'
  updated_at: string
  raw?: Record<string, any>
}

export interface WardrobeCache {
  schema: 'buckmason-wardrobe-cache'
  schema_version: 1
  generated_at: string
  host?: string
  company?: string
  items: WardrobeItem[]
}

export interface PairingCandidate {
  item: WardrobeItem
  score: number
  reasons: string[]
}

export interface NewProductCandidate {
  product: Record<string, any>
  score: number
  reasons: string[]
}

export function wardrobePath(customPath?: string): string {
  return customPath || path.join(configDir(), 'wardrobe.json')
}

export async function readWardrobe(customPath?: string): Promise<WardrobeCache> {
  try {
    return JSON.parse(await readFile(wardrobePath(customPath), 'utf8')) as WardrobeCache
  } catch {
    return {schema: 'buckmason-wardrobe-cache', schema_version: 1, generated_at: new Date().toISOString(), items: []}
  }
}

export async function writeWardrobe(cache: WardrobeCache, customPath?: string): Promise<string> {
  const target = wardrobePath(customPath)
  await mkdir(path.dirname(target), {recursive: true})
  await writeFile(target, `${JSON.stringify(cache, null, 2)}\n`)
  return target
}

export function buildWardrobeFromOrders(orders: Array<Record<string, any>>, meta: {host?: string; company?: string} = {}): WardrobeCache {
  const merged = new Map<string, WardrobeItem>()
  const now = new Date().toISOString()

  for (const order of orders || []) {
    for (const item of order.items || []) {
      const wardrobeItem = normalizeOrderItem(order, item, now)
      const key = wardrobeItem.sku || wardrobeItem.id
      if (!key) continue
      const existing = merged.get(key)
      merged.set(key, existing ? mergeWardrobeItems(existing, wardrobeItem) : wardrobeItem)
    }
  }

  return {
    schema: 'buckmason-wardrobe-cache',
    schema_version: 1,
    generated_at: now,
    ...meta,
    items: [...merged.values()].sort(sortWardrobeItems),
  }
}

export function searchWardrobe(items: WardrobeItem[], query?: string, filters: {category?: string; status?: string; color?: string} = {}): WardrobeItem[] {
  const terms = tokenize(query || '')
  return items.filter((item) => {
    if (filters.category && !categoryOf(item).includes(filters.category.toLowerCase())) return false
    if (filters.status && item.status !== filters.status) return false
    if (filters.color && !String(item.color || '').toLowerCase().includes(filters.color.toLowerCase())) return false
    if (!terms.length) return true
    const haystack = tokenize(`${item.product} ${item.color} ${item.category} ${item.gender} ${item.sku} ${item.tags.join(' ')}`)
    return terms.every((term) => haystack.some((word) => word.includes(term)))
  })
}

export function findWardrobeItem(items: WardrobeItem[], selector: string): WardrobeItem | undefined {
  const normalized = selector.toLowerCase()
  return items.find((item) => item.sku?.toLowerCase() === normalized) ||
    items.find((item) => item.id.toLowerCase() === normalized) ||
    items.find((item) => item.product?.toLowerCase().includes(normalized))
}

export function pairWithWardrobe(anchor: WardrobeItem, items: WardrobeItem[], limit = 8): PairingCandidate[] {
  return items
    .filter((item) => item.id !== anchor.id && item.status === 'owned')
    .map((item) => scorePair(anchor, item))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.product).localeCompare(String(b.item.product)))
    .slice(0, limit)
}

export function matchNewProducts(anchor: WardrobeItem, products: Array<Record<string, any>>, owned: WardrobeItem[], limit = 8): NewProductCandidate[] {
  const ownedNames = new Set(owned.map((item) => normalizeProductName(item.product)))
  return products
    .filter((product) => !ownedNames.has(normalizeProductName(product.name)))
    .map((product) => scoreNewProduct(anchor, product))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name)))
    .slice(0, limit)
}

export function outfitSuggestion(items: WardrobeItem[], options: {occasion?: string; weather?: string; limit?: number} = {}): WardrobeItem[] {
  const owned = items.filter((item) => item.status === 'owned')
  const weather = String(options.weather || '').toLowerCase()
  const occasion = String(options.occasion || '').toLowerCase()
  const bottoms = owned.filter((item) => ['pant', 'jean', 'short'].includes(primaryCategory(item)))
  const tops = owned.filter((item) => ['shirt', 'tee', 'polo', 'sweater'].includes(primaryCategory(item)))
  const layers = owned.filter((item) => ['jacket', 'outerwear'].includes(primaryCategory(item)))
  const shoes = owned.filter((item) => primaryCategory(item) === 'shoe')
  const outfit: WardrobeItem[] = []

  const bottom = chooseBest(bottoms, (item) => weather.includes('hot') && primaryCategory(item) === 'short' ? 10 : 0)
  if (bottom) outfit.push(bottom)
  const top = chooseBest(tops, (item) => {
    let score = scorePair(bottom || item, item).score
    if (occasion.includes('work') && primaryCategory(item) === 'tee') score -= 2
    if (weather.includes('hot') && ['sweater'].includes(primaryCategory(item))) score -= 8
    return score
  })
  if (top) outfit.push(top)
  const layer = chooseBest(layers, (item) => {
    if (weather.includes('hot')) return -10
    return top ? scorePair(top, item).score : 1
  })
  if (layer) outfit.push(layer)
  const shoe = chooseBest(shoes, () => 1)
  if (shoe) outfit.push(shoe)

  return outfit.slice(0, options.limit || 4)
}

function normalizeOrderItem(order: Record<string, any>, item: Record<string, any>, now: string): WardrobeItem {
  const status = wardrobeStatus(item)
  const fulfillment = item.to_pickup ? 'pickup' : item.shipment ? 'ship' : 'unknown'
  const product = item.product || item.product_name || ''
  const category = inferCategory(product, item.category)
  return {
    id: String(item.sku || item.id || `${order.code}-${product}-${item.size}`),
    order_code: order.code,
    order_completed_at: order.completed_at,
    order_item_id: item.id,
    product,
    color: item.color,
    color_code: item.color_code,
    size: item.size,
    sku: item.sku,
    category,
    gender: item.gender || item.product_gender,
    status,
    fulfillment,
    pickup_location: item.fulfillment_location?.name || item.shipment?.pickup_location?.name,
    shipment_status: item.shipment?.display_status || item.rms_status || item.status,
    price_cents: cents(item.original_paid_price),
    thumb_url: item.thumb_url,
    tags: tagsFor({product, color: item.color, category}),
    source: 'order_history',
    updated_at: now,
    raw: item,
  }
}

function wardrobeStatus(item: Record<string, any>): WardrobeItem['status'] {
  const status = String(item.rms_status || item.status || '').toLowerCase()
  const shipment = String(item.shipment?.display_status || '').toLowerCase()
  if (/\b(return|exchange|refund|cancel)/.test(status) || shipment === 'canceled') return 'returned_or_exchanged'
  if (['delivered', 'picked_up'].includes(shipment) || item.picked_up || ['completed', 'fulfilled'].includes(status)) return 'owned'
  if (['ready_for_pickup', 'preparing', 'in_transit'].includes(shipment) || ['new', 'pending'].includes(status)) return 'not_in_hand'
  return 'maybe_owned'
}

function mergeWardrobeItems(existing: WardrobeItem, next: WardrobeItem): WardrobeItem {
  const statusRank = {owned: 4, maybe_owned: 3, not_in_hand: 2, returned_or_exchanged: 1}
  return {
    ...existing,
    ...next,
    status: statusRank[next.status] >= statusRank[existing.status] ? next.status : existing.status,
    tags: [...new Set([...existing.tags, ...next.tags])],
  }
}

function scorePair(anchor: WardrobeItem, item: WardrobeItem): PairingCandidate {
  const reasons: string[] = []
  let score = 0
  const anchorCategory = primaryCategory(anchor)
  const itemCategory = primaryCategory(item)

  if (anchorCategory !== itemCategory) {
    score += 5
    reasons.push(`different role: ${anchorCategory || 'anchor'} + ${itemCategory || 'piece'}`)
  }
  if (complementaryCategories(anchorCategory, itemCategory)) {
    score += 7
    reasons.push('natural outfit pairing')
  }
  const color = colorScore(anchor.color, item.color)
  score += color.score
  if (color.reason) reasons.push(color.reason)
  if (sharedTags(anchor, item).includes('casual')) score += 1
  if (anchor.status === 'owned' && item.status === 'owned') score += 2

  return {item, score, reasons}
}

function scoreNewProduct(anchor: WardrobeItem, product: Record<string, any>): NewProductCandidate {
  const pseudo: WardrobeItem = {
    id: String(product.id || product.sku || product.name),
    product: product.name,
    color: product.color,
    category: inferCategory(product.name, product.category),
    status: 'maybe_owned',
    fulfillment: 'unknown',
    tags: tagsFor({product: product.name, color: product.color, category: product.category}),
    source: 'manual',
    updated_at: new Date().toISOString(),
  }
  const scored = scorePair(anchor, pseudo)
  let score = scored.score
  const reasons = [...scored.reasons]
  if (product.online_in_stock || product.in_stock_online?.in_stock) {
    score += 2
    reasons.push('available online in current catalog signal')
  }
  if (product.price_cents || product.price) score += 1
  return {product, score, reasons}
}

function complementaryCategories(a: string, b: string): boolean {
  const key = [a, b].sort().join(':')
  return new Set([
    'jean:shirt',
    'jean:tee',
    'jacket:jean',
    'jacket:shirt',
    'pant:shirt',
    'pant:tee',
    'polo:short',
    'shirt:short',
    'shoe:short',
    'jean:shoe',
    'pant:shoe',
  ]).has(key)
}

function colorScore(a?: string, b?: string): {score: number; reason?: string} {
  const ca = colorFamily(a)
  const cb = colorFamily(b)
  if (!ca || !cb) return {score: 0}
  if (ca === cb && ca !== 'neutral') return {score: 1, reason: `tonal ${ca} palette`}
  if (ca === 'neutral' || cb === 'neutral') return {score: 5, reason: 'neutral color compatibility'}
  const pairs = new Set(['blue:white', 'blue:brown', 'blue:green', 'green:white', 'green:brown', 'black:white', 'brown:white'])
  const key = [ca, cb].sort().join(':')
  if (pairs.has(key)) return {score: 4, reason: `${ca}/${cb} color compatibility`}
  return {score: 1}
}

function colorFamily(color?: string): string {
  const text = String(color || '').toLowerCase()
  if (/black|charcoal|grey|gray|white|natural|ecru|cream|ivory|heather|ash/.test(text)) return 'neutral'
  if (/blue|indigo|navy|chambray|denim/.test(text)) return 'blue'
  if (/olive|green|sage|moss/.test(text)) return 'green'
  if (/brown|tan|tobacco|khaki|stone|sand|camel/.test(text)) return 'brown'
  if (/red|burgundy|wine/.test(text)) return 'red'
  return ''
}

function tagsFor(values: {product?: string; color?: string; category?: string}): string[] {
  const text = `${values.product || ''} ${values.color || ''} ${values.category || ''}`.toLowerCase()
  const tags = new Set<string>()
  const category = inferCategory(values.product, values.category)
  if (category) tags.add(category)
  if (/linen|camp|short|polo|tee/.test(text)) tags.add('warm-weather')
  if (/sweater|wool|cashmere|jacket|flannel/.test(text)) tags.add('cool-weather')
  if (/black|navy|white|natural|ecru|grey|gray|denim|olive|khaki/.test(text)) tags.add('versatile')
  if (/tee|jean|short|sweat|hoodie/.test(text)) tags.add('casual')
  if (/shirt|polo|chino|trouser|jacket|sweater/.test(text)) tags.add('smart-casual')
  return [...tags]
}

function inferCategory(product?: string, category?: string): string {
  const text = `${category || ''} ${product || ''}`.toLowerCase()
  if (/jean|denim/.test(text)) return 'jean'
  if (/pant|trouser|chino/.test(text)) return 'pant'
  if (/short/.test(text)) return 'short'
  if (/tee|t-shirt|tshirt/.test(text)) return 'tee'
  if (/polo/.test(text)) return 'polo'
  if (/shirt|button/.test(text)) return 'shirt'
  if (/jacket|coat|outerwear|overshirt|blazer/.test(text)) return 'jacket'
  if (/sweater|cardigan|cashmere/.test(text)) return 'sweater'
  if (/shoe|boot|sneaker/.test(text)) return 'shoe'
  return ''
}

function primaryCategory(item: WardrobeItem): string {
  return inferCategory(item.product, item.category)
}

function categoryOf(item: WardrobeItem): string {
  return `${item.category || ''} ${item.tags.join(' ')}`.toLowerCase()
}

function chooseBest(items: WardrobeItem[], score: (item: WardrobeItem) => number): WardrobeItem | undefined {
  return items.map((item) => ({item, score: score(item)})).sort((a, b) => b.score - a.score)[0]?.item
}

function sharedTags(a: WardrobeItem, b: WardrobeItem): string[] {
  const set = new Set(a.tags)
  return b.tags.filter((tag) => set.has(tag))
}

function sortWardrobeItems(a: WardrobeItem, b: WardrobeItem): number {
  return String(b.order_completed_at || '').localeCompare(String(a.order_completed_at || '')) ||
    String(a.product || '').localeCompare(String(b.product || ''))
}

function normalizeProductName(value?: string): string {
  return String(value || '').toLowerCase().replace(/\s+-\s+.*$/, '').trim()
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function cents(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  const parsed = Number.parseFloat(String(value || '').replace(/[$,]/g, ''))
  if (!Number.isFinite(parsed)) return undefined
  return parsed > 1000 ? Math.round(parsed) : Math.round(parsed * 100)
}
