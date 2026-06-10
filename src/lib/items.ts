export interface CartItemInput {
  slug_or_code: string
  size: string
  qty: number
}

export interface CheckoutLineItemInput {
  sku: string
  quantity: number
  pickup_location_slug?: string
}

export function parseCartItemSpec(spec: string): CartItemInput {
  const [slugOrCode, size, qty = '1', extra] = spec.split(':')
  if (!slugOrCode || !size || extra !== undefined) {
    throw new Error(`Invalid cart item "${spec}". Use product-id-or-code:size[:qty].`)
  }

  return {
    slug_or_code: slugOrCode,
    size,
    qty: parsePositiveInteger(qty, 'qty'),
  }
}

export function parseCheckoutLineItemSpec(spec: string): CheckoutLineItemInput {
  const [sku, qty = '1', pickupLocationSlug, extra] = spec.split(':')
  if (!sku || extra !== undefined) {
    throw new Error(`Invalid checkout line item "${spec}". Use sku[:qty[:pickup-location-slug]].`)
  }

  return {
    sku,
    quantity: parsePositiveInteger(qty, 'quantity'),
    pickup_location_slug: pickupLocationSlug || undefined,
  }
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`)
  return parsed
}
