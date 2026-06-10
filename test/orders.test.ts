import assert from 'node:assert/strict'
import test from 'node:test'
import {summarizeOrderItems} from '../src/lib/orders.ts'

test('summarizes returnable and blocked order items', () => {
  const items = summarizeOrderItems({
    items: [
      {
        id: 1,
        product: 'Pima Tee',
        color: 'Black',
        size: 'M',
        sku: 'BMTEE.BLKM',
        status: 'completed',
        rms_status: 'completed',
        rms_returnable: true,
        shipment: {display_status: 'delivered'},
      },
      {
        id: 2,
        product: 'Pima Tee',
        color: 'Black',
        size: 'L',
        sku: 'BMTEE.BLKL',
        status: 'new',
        rms_status: 'Pending Shipment',
        rms_returnable: true,
        shipment: {display_status: 'preparing'},
      },
      {
        id: 3,
        product: 'Hemmed Pant',
        color: 'Navy',
        size: '32',
        sku: 'BMPANT.NVY32',
        status: 'completed',
        rms_status: 'completed',
        rms_returnable: true,
        alterations: [{id: 10}],
        shipment: {display_status: 'delivered'},
      },
      {
        id: 4,
        product: 'Canceled Shirt',
        shipment: {display_status: 'canceled'},
      },
    ],
  })

  assert.deepEqual(items.map((item) => [item.id, item.returnable, item.return_blocker]), [
    [1, true, ''],
    [2, false, 'Preparing'],
    [3, false, 'Altered item'],
  ])
})
