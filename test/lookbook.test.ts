import assert from 'node:assert/strict'
import {access, chmod, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {scoreEvent} from '../src/lookbook/score-event.ts'
import {rankVotes, handoff} from '../src/lookbook/rank-votes.ts'
import {buildHtmlLookbook} from '../src/lookbook/build-html.ts'
import {prepareCloudflarePagesDeploy} from '../src/lookbook/deploy.ts'
import {validateLookbookDir} from '../src/lookbook/validate.ts'
import {parseProfile} from '../src/lookbook/profile.ts'
import {buildLookbookImagePlan} from '../src/lookbook/image-generation.ts'
import {
  buildLookRecheckPrompt,
  buildOutfitRecheckReport,
  failedLookIds,
  filterImagePlanLooks,
  imagePlanWithRecheckAddenda,
  normalizeOutfitRecheckResponse,
  renderOutfitRecheckSummary,
  type OutfitRecheckLookInput,
} from '../src/lookbook/recheck.ts'
import {buildTripArtifacts, buildTripConfig, buildTripPicks, smokeCheckLookbook, type TripPlan} from '../src/lookbook/trip.ts'

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
  const assetPath = path.join(dir, 'tee.jpg')
  await writeFile(assetPath, 'fake-image')
  await writeFile(configPath, JSON.stringify({
    lookbook_id: 'test-lookbook',
    lookbook_title: 'Test Lookbook',
    lookbook_date: '2026-06-09',
    page_url: 'https://example.com/lookbook/',
    stock_refresh: {preferred_location: 'Hayes Valley'},
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
      image_url: assetPath,
      in_stock_online: {label: 'In stock'},
      fulfillment: {pickup_locations: [{name: 'Hayes Valley', short_name: 'HV'}]},
    },
    {
      look: 'look1',
      id: 2,
      sku: 'SKU2',
      name: 'Jeans',
      color: 'Indigo',
      picked_size: '32',
      price: '$198',
      price_cents: 19800,
      url: 'https://www.buckmason.com/products/jeans',
      image_url: assetPath,
      in_stock_online: {label: 'In stock'},
    },
  ]))

  const result = await buildHtmlLookbook({configPath, picksPath, outDir, noTryon: true})
  const html = await readFile(result.indexPath, 'utf8')
  assert.match(html, /Test Lookbook/)
  assert.match(html, /Editorial tier/)
  assert.match(html, /stock-refresh/)
  assert.match(html, /Size M · HV · In stock/)
  assert.match(html, /Size 32 · Online · In stock/)
  assert.match(html, /Select this outfit/)
  assert.match(html, /thumb-1\.jpg/)
  await access(path.join(outDir, 'og.jpg'))
  await access(path.join(outDir, 'thumb-1.jpg'))
  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'))
  assert.equal(manifest.items[0].stock.source, 'HV')
  assert.equal(manifest.items[1].stock.source, 'Online')

  const validation = await validateLookbookDir(outDir)
  assert.equal(validation.ok, true)
})

