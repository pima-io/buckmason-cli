import assert from 'node:assert/strict'
import test from 'node:test'
import {productSearchParams} from '../src/lib/products.ts'

test('product search params default to alphabetical catalog search', () => {
  assert.deepEqual(productSearchParams({
    q: 'daily shirt',
    gender: 'm',
    limit: 12,
    page: 2,
  }), {
    q: 'daily shirt',
    gender: 'm',
    color: undefined,
    category: undefined,
    near_zip: undefined,
    in_stock_only: undefined,
    per_page: 12,
    page: 2,
    recently_live: undefined,
    recently_live_days: undefined,
  })
})

test('product search params request newest products through the recently-live API sort', () => {
  assert.deepEqual(productSearchParams({
    gender: 'm',
    category: 'shirts',
    nearZip: '90291',
    inStockOnly: true,
    limit: 24,
    page: 1,
    sort: 'newest',
    days: 45,
  }), {
    q: undefined,
    gender: 'm',
    color: undefined,
    category: 'shirts',
    near_zip: '90291',
    in_stock_only: true,
    per_page: 24,
    page: 1,
    recently_live: true,
    recently_live_days: 45,
  })
})
