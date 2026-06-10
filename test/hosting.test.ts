import assert from 'node:assert/strict'
import test from 'node:test'
import {hostingOptions, hostingSafetyNotes} from '../src/lookbook/hosting.ts'

test('uses wrangler-backed Cloudflare Pages as the default host', () => {
  const [first] = hostingOptions()

  assert.equal(first.id, 'cloudflare-pages')
  assert.match(first.probe, /wrangler/)
  assert.match(first.deploy_hint, /wrangler pages deploy/)
})

test('keeps Vercel as a durable hosted fallback', () => {
  const permanent = hostingOptions('permanent').map((option) => option.id)

  assert.deepEqual(permanent, ['cloudflare-pages', 'vercel', 's3'])
})

test('offers local Tailscale for private review', () => {
  const [first] = hostingOptions('private')

  assert.equal(first.id, 'local-tailscale')
  assert.match(first.deploy_hint, /http\.server/)
})

test('surfaces publish safety notes', () => {
  assert(hostingSafetyNotes().some((note) => note.includes('Confirm before publishing')))
})