test('Cloudflare deploy prep injects optimized voting assets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'buckmason-lookbook-voting-'))
  const configPath = path.join(dir, 'config.json')
  const picksPath = path.join(dir, 'picks.json')
  const outDir = path.join(dir, 'out')
  const assetPath = path.join(dir, 'tee.jpg')
  let voteRoomWorkerDir: string | undefined
  await writeFile(assetPath, 'fake-image')
  await writeFile(configPath, JSON.stringify({
    lookbook_id: 'test-lookbook',
    lookbook_title: 'Test Lookbook',
    lookbook_date: '2026-06-09',
    page_url: 'https://example.com/lookbook/',
    looks: [{id: 'look1', eyebrow: 'Look 01', title: 'First Look'}],
  }))
  await writeFile(picksPath, JSON.stringify([{
    look: 'look1',
    id: 1,
    sku: 'SKU1',
    name: 'Tee',
    picked_size: 'M',
    price_cents: 9800,
    url: 'https://www.buckmason.com/products/tee',
    image_url: assetPath,
    in_stock_online: {label: 'In stock'},
  }]))

  await buildHtmlLookbook({configPath, picksPath, outDir, noTryon: true})
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('network disabled in test')
  }) as typeof fetch
  try {
    const prepared = await prepareCloudflarePagesDeploy({
      dir: outDir,
      project: 'buckmason-test-lookbook',
      kvId: 'kv123',
    })
    assert.equal(prepared.voting, true)
    assert.ok(prepared.voteRoomWorkerDir)
    voteRoomWorkerDir = prepared.voteRoomWorkerDir
  } finally {
    globalThis.fetch = originalFetch
  }

  const html = await readFile(path.join(outDir, 'index.html'), 'utf8')
  const voteFunction = await readFile(path.join(outDir, 'functions/api/vote.js'), 'utf8')
  const votesFunction = await readFile(path.join(outDir, 'functions/api/votes.js'), 'utf8')
  const liveFunction = await readFile(path.join(outDir, 'functions/api/votes/live.js'), 'utf8')
  const wranglerToml = await readFile(path.join(outDir, 'wrangler.toml'), 'utf8')
  if (!voteRoomWorkerDir) throw new Error('missing generated VoteRoom worker directory')
  const voteRoomWorker = await readFile(path.join(voteRoomWorkerDir, 'vote-room-worker.js'), 'utf8')
  const tallyBlock = voteRoomWorker.slice(
    voteRoomWorker.indexOf('  buildTally()'),
    voteRoomWorker.indexOf('  activityBuckets()'),
  )

  assert.match(html, /vote-look-inline/)
  assert.match(html, /vote-piece-inline/)
  assert.match(html, /class="vote-dock"/)
  assert.match(html, /connectLiveVotes/)
  assert.match(voteFunction, /vote-room\.internal\/vote/)
  assert.match(voteFunction, /env\.VOTE_ROOM/)
  assert.doesNotMatch(voteFunction, /LOOKBOOK_VOTES\.put/)
  assert.match(votesFunction, /vote-room\.internal\/tally/)
  assert.match(votesFunction, /caches\.default/)
  assert.doesNotMatch(votesFunction, /LOOKBOOK_VOTES\.(list|get)/)
  assert.match(liveFunction, /Expected WebSocket upgrade/)
  assert.match(liveFunction, /env\.VOTE_ROOM/)
  assert.match(voteRoomWorker, /CREATE TABLE IF NOT EXISTS ballots/)
  assert.match(voteRoomWorker, /INSERT OR REPLACE INTO ballots/)
  assert.match(voteRoomWorker, /transactionSync/)
  assert.match(voteRoomWorker, /legacy_kv_imported/)
  assert.match(voteRoomWorker, /LOOKBOOK_VOTES\.list/)
  assert.doesNotMatch(tallyBlock, /LOOKBOOK_VOTES/)
  assert.match(wranglerToml, /script_name = "buckmason-test-lookbook-vote-room"/)
})

