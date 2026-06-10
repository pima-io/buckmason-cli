import {renderRecords} from './output.js'

export interface MppErrorBody {
  code?: string
  message?: string
  items?: Array<Record<string, any>>
}

// Render a structured MPP checkout error body ({error: {code, message, ...}}).
// fulfillment_unavailable errors carry per-item reasons plus the pickup
// stores that could satisfy the item, so the agent can re-offer instead of
// dead-ending. Returns the error object when one was rendered, null when the
// body has no structured error.
export function renderMppError(log: (message: string) => void, body: any): MppErrorBody | null {
  const error = body?.error
  if (!error || typeof error !== 'object') return null

  log(`Error: ${error.code ?? 'unknown'} — ${error.message ?? ''}`)
  const items = Array.isArray(error.items) ? error.items : []
  if (items.length > 0) {
    log(renderRecords(items, ['sku', 'size', 'quantity', 'error', 'message'], 'table'))
    for (const item of items) {
      const locations = Array.isArray(item.pickup_locations) ? item.pickup_locations : []
      if (locations.length > 0) {
        const names = locations.map((l: any) => (l.short_name ? `${l.name} (${l.short_name})` : l.name))
        log(`Pickup options for ${item.sku}: ${names.join(', ')}`)
      } else if (item.fulfillment && item.fulfillment.ship === false) {
        log(`No pickup store currently has ${item.sku} in stock.`)
      }
    }
  }

  return error
}

// Human label for the fulfillment gate returned by /stock/:sku and
// /products/:id variants — the same ship/pickup-only rules e-com enforces.
export function describeFulfillment(fulfillment: any): string {
  if (!fulfillment) return ''
  switch (fulfillment.mode) {
    case 'ship_or_pickup': {
      return 'ship or pickup'
    }

    case 'ship_only': {
      return 'ship only — not available for store pickup'
    }

    case 'pickup_only': {
      return 'pickup only — cannot be shipped'
    }

    case 'unavailable': {
      return 'unavailable — no sellable stock to ship or pick up'
    }

    default: {
      return String(fulfillment.mode ?? '')
    }
  }
}
