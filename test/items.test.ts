import assert from 'node:assert/strict'
import test from 'node:test'
import {parseCartItemSpec, parseCheckoutLineItemSpec} from '../src/lib/items.ts'

test('parses cart item specs', () => {
  assert.deepEqual(parseCartItemSpec('10543:L:2'), {
    slug_or_code: '10543',
    size: 'L',
    qty: 2,
  })
})

test('defaults cart item quantity to one', () => {
  assert.deepEqual(parseCartItemSpec('Daily-Shirt:XL'), {
    slug_or_code: 'Daily-Shirt',
    size: 'XL',
    qty: 1,
  })
})

test('parses checkout line item specs', () => {
  assert.deepEqual(parseCheckoutLineItemSpec('BM13211.679NATL:2:abbot-kinney'), {
    sku: 'BM13211.679NATL',
    quantity: 2,
    pickup_location_slug: 'abbot-kinney',
  })
})

test('rejects invalid quantities', () => {
  assert.throws(() => parseCartItemSpec('10543:L:0'), /positive integer/)
  assert.throws(() => parseCheckoutLineItemSpec('SKU:-1'), /positive integer/)
})
