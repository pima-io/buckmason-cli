import assert from 'node:assert/strict'
import test from 'node:test'
import {DEFAULT_PIMA_KEY, resolvePimaKey} from '../src/lib/config.ts'

test('uses the built-in Buck Mason public PIMA key by default', () => {
  const previous = process.env.BUCKMASON_PIMA_KEY
  delete process.env.BUCKMASON_PIMA_KEY

  try {
    assert.equal(resolvePimaKey(), DEFAULT_PIMA_KEY)
  } finally {
    if (previous === undefined) delete process.env.BUCKMASON_PIMA_KEY
    else process.env.BUCKMASON_PIMA_KEY = previous
  }
})

test('lets explicit and environment PIMA keys override the default', () => {
  const previous = process.env.BUCKMASON_PIMA_KEY
  process.env.BUCKMASON_PIMA_KEY = 'env-key'

  try {
    assert.equal(resolvePimaKey(), 'env-key')
    assert.equal(resolvePimaKey('flag-key'), 'flag-key')
  } finally {
    if (previous === undefined) delete process.env.BUCKMASON_PIMA_KEY
    else process.env.BUCKMASON_PIMA_KEY = previous
  }
})
