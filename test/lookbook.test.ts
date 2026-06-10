import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {scoreEvent} from '../src/lookbook/score-event.ts'
import {rankVotes, handoff} from '../src/lookbook/rank-votes.ts'
import {buildHtmlLookbook} from '../src/lookbook/build-html.ts'
import {validateLookbookDir} from '../src/lookbook/validate.ts'
import {parseProfile} from '../src/lookbook/profile.ts'
import {buildLookbookImagePlan} from '../src/lookbook/image-generation.ts'

test('scores formal travel events as premium', () => {
  const result = scoreEvent({
    title: 'Wedding weekend in Santa Barbara',
    description: 'Smart casual welcome drinks and cocktail wedding',
    duration_days: 3,
    is_travel: true,
  })

  assert.equal(result.action, 'premium')
  assert.equal(result.breakdown.type, 4)
})

test('medical appointments are hard vetoed', () => {
  const result = scoreEvent({title: 'Doctor appointment'})
  assert.equal(result.score, -10)
  assert.equal(result.action, 'skip')
})

test('ranks positive item votes and emits handoff', () => {
  const manifest = {
    title: 'Test Lookbook',
    looks: [{id: 'look1', eyebrow: 'Look 01'}],
    items: [{sku: 'SKU1', name: 'Tee', size: 'M', price_cents: 9800, look_id: 'look1'}],
  }
  const tally = {count: 2, items: {SKU1: {up: 2, down: 0}}, looks: {look1: {up: 1, down: 0}}}
  const ranked = rankVotes(manifest, tally)

  assert.equal(ranked.recommended.length, 1)
  assert.match(handoff(manifest, ranked.recommended, ranked.rankedLooks as any[], tally), /Tee - size M/)
})

test('builds and validates a deterministic HTML lookbook', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'buckmason-lookbook-'))
  const configPath = path.join(dir, 'config.json')
  const picksPath = path.join(dir, 'picks.json')
  const outDir = path.join(dir, 'out')
  await writeFile(configPath, JSON.stringify({
    lookbook_id: 'test-lookbook',
    lookbook_title: 'Test Lookbook',
    lookbook_date: '2026-06-09',
    page_url: 'https://example.com/lookbook/',
    looks: [{id: 'look1', eyebrow: 'Look 01', title: 'First Look'}],
  }))
  await writeFile(picksPath, JSON.stringify([
    {
      look: 'look1',
      id: 1,
      sku: 'SKU1',
      name: 'Tee',
      color: 'Navy',
      picked_size: 'M',
      price: '$98',
      price_cents: 9800,
      url: 'https://www.buckmason.com/products/tee',
      image_url: 'https://cdn.example.com/tee.jpg',
      in_stock_online: {label: 'In stock'},
    },
  ]))

  const result = await buildHtmlLookbook({configPath, picksPath, outDir, noTryon: true})
  const html = await readFile(result.indexPath, 'utf8')
  assert.match(html, /Test Lookbook/)
  assert.match(html, /Editorial tier/)

  const validation = await validateLookbookDir(outDir)
  assert.equal(validation.ok, true)
})

test('parses profile reference photos, sizes, and link payment preferences', () => {
  const profile = parseProfile(`
gender: m
preferred_lookbook_host_auto: false
style_ethos: "relaxed European cool"

## Sizes
- shirt: L
- pant: 31

preferred_link_payment_methods:
  checkout: 4242

## Reference photos
- /Users/test/portrait.jpg (front)
- /Users/test/body.png # body
`)

  assert.equal(profile.gender, 'm')
  assert.equal(profile.preferred_lookbook_host_auto, false)
  assert.deepEqual(profile.sizes, {shirt: 'L', pant: '31'})
  assert.deepEqual(profile.reference_photos, ['/Users/test/portrait.jpg', '/Users/test/body.png'])
  assert.deepEqual(profile.preferred_link_payment_methods, {checkout: '4242'})
})

test('image plan puts garments before identity references and adds critical garment locks', () => {
  const plan = buildLookbookImagePlan({
    config: {
      lookbook_id: 'test-lookbook',
      looks: [{id: 'look1', title: 'First Look', setting: 'Tan plaster wall, dark wood door.', composition: 'Full body, three-quarter angle.'}],
    },
    profile: {
      reference_photos: ['/Users/test/portrait.jpg', '/Users/test/body.jpg'],
      height: '6 feet',
      beard: 'short beard',
    },
    picks: [{
      look: 'look1',
      name: 'Suede Jacket',
      category: 'Jackets',
      color: 'Tobacco',
      picked_size: 'L',
      try_on: {url: 'https://cdn.example.com/jacket.jpg'},
    }],
  })

  assert.equal(plan.model, 'gpt-image-2')
  assert.equal(plan.looks[0].garments[0].role, 'garment')
  assert.equal(plan.looks[0].identity_references[0].role, 'identity')
  assert.match(plan.looks[0].prompt, /Images 1-1 are garment references/)
  assert.match(plan.looks[0].prompt, /Images 2-3 are identity references/)
  assert.match(plan.looks[0].prompt, /CRITICAL JACKET LOCK/)
  assert.match(plan.looks[0].prompt, /Do NOT smooth the customer/)
})

test('premium build rejects look images from another lookbook marker', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'buckmason-lookbook-marker-'))
  const configPath = path.join(dir, 'config.json')
  const picksPath = path.join(dir, 'picks.json')
  const outDir = path.join(dir, 'out')
  const looksDir = path.join(dir, 'looks')
  await mkdir(looksDir)
  await writeFile(path.join(looksDir, '.lookbook_id'), 'other-lookbook\n')
  await writeFile(path.join(looksDir, 'look1.png'), 'not-a-real-png')
  await writeFile(configPath, JSON.stringify({
    lookbook_id: 'test-lookbook',
    lookbook_title: 'Test Lookbook',
    lookbook_date: '2026-06-09',
    page_url: 'https://example.com/lookbook/',
    looks: [{id: 'look1', eyebrow: 'Look 01', title: 'First Look'}],
  }))
  await writeFile(picksPath, JSON.stringify([]))

  await assert.rejects(
    () => buildHtmlLookbook({configPath, picksPath, outDir, lookImagesDir: looksDir}),
    /does not match/,
  )
})
