import assert from 'node:assert/strict'
import test from 'node:test'
import {buildCheckoutBody} from '../src/lib/checkout.ts'

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
