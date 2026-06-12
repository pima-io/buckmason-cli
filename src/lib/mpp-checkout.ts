import {Buffer} from 'node:buffer'

export interface LinkSpendRequestInput {
  amountCents: number
  currency: string
  context: string
  lineItems: string[]
  totals: string[]
  networkId: string
}

export function buildLinkSpendRequestInput(
  previewBody: Record<string, any>,
  wwwAuthenticate?: string,
): LinkSpendRequestInput {
  const totals = previewBody.totals || {}
  const amountCents = requireCents(
    [totals.charge_cents, totals.charge, totals.total_cents, totals.total],
    'checkout charge total',
  )
  const currency = String(previewBody.currency || totals.currency || 'usd').toLowerCase()
  const networkId = previewBody.network_id || extractNetworkIdFromChallenge(wwwAuthenticate)
  if (!networkId) throw new Error('MPP preview did not include a Stripe network_id or decodable WWW-Authenticate challenge.')

  return {
    amountCents,
    currency,
    context: buildApprovalContext(previewBody, amountCents),
    lineItems: buildLinkLineItems(previewBody.line_items || [], totals),
    totals: buildLinkTotals(totals, amountCents),
    networkId,
  }
}

export function latestSpendRequest<T extends Record<string, any>>(value: T | T[]): T {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error('link-cli returned an empty response.')
    return value[value.length - 1]
  }

  return value
}

export function extractSharedPaymentToken(spendRequest: Record<string, any>): string {
  const token = spendRequest.shared_payment_token
  if (typeof token === 'string') return token
  if (token && typeof token.id === 'string') return token.id
  throw new Error('Approved Link spend request did not include a shared_payment_token. Retry with --include shared_payment_token.')
}

function buildApprovalContext(previewBody: Record<string, any>, amountCents: number): string {
  const suggested = previewBody.suggested_context
  if (typeof suggested === 'string' && suggested.length >= 100) return suggested

  const itemSummary = (previewBody.line_items || [])
    .map((item: Record<string, any>) => `${item.quantity || 1}x ${item.name || item.title || item.product_name || item.sku || 'item'}`)
    .join(', ')
  const details = itemSummary || 'the prepared checkout cart'
  return `Authorize a ${formatMoney(amountCents)} charge by Buck Mason for ${details} via the mpp.dev Merchant Payments Protocol. The customer requested this checkout and must approve it in Link before the agent can submit payment.`
}

function buildLinkLineItems(lineItems: Array<Record<string, any>>, totals: Record<string, any>): string[] {
  if (lineItems.length === 0) return []
  const fallbackUnitAmount = lineItems.length === 1
    ? centsFromAny(totals.subtotal_cents, totals.subtotal)
    : undefined

  return lineItems.map((item) => {
    const quantity = numberFromAny(item.quantity ?? item.qty) || 1
    const unitAmount = centsFromAny(
      item.unit_amount,
      item.unit_amount_cents,
      item.unit_price_cents,
      item.unit_price,
      item.price_cents,
      item.price,
    ) ?? (fallbackUnitAmount && quantity > 0 ? Math.round(fallbackUnitAmount / quantity) : undefined)
    const pairs = [
      ['name', item.name || item.title || item.product_name || item.sku || 'Buck Mason item'],
      ['quantity', quantity],
      ['unit_amount', unitAmount],
    ].filter(([, value]) => value != null && value !== '')

    return pairs.map(([key, value]) => `${key}:${escapeLinkValue(String(value))}`).join(',')
  })
}

function buildLinkTotals(totals: Record<string, any>, amountCents: number): string[] {
  return [
    ['subtotal', 'Subtotal', centsFromAny(totals.subtotal_cents, totals.subtotal)],
    ['discount', 'Discount', centsFromAny(totals.discount_cents, totals.discount)],
    ['shipping', 'Shipping', centsFromAny(totals.shipping_cents, totals.shipping)],
    ['tax', 'Tax', centsFromAny(totals.tax_cents, totals.tax)],
    ['credit', 'Credits', centsFromAny(totals.credit_applied_cents, totals.credit_applied)],
    ['total', 'Total', amountCents],
  ].filter(([, , amount]) => amount != null)
    .map(([type, displayText, amount]) => `type:${type},display_text:${displayText},amount:${amount}`)
}

function extractNetworkIdFromChallenge(header?: string): string | undefined {
  if (!header) return undefined
  const request = extractQuotedHeaderValue(header, 'request')
  if (!request) return undefined

  try {
    const decoded = JSON.parse(Buffer.from(base64UrlToBase64(request), 'base64').toString('utf8'))
    return decoded?.methodDetails?.networkId || decoded?.networkId
  } catch {
    return undefined
  }
}

function extractQuotedHeaderValue(header: string, key: string): string | undefined {
  const pattern = new RegExp(`${key}="([^"]+)"`)
  return pattern.exec(header)?.[1]
}

function base64UrlToBase64(value: string): string {
  return `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - (value.length % 4)) % 4)}`
}

function requireCents(values: unknown[], label: string): number {
  const cents = centsFromAny(...values)
  if (cents == null) throw new Error(`Missing ${label}.`)
  return cents
}

function centsFromAny(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10)
    const dollars = trimmed.replace(/[$,]/g, '')
    if (/^-?\d+(\.\d{1,2})?$/.test(dollars)) return Math.round(Number.parseFloat(dollars) * 100)
  }
}

function numberFromAny(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
}

function escapeLinkValue(value: string): string {
  return value.replace(/,/g, ' ')
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
