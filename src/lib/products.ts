export type ProductSort = 'name' | 'newest'

export interface ProductSearchOptions {
  q?: string
  gender?: string
  color?: string
  category?: string
  nearZip?: string
  inStockOnly?: boolean
  limit?: number
  page?: number
  sort?: ProductSort
  days?: number
}

export function productSearchParams(options: ProductSearchOptions): Record<string, unknown> {
  const newest = options.sort === 'newest'

  return {
    q: options.q,
    gender: options.gender,
    color: options.color,
    category: options.category,
    near_zip: options.nearZip,
    in_stock_only: options.inStockOnly || undefined,
    per_page: options.limit,
    page: options.page,
    recently_live: newest || undefined,
    recently_live_days: newest ? options.days : undefined,
  }
}
