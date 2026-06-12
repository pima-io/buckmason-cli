import assert from 'node:assert/strict'
import test from 'node:test'
import {BUCK_MASON_SUPPORT_INFO, renderSupportInfo} from '../src/lib/support.ts'

test('support info exposes Buck Mason public contact channels', () => {
  assert.equal(BUCK_MASON_SUPPORT_INFO.contact.email, 'help@buckmason.com')
  assert.equal(BUCK_MASON_SUPPORT_INFO.contact.phone, '888-988-5560')
  assert.equal(BUCK_MASON_SUPPORT_INFO.source, 'https://www.buckmason.com/pages/faq')
  assert.ok(BUCK_MASON_SUPPORT_INFO.selfService.some((link) => link.url === 'https://orders.buckmason.com/returns'))
})

test('renders support info for agents', () => {
  const rendered = renderSupportInfo()
  assert.match(rendered, /Buck Mason support/)
  assert.match(rendered, /Email: help@buckmason\.com/)
  assert.match(rendered, /Text or phone: 888-988-5560/)
  assert.match(rendered, /Returns \+ exchanges: https:\/\/orders\.buckmason\.com\/returns/)
})
