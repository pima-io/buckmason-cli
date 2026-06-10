import assert from 'node:assert/strict'
import test from 'node:test'
import {describeFulfillment, renderMppError} from '../src/lib/mpp.ts'

test('describes fulfillment modes', () => {
  assert.equal(describeFulfillment({mode: 'ship_or_pickup'}), 'ship or pickup')
  assert.equal(describeFulfillment({mode: 'ship_only'}), 'ship only — not available for store pickup')
  assert.equal(describeFulfillment({mode: 'pickup_only'}), 'pickup only — cannot be shipped')
  assert.equal(describeFulfillment({mode: 'unavailable'}), 'unavailable — no sellable stock to ship or pick up')
  assert.equal(describeFulfillment(null), '')
})

test('renders fulfillment_unavailable errors with pickup options', () => {
  const lines: string[] = []
  const error = renderMppError((message) => lines.push(message), {
    error: {
      code: 'fulfillment_unavailable',
      message: 'one or more items cannot be fulfilled as requested',
      items: [
        {
          sku: 'BM13211.679NATL',
          size: 'L',
          quantity: 1,
          error: 'not_shippable',
          message: 'BM13211.679NATL is in-store pickup only',
          fulfillment: {ship: false, pickup: true},
          pickup_locations: [{id: 2, name: 'Abbot Kinney', short_name: 'AK'}],
        },
      ],
    },
  })

  assert.equal(error?.code, 'fulfillment_unavailable')
  assert.ok(lines[0].includes('fulfillment_unavailable'))
  assert.ok(lines.some((line) => line.includes('Pickup options for BM13211.679NATL: Abbot Kinney (AK)')))
})

test('notes when no pickup store has stock', () => {
  const lines: string[] = []
  renderMppError((message) => lines.push(message), {
    error: {
      code: 'fulfillment_unavailable',
      message: 'one or more items cannot be fulfilled as requested',
      items: [
        {
          sku: 'BMSKUJY3',
          quantity: 1,
          error: 'not_shippable',
          message: 'BMSKUJY3 has no sellable stock to ship or pick up',
          fulfillment: {ship: false, pickup: false},
          pickup_locations: [],
        },
      ],
    },
  })

  assert.ok(lines.some((line) => line.includes('No pickup store currently has BMSKUJY3 in stock.')))
})

test('returns null for bodies without a structured error', () => {
  assert.equal(renderMppError(() => {}, {payment_required: true}), null)
  assert.equal(renderMppError(() => {}, null), null)
})
