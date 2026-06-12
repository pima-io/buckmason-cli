import assert from 'node:assert/strict'
import test from 'node:test'
import {buildCheckoutBody} from '../src/lib/checkout.ts'
import {renderHostedCheckoutResponse} from '../src/lib/hosted-checkout.ts'

test('builds hosted-compatible checkout body from flags', async () => {
  const body = await buildCheckoutBody({
    'line-item': ['BM13211.679NATL:2:abbot-kinney'],
    coupon: 'HOSTED10',
    credit: ['GIFT-CREDIT'],
    'pickup-location-id': 12,
    'shipping-rate-code': 'two-day',
  })

  assert.deepEqual(body, {
    line_items: [
      {
        sku: 'BM13211.679NATL',
        quantity: 2,
        pickup_location_slug: 'abbot-kinney',
      },
    ],
    coupon: 'HOSTED10',
    customer_credit_codes: ['GIFT-CREDIT'],
    pickup_location_id: 12,
    shipping_rate_code: 'two-day',
  })
})

test('rejects empty checkout bodies', async () => {
  await assert.rejects(
    () => buildCheckoutBody({}, {emptyMessage: 'body required'}),
    /body required/,
  )
})

test('renders hosted checkout response with poll command', () => {
  const output = renderHostedCheckoutResponse({
    hosted_checkout_url: 'https://pay.buckmason.com/c/tok_123',
    hosted_checkout_status_url: 'https://pima.io/mcp/buckmason/hosted_checkout/tok_123',
    poll_after_seconds: 3,
    expires_at: '2026-06-12T19:38:08.934Z',
    checkout: {
      token: 'tok_123',
      totals: {charge: '$148.00'},
      line_items: [{sku: 'BM14210.327SBRM', quantity: 1, unit_price: '$148.00'}],
    },
  })

  assert.match(output, /https:\/\/pay\.buckmason\.com\/c\/tok_123/)
  assert.match(output, /charge/)
  assert.match(output, /BM14210\.327SBRM/)
  assert.match(output, /buckmason checkout status tok_123 --watch/)
})
