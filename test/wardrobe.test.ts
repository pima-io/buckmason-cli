import assert from 'node:assert/strict'
import test from 'node:test'
import {buildWardrobeFromOrders, findWardrobeItem, matchNewProducts, outfitSuggestion, pairWithWardrobe, searchWardrobe} from '../src/lib/wardrobe.ts'

const orders = [
  {
    code: 'BM100',
    completed_at: '2026-05-01T12:00:00Z',
    items: [
      {
        id: 1,
        product: 'Full Saddle Jeans',
        color: 'Faded Indigo',
        size: '31',
        sku: 'BMJEAN.IND31',
        status: 'completed',
        rms_status: 'completed',
        shipment: {display_status: 'delivered'},
      },
      {
        id: 2,
        product: 'Field-Spec Cotton Surplus Tee',
        color: 'Natural',
        size: 'L',
        sku: 'BMTEE.NATL',
        status: 'completed',
        rms_status: 'completed',
        shipment: {display_status: 'delivered'},
      },
      {
        id: 3,
        product: 'Suede Jacket',
        color: 'Tobacco',
        size: 'L',
        sku: 'BMJKT.TOBL',
        status: 'new',
        rms_status: 'new',
        shipment: {display_status: 'preparing'},
      },
    ],
  },
]

test('builds local wardrobe from order history and classifies ownership state', () => {
  const wardrobe = buildWardrobeFromOrders(orders)
  assert.equal(wardrobe.items.length, 3)
  assert.equal(findWardrobeItem(wardrobe.items, 'BMJEAN.IND31')?.status, 'owned')
  assert.equal(findWardrobeItem(wardrobe.items, 'BMJKT.TOBL')?.status, 'not_in_hand')
  assert.deepEqual(searchWardrobe(wardrobe.items, 'faded jeans').map((item) => item.sku), ['BMJEAN.IND31'])
})

test('pairs owned wardrobe items with an anchor', () => {
  const wardrobe = buildWardrobeFromOrders(orders)
  const anchor = findWardrobeItem(wardrobe.items, 'jeans')
  assert(anchor)
  const pairings = pairWithWardrobe(anchor, wardrobe.items)
  assert.equal(pairings[0].item.sku, 'BMTEE.NATL')
  assert.match(pairings[0].reasons.join(' '), /natural outfit pairing/)
})

test('matches new catalog products against an owned anchor and skips duplicates', () => {
  const wardrobe = buildWardrobeFromOrders(orders)
  const anchor = findWardrobeItem(wardrobe.items, 'BMJEAN.IND31')
  assert(anchor)
  const matches = matchNewProducts(anchor, [
    {id: 10, name: 'Field-Spec Cotton Surplus Tee', color: 'Natural', price: '$68', online_in_stock: true},
    {id: 11, name: 'Pima Curved Hem Tee', color: 'White', price: '$48', online_in_stock: true, url: 'https://example.test/tee'},
    {id: 12, name: 'Canvas Work Jacket', color: 'Olive', price: '$228', online_in_stock: true},
  ], wardrobe.items)

  assert.equal(matches[0].product.name, 'Pima Curved Hem Tee')
  assert(matches.every((match) => match.product.name !== 'Field-Spec Cotton Surplus Tee'))
})

test('suggests a simple outfit from owned pieces', () => {
  const outfit = outfitSuggestion(buildWardrobeFromOrders(orders).items, {occasion: 'weekend', weather: 'warm'})
  assert.deepEqual(outfit.map((item) => item.sku), ['BMJEAN.IND31', 'BMTEE.NATL'])
})
