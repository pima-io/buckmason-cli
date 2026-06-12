import {randomUUID} from 'node:crypto'
import type {Client, ClientResponse} from './client.js'
import {renderKeyValues, renderRecords} from './output.js'

export interface HostedCheckoutOptions {
  agentIdentity?: string
  agentModel?: string
  idempotencyKey?: string
}

export async function createHostedCheckout(
  client: Client,
  body: Record<string, any>,
  options: HostedCheckoutOptions = {},
): Promise<ClientResponse<Record<string, any>>> {
  return client.mcpPostResponse<Record<string, any>>(
    '/hosted_checkout',
    body,
    {},
    {
      acceptStatuses: [422],
      headers: {
        'Idempotency-Key': options.idempotencyKey || randomUUID(),
        'X-Agent-Identity': options.agentIdentity,
        'X-Agent-Model': options.agentModel,
      },
    },
  )
}

export function renderHostedCheckoutResponse(body: Record<string, any>): string {
  const checkout = body.checkout || {}
  const lines = [
    renderKeyValues({
      hosted_checkout_url: body.hosted_checkout_url,
      hosted_checkout_status_url: body.hosted_checkout_status_url,
      token: checkout.token,
      expires_at: body.expires_at,
      poll_after_seconds: body.poll_after_seconds,
      subtotal: checkout.totals?.subtotal,
      discount: checkout.totals?.discount,
      shipping: checkout.totals?.shipping,
      tax: checkout.totals?.tax,
      credit_applied: checkout.totals?.credit_applied,
      charge: checkout.totals?.charge,
    }, 'table'),
  ]

  if (Array.isArray(checkout.line_items) && checkout.line_items.length > 0) {
    lines.push(renderRecords(checkout.line_items, ['sku', 'quantity', 'unit_price', 'pickup_location_name', 'to_pickup'], 'table'))
  }

  if (checkout.token) lines.push(`Poll: buckmason checkout status ${checkout.token} --watch`)
  return lines.join('\n')
}
