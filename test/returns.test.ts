import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildReturnItem,
  extractReturnItemsFromJson,
  parseReturnItemSpec,
} from '../src/lib/returns.ts'

test('builds an original return item by default', () => {
  assert.deepEqual(buildReturnItem({orderItemId: 12, reasonId: 3}), {
    order_item_id: 12,
    return_reason_id: 3,
    return_type: 'original',
  })
})

test('exchange sku id turns a return item into an exchange', () => {
  assert.deepEqual(buildReturnItem({orderItemId: 12, reasonId: 3, exchangeSkuId: 45}), {
    order_item_id: 12,
    return_reason_id: 3,
    return_type: 'exchange',
    exchange_sku_id: 45,
  })
})

test('exchange type requires an exchange sku id', () => {
  assert.throws(() => buildReturnItem({orderItemId: 12, reasonId: 3, type: 'exchange'}), /exchange-sku-id/)
})

test('exchange sku id cannot be combined with a non-exchange type', () => {
  assert.throws(() => buildReturnItem({orderItemId: 12, reasonId: 3, type: 'credit', exchangeSkuId: 45}), /only be used/)
})

test('parses repeatable return item specs', () => {
  assert.deepEqual(buildReturnItem(parseReturnItemSpec('12:3:exchange:45')), {
    order_item_id: 12,
    return_reason_id: 3,
    return_type: 'exchange',
    exchange_sku_id: 45,
  })
})

test('extracts return items from RMS shaped JSON', () => {
  assert.deepEqual(extractReturnItemsFromJson({
    customer_return: {
      items_attributes: [
        {order_item_id: 12, return_reason_id: 3, return_type: 'credit'},
        {orderItemId: 13, reasonId: 4, type: 'exchange', exchangeSkuId: 46},
      ],
    },
  }), [
    {
      order_item_id: 12,
      return_reason_id: 3,
      return_type: 'credit',
    },
    {
      order_item_id: 13,
      return_reason_id: 4,
      return_type: 'exchange',
      exchange_sku_id: 46,
    },
  ])
})
