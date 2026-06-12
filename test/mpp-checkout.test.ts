import assert from 'node:assert/strict'
import {Buffer} from 'node:buffer'
import test from 'node:test'
import {
  buildLinkSpendRequestInput,
  extractSharedPaymentToken,
  latestSpendRequest,
} from '../src/lib/mpp-checkout.ts'

test('builds Link spend request input from checkout preview body', () => {
  const input = buildLinkSpendRequestInput({
    network_id: 'profile_123',
    suggested_context: 'Authorize a $160.21 charge by Buck Mason for one fatigue short in size M through Link approval before the agent completes the MPP checkout.',
    totals: {
      subtotal_cents: 14800,
      shipping_cents: 0,
      tax_cents: 1221,
      charge: 16021,
    },
    line_items: [
      {
        sku: 'BM14210.327SBRM',
        name: 'Sepia Brown 7.5 inch Loomed Linen OG-107 Fatigue Short',
        quantity: 1,
        unit_price: 14800,
      },
    ],
  })

  assert.equal(input.amountCents, 16021)
  assert.equal(input.currency, 'usd')
  assert.equal(input.networkId, 'profile_123')
  assert.deepEqual(input.lineItems, [
    'name:Sepia Brown 7.5 inch Loomed Linen OG-107 Fatigue Short,quantity:1,unit_amount:14800',
  ])
  assert.ok(input.lineItems[0].includes('unit_amount:14800'))
  assert.ok(!input.lineItems[0].includes(',amount:'))
  assert.deepEqual(input.totals, [
    'type:subtotal,display_text:Subtotal,amount:14800',
    'type:shipping,display_text:Shipping,amount:0',
    'type:tax,display_text:Tax,amount:1221',
    'type:total,display_text:Total,amount:16021',
  ])
})

test('extracts network id from WWW-Authenticate challenge when body omits it', () => {
  const request = Buffer.from(JSON.stringify({
    amount: '16021',
    currency: 'usd',
    methodDetails: {networkId: 'profile_from_challenge'},
  })).toString('base64url')
  const input = buildLinkSpendRequestInput(
    {
      totals: {charge: '$160.21'},
      line_items: [{sku: 'BM14210.327SBRM', quantity: 1}],
    },
    `Payment id="abc", realm="pima.io", method="stripe", intent="charge", request="${request}"`,
  )

  assert.equal(input.amountCents, 16021)
  assert.equal(input.networkId, 'profile_from_challenge')
})

test('normalizes Link spend request responses', () => {
  assert.deepEqual(latestSpendRequest([{status: 'pending'}, {status: 'approved'}]), {status: 'approved'})
  assert.equal(extractSharedPaymentToken({shared_payment_token: {id: 'spt_123'}}), 'spt_123')
  assert.equal(extractSharedPaymentToken({shared_payment_token: 'spt_456'}), 'spt_456')
})
