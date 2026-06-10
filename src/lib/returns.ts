export type ReturnType = 'original' | 'exchange' | 'credit'

export interface ReturnItemOptions {
  orderItemId: number
  reasonId: number
  type?: ReturnType
  exchangeSkuId?: number
}

const RETURN_TYPES = new Set<ReturnType>(['original', 'exchange', 'credit'])

export function buildReturnItem(options: ReturnItemOptions): Record<string, unknown> {
  const returnType = options.type || (options.exchangeSkuId ? 'exchange' : 'original')
  if (returnType === 'exchange' && !options.exchangeSkuId) {
    throw new Error('Exchange returns require --exchange-sku-id. Use returns exchange-options first.')
  }

  if (options.exchangeSkuId && returnType !== 'exchange') {
    throw new Error('--exchange-sku-id can only be used with exchange returns.')
  }

  return {
    order_item_id: options.orderItemId,
    return_reason_id: options.reasonId,
    return_type: returnType,
    ...(options.exchangeSkuId ? {exchange_sku_id: options.exchangeSkuId} : {}),
  }
}

export function parseReturnItemSpec(spec: string): ReturnItemOptions {
  const [orderItemId, reasonId, type, exchangeSkuId, extra] = spec.split(':')
  if (extra !== undefined) {
    throw new Error('Return item specs must be order_item_id:reason_id:return_type[:exchange_sku_id].')
  }

  return {
    orderItemId: positiveInteger(orderItemId, 'order_item_id'),
    reasonId: positiveInteger(reasonId, 'reason_id'),
    type: parseReturnType(type),
    exchangeSkuId: exchangeSkuId ? positiveInteger(exchangeSkuId, 'exchange_sku_id') : undefined,
  }
}

export function normalizeReturnItem(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Each return item must be a JSON object.')
  }

  const item = value as Record<string, any>
  const orderItemId = item.order_item_id ?? item.orderItemId
  const reasonId = item.return_reason_id ?? item.reasonId
  const exchangeSkuId = item.exchange_sku_id ?? item.exchangeSkuId
  const type = item.return_type ?? item.type

  return buildReturnItem({
    orderItemId: positiveInteger(orderItemId, 'order_item_id'),
    reasonId: positiveInteger(reasonId, 'return_reason_id'),
    type: parseReturnType(type),
    exchangeSkuId: exchangeSkuId == null || exchangeSkuId === '' ? undefined : positiveInteger(exchangeSkuId, 'exchange_sku_id'),
  })
}

export function extractReturnItemsFromJson(value: unknown): Record<string, unknown>[] {
  const items = Array.isArray(value) ? value : nestedItems(value)
  if (!items.length) throw new Error('Return item JSON must include at least one item.')
  return items.map(normalizeReturnItem)
}

function nestedItems(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Return item JSON must be an array, or an object with items_attributes.')
  }

  const object = value as Record<string, any>
  const items = object.items_attributes ?? object.items ?? object.customer_return?.items_attributes ?? object.customer_return?.items
  if (!Array.isArray(items)) {
    throw new Error('Return item JSON must be an array, or an object with items_attributes.')
  }

  return items
}

function parseReturnType(value: unknown): ReturnType | undefined {
  if (value == null || value === '') return undefined
  const type = String(value) as ReturnType
  if (!RETURN_TYPES.has(type)) throw new Error(`Return type must be one of ${[...RETURN_TYPES].join(', ')}.`)
  return type
}

function positiveInteger(value: unknown, field: string): number {
  const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${field} must be a positive integer.`)
  return number
}