test('trip lookbook hydrates selected products and enforces complete looks', async () => {
  const plan: TripPlan = {
    person: 'john-collison',
    destination: 'Spain',
    month: '2026-08',
    near_zip: '10003',
    preferred_location: 'Hayes Valley',
    looks: [{
      title: 'Madrid Gallery Day',
      products: [{id: 1, size: 'M'}, {id: 2, size: '32'}],
    }, {
      title: 'Fogline Sweater Day',
      products: [{id: 3, size: 'M'}, {id: 4, size: '32'}],
    }],
  }
  const profile = {sizes: {shirt: 'M', pant: '32'}}
  const products = new Map<string, any>([
    ['1', {
      id: 1,
      name: 'Natural Stripe Shirt',
      color: 'Natural Stripe',
      category: 'Shirts',
      price_cents: 16800,
      price: '$168.00',
      url: 'https://www.buckmason.com/products/shirt',
      image_url: 'https://cdn.example.com/shirt.jpg',
      images: [{url: 'https://cdn.example.com/shirt-flat.jpg', type: 'shopify', position: 1}],
      variants: [{
        sku: 'SHIRTM',
        size: 'M',
        shopify_variant_id: 'v1',
        online: {in_stock: true, status: 'in_stock', label: 'In stock'},
        fulfillment: {pickup_locations: [{name: 'Hayes Valley', short_name: 'HV'}]},
      }],
    }],
    ['2', {
      id: 2,
      name: 'Linen Trouser',
      color: 'Natural',
      category: 'Pants',
      price_cents: 19800,
      price: '$198.00',
      url: 'https://www.buckmason.com/products/trouser',
      image_url: 'https://cdn.example.com/trouser.jpg',
      images: [{url: 'https://cdn.example.com/trouser-flat.jpg', type: 'shopify', position: 1}],
      variants: [{
        sku: 'PANT32',
        size: '32',
        shopify_variant_id: 'v2',
        online: {in_stock: true, status: 'low_stock', label: 'Low stock (3 left)'},
        fulfillment: {pickup_locations: []},
      }],
    }],
    ['3', {
      id: 3,
      name: 'Brown Anatomica Mock Neck Sweater',
      color: 'Brown',
      category: 'Anatomica',
      style: 'Sweaters',
      product_line: 'Anatomica Wool Mock Neck Sweater',
      price_cents: 25000,
      price: '$250.00',
      url: 'https://www.buckmason.com/products/brown-anatomica-wool-mock-neck-sweater',
      image_url: 'https://cdn.example.com/sweater.jpg',
      images: [{url: 'https://cdn.example.com/sweater-flat.jpg', type: 'shopify', position: 1}],
      variants: [{
        sku: 'SWEATERM',
        size: 'M',
        shopify_variant_id: 'v3',
        online: {in_stock: true, status: 'low_stock', label: 'Low stock (3 left)'},
        fulfillment: {pickup_locations: []},
      }],
    }],
    ['4', {
      id: 4,
      name: 'Ford Standard Jean',
      color: 'Indigo',
      category: 'Jeans',
      price_cents: 19800,
      price: '$198.00',
      url: 'https://www.buckmason.com/products/jean',
      image_url: 'https://cdn.example.com/jean.jpg',
      images: [{url: 'https://cdn.example.com/jean-flat.jpg', type: 'shopify', position: 1}],
      variants: [{
        sku: 'JEAN32',
        size: '32',
        shopify_variant_id: 'v4',
        online: {in_stock: true, status: 'in_stock', label: 'In stock'},
        fulfillment: {pickup_locations: []},
      }],
    }],
  ])
  const client = {mcpGet: async (endpoint: string) => products.get(endpoint.split('/').pop() || '')} as any

  const artifacts = buildTripArtifacts({plan, runsDir: '/tmp/runs'})
  const config = buildTripConfig(plan, artifacts)
  const picks = await buildTripPicks({client, plan, profile})

  assert.equal(artifacts.lookbookId, '2026-08-john-collison')
  assert.equal(config.lookbook_title, 'John Collison · Spain August 2026 Edit')
  assert.deepEqual(picks.map((pick) => pick.sku), ['SHIRTM', 'PANT32', 'SWEATERM', 'JEAN32'])
  assert.equal(picks[0].in_stock_online.label, 'In stock online; pickup available at Hayes Valley for size M')
  assert.equal(picks[2].style, 'Sweaters')
  assert.equal(picks[2].product_line, 'Anatomica Wool Mock Neck Sweater')
})

test('trip lookbook rejects incomplete looks before image generation', async () => {
  const plan: TripPlan = {
    destination: 'Spain',
    month: '2026-08',
    looks: [{title: 'Top Only', products: [{id: 1, size: 'M'}]}],
  }
  const client = {
    mcpGet: async () => ({
      id: 1,
      name: 'Camp Shirt',
      category: 'Shirts',
      variants: [{sku: 'SHIRTM', size: 'M', online: {in_stock: true, status: 'in_stock', label: 'In stock'}}],
    }),
  } as any

  await assert.rejects(
    () => buildTripPicks({client, plan, profile: {sizes: {shirt: 'M'}}}),
    /look1 is missing a bottom/,
  )
})

