import {parseCheckoutLineItemSpec} from './items.js'
import {readJsonObject} from './json-input.js'

export interface CheckoutBodyOptions {
  emptyMessage?: string
}

export async function buildCheckoutBody(
  flags: Record<string, any>,
  options: CheckoutBodyOptions = {},
): Promise<Record<string, any>> {
  const body = flags.body ? await readJsonObject(flags.body) : {}
  if (flags['line-item']?.length) body.line_items = flags['line-item'].map(parseCheckoutLineItemSpec)
  if (flags.buyer) body.buyer = await readJsonObject(flags.buyer)
  if (flags.address) body.fulfillment_address = await readJsonObject(flags.address)
  if (flags.coupon) body.coupon = flags.coupon
  if (flags.credit?.length) body.customer_credit_codes = flags.credit
  if (flags['pickup-location-slug']) body.pickup_location_slug = flags['pickup-location-slug']
  if (flags['pickup-location-id'] != null) body.pickup_location_id = flags['pickup-location-id']
  if (flags['shipping-rate-code']) body.shipping_rate_code = flags['shipping-rate-code']
  if (flags['shipping-rate-id'] != null) body.shipping_rate_id = flags['shipping-rate-id']
  if (flags['shipping-rate-name']) body.shipping_rate_name = flags['shipping-rate-name']
  if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
    throw new Error(options.emptyMessage || 'Checkout needs --body with line_items or at least one --line-item.')
  }

  return body
}
