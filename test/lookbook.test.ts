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