test('trip smoke check verifies page, manifest, voting, live endpoint, and og image', async () => {
  const fakeFetch = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input))
    if (url.pathname === '/') return new Response('ok', {status: 200})
    if (url.pathname === '/lookbook.json') {
      return Response.json({schema: 'buck-mason-lookbook-manifest', title: 'Spain', tier: 'premium'})
    }
    if (url.pathname === '/api/votes') return Response.json({ok: true})
    if (url.pathname === '/api/votes/live') return new Response('Expected WebSocket upgrade', {status: 426})
    if (url.pathname === '/og.jpg') return new Response('jpeg', {status: 200, headers: {'content-type': 'image/jpeg'}})
    return new Response('missing', {status: 404})
  }) as typeof fetch

  const result = await smokeCheckLookbook('https://example.pages.dev', fakeFetch)

  assert.equal(result.ok, true)
  assert.equal(result.page_status, 200)
  assert.equal(result.manifest_title, 'Spain')
  assert.equal(result.manifest_tier, 'premium')
  assert.equal(result.live_status, 426)
  assert.equal(result.og_content_type, 'image/jpeg')
})

test('Cloudflare deploy prep defaults to the LOOKBOOK_VOTES namespace', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'buckmason-lookbook-default-voting-'))
  const binDir = path.join(dir, 'bin')
  const configPath = path.join(dir, 'config.json')
  const picksPath = path.join(dir, 'picks.json')
  const outDir = path.join(dir, 'out')
  const assetPath = path.join(dir, 'tee.jpg')
  const wranglerPath = path.join(binDir, 'wrangler')
  await mkdir(binDir)
  await writeFile(assetPath, 'fake-image')
  await writeFile(configPath, JSON.stringify({
    lookbook_id: 'default-voting-test',
    lookbook_title: 'Default Voting Test',
    lookbook_date: '2026-06-09',
    page_url: 'https://example.com/lookbook/',
    looks: [{id: 'look1', eyebrow: 'Look 01', title: 'First Look'}],
  }))
  await writeFile(picksPath, JSON.stringify([{
    look: 'look1',
    id: 1,
    sku: 'SKU1',
    name: 'Tee',
    picked_size: 'M',
    price_cents: 9800,
    url: 'https://www.buckmason.com/products/tee',
    image_url: assetPath,
    in_stock_online: {label: 'In stock'},
  }]))
  await writeFile(wranglerPath, `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ')
if (args === 'kv namespace list') {
  console.log(JSON.stringify([{id: 'default-kv123', title: 'LOOKBOOK_VOTES'}]))
  process.exit(0)
}
console.error('Unexpected wrangler args: ' + args)
process.exit(1)
`)
  await chmod(wranglerPath, 0o755)

  await buildHtmlLookbook({configPath, picksPath, outDir, noTryon: true})
  const originalFetch = globalThis.fetch
  const originalPath = process.env.PATH
  const originalKvTitle = process.env.LOOKBOOK_VOTES_KV_TITLE
  globalThis.fetch = (async () => {
    throw new Error('network disabled in test')
  }) as typeof fetch
  process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`
  delete process.env.LOOKBOOK_VOTES_KV_TITLE
  try {
    const prepared = await prepareCloudflarePagesDeploy({
      dir: outDir,
      project: 'buckmason-default-voting-test',
    })
    assert.equal(prepared.voting, true)
    assert.ok(prepared.voteRoomWorkerDir)
  } finally {
    globalThis.fetch = originalFetch
    process.env.PATH = originalPath
    if (originalKvTitle === undefined) delete process.env.LOOKBOOK_VOTES_KV_TITLE
    else process.env.LOOKBOOK_VOTES_KV_TITLE = originalKvTitle
  }

  const wranglerToml = await readFile(path.join(outDir, 'wrangler.toml'), 'utf8')
  assert.match(wranglerToml, /binding = "LOOKBOOK_VOTES"/)
  assert.match(wranglerToml, /id = "default-kv123"/)
  assert.match(wranglerToml, /name = "VOTE_ROOM"/)
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

test('outfit recheck prompt calls out garment order and wrong-bottom hard failures', () => {
  const look: OutfitRecheckLookInput = {
    id: 'look2',
    title: 'HQ Comms Briefing',
    heroPath: '/tmp/look2.png',
    pieces: [
      {index: 1, sku: 'JACKETM', name: 'Dress Navy Carry-On Jacket', category: 'Outerwear', color: 'Dress Navy', size: 'M', imageUrl: 'https://cdn.example.com/jacket.jpg'},
      {index: 2, sku: 'POLOM', name: 'Black Johnny Collar Polo', category: 'Tees', color: 'Black', size: 'M', imageUrl: 'https://cdn.example.com/polo.jpg'},
      {index: 3, sku: 'N00932', name: 'N009 Japanese Denim Maverick Slim Jean', category: 'Jeans', color: 'N009', size: '32', imageUrl: 'https://cdn.example.com/n009.jpg'},
    ],
  }

  const prompt = buildLookRecheckPrompt(look)

  assert.match(prompt, /Image 1 is the generated lookbook hero image/)
  assert.match(prompt, /Images 2-4 are the exact garment references/)
  assert.match(prompt, /N009 Japanese Denim Maverick Slim Jean/)
  assert.match(prompt, /Wrong color family/)
  assert.match(prompt, /bottoms rendered dark when the product reference is pale/)
})

test('outfit recheck normalizes wrong jeans into a hard failure report', () => {
  const look: OutfitRecheckLookInput = {
    id: 'look2',
    title: 'HQ Comms Briefing',
    heroPath: '/tmp/look2.png',
    pieces: [{index: 1, sku: 'N00932', name: 'N009 Japanese Denim Maverick Slim Jean', category: 'Jeans', color: 'N009', size: '32'}],
  }
  const result = normalizeOutfitRecheckResponse({
    look_id: 'model-echoed-wrong-id',
    overall_pass: false,
    severity: 'hard_fail',
    items: [{
      sku: 'N00932',
      expected: 'pale ecru/off-white N009 jean',
      observed: 'dark indigo denim',
      pass: false,
      severity: 'hard_fail',
      note: 'Wrong jean color.',
    }],
    regeneration_prompt_addendum: 'Garment 1 must be pale ecru/off-white.',
  }, look)
  const report = buildOutfitRecheckReport({lookbookId: 'test-lookbook', looks: [result]})

  assert.equal(report.ok, false)
  assert.equal(result.look_id, 'look2')
  assert.equal(report.hard_failures, 1)
  assert.deepEqual(failedLookIds(report), ['look2'])
  assert.match(renderOutfitRecheckSummary(report), /N00932/)
  assert.match(renderOutfitRecheckSummary(report), /dark indigo denim/)
})

test('outfit recheck downgrades dark denim black ambiguity to a warning', () => {
  const look: OutfitRecheckLookInput = {
    id: 'look4',
    title: 'Fogline Sweater Day',
    heroPath: '/tmp/look4.png',
    pieces: [{index: 1, sku: 'BM12125.1011B00732', name: 'B007 Japanese Denim Ford Standard Jean', category: 'Jeans', color: 'B007', size: '32'}],
  }
  const result = normalizeOutfitRecheckResponse({
    look_id: 'look4',
    overall_pass: false,
    severity: 'hard_fail',
    items: [{
      sku: 'BM12125.1011B00732',
      expected: 'dark Ford Standard denim',
      observed: 'black jeans',
      pass: false,
      severity: 'hard_fail',
      note: 'Jeans appear black instead of dark denim.',
    }],
    failures: ['Jeans appear black instead of dark denim.'],
  }, look)
  const report = buildOutfitRecheckReport({lookbookId: 'test-lookbook', looks: [result]})

  assert.equal(result.overall_pass, true)
  assert.equal(result.severity, 'warning')
  assert.equal(result.items[0].severity, 'warning')
  assert.equal(report.ok, true)
  assert.equal(report.hard_failures, 0)
  assert.equal(report.warnings, 2)
  assert.deepEqual(result.failures, [])
})

test('outfit recheck downgrades dark B007 denim wording to a warning', () => {
  const look: OutfitRecheckLookInput = {
    id: 'look1',
    title: 'Oyster Point Arrival',
    heroPath: '/tmp/look1.png',
    pieces: [{index: 1, sku: 'BM12125.1011B00732', name: 'B007 Japanese Denim Ford Standard Jean', category: 'Jeans', color: 'B007', size: '32'}],
  }
  const result = normalizeOutfitRecheckResponse({
    look_id: 'look1',
    overall_pass: false,
    severity: 'hard_fail',
    items: [{
      sku: 'BM12125.1011B00732',
      expected: 'B007 jeans',
      observed: 'Dark jeans, not B007',
      pass: false,
      severity: 'hard_fail',
      note: 'Jeans color does not match B007 reference.',
    }],
  }, look)

  assert.equal(result.overall_pass, true)
  assert.equal(result.severity, 'warning')
  assert.equal(result.items[0].severity, 'warning')
  assert.deepEqual(result.failures, [])
})

test('outfit recheck downgrades mock-neck collar ambiguity to a warning', () => {
  const look: OutfitRecheckLookInput = {
    id: 'look4',
    title: 'Fogline Sweater Day',
    heroPath: '/tmp/look4.png',
    pieces: [{index: 1, sku: 'BM16597BRNM', name: 'Brown Anatomica Mock Neck Sweater', category: 'Anatomica', color: 'Brown', size: 'M'}],
  }
  const result = normalizeOutfitRecheckResponse({
    look_id: 'look4',
    overall_pass: false,
    severity: 'hard_fail',
    items: [{
      sku: 'BM16597BRNM',
      expected: 'rich brown mock-neck sweater',
      observed: 'brown crewneck sweater',
      pass: false,
      severity: 'hard_fail',
      note: 'The sweater is a crewneck instead of a mock-neck.',
    }],
  }, look)

  assert.equal(result.overall_pass, true)
  assert.equal(result.severity, 'warning')
  assert.equal(result.items[0].severity, 'warning')
  assert.deepEqual(result.failures, [])
})

test('outfit recheck fix addendum patches only failed image-plan looks', () => {
  const imagePlan = {
    model: 'gpt-image-2',
    quality: 'high',
    size: '1024x1536',
    lookbook_id: 'test-lookbook',
    generated_note: 'test',
    looks: [
      {id: 'look1', title: 'One', setting: '', composition: '', prompt: 'prompt one', garments: [], identity_references: [], output: 'looks/look1.png'},
      {id: 'look2', title: 'Two', setting: '', composition: '', prompt: 'prompt two', garments: [], identity_references: [], output: 'looks/look2.png'},
    ],
  } as const
  const report = buildOutfitRecheckReport({
    lookbookId: 'test-lookbook',
    looks: [{
      look_id: 'look2',
      title: 'Two',
      overall_pass: false,
      severity: 'hard_fail',
      items: [],
      warnings: [],
      failures: ['N00932: expected pale ecru jeans, observed dark denim'],
      regeneration_prompt_addendum: 'Render the N009 jean as pale ecru/off-white.',
    }],
  })

  const patched = imagePlanWithRecheckAddenda(imagePlan, report)
  const retry = filterImagePlanLooks(patched, failedLookIds(report))

  assert.equal(patched.looks[0].prompt, 'prompt one')
  assert.match(patched.looks[1].prompt, /OUTFIT RECHECK FIX ADDENDUM/)
  assert.match(patched.looks[1].prompt, /Render the N009 jean as pale ecru/)
  assert.deepEqual(retry.looks.map((look) => look.id), ['look2'])
})
