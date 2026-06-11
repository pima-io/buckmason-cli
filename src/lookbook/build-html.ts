import {access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'

export interface BuildLookbookOptions {
  configPath: string
  picksPath: string
  outDir: string
  lookImagesDir?: string
  noTryon?: boolean
}

export interface BuildLookbookResult {
  indexPath: string
  manifestPath: string
  markerPath: string
}

interface PreparedAssets {
  heroImages: Record<string, string>
  ogImage: string
  ogWidth?: number
  ogHeight?: number
}

export async function buildHtmlLookbook(options: BuildLookbookOptions): Promise<BuildLookbookResult> {
  const config = JSON.parse(await readFile(options.configPath, 'utf8'))
  const picks = JSON.parse(await readFile(options.picksPath, 'utf8'))
  const lookbookId = requiredString(config.lookbook_id, 'config.lookbook_id')
  await mkdir(options.outDir, {recursive: true})

  if (!options.noTryon && !options.lookImagesDir) {
    throw new Error('Premium build requires lookImagesDir. Use noTryon for editorial tier.')
  }

  if (options.lookImagesDir) await verifyLookImagesMarker(options.lookImagesDir, lookbookId)

  const assets = await prepareAssets(config, picks, options)
  const manifest = buildManifest(config, picks, assets, options.noTryon ? 'editorial' : 'premium')
  const html = renderHtml(config, picks, manifest, assets, options.noTryon ? 'editorial' : 'premium')
  const indexPath = path.join(options.outDir, 'index.html')
  const manifestPath = path.join(options.outDir, 'lookbook.json')
  const markerPath = path.join(options.outDir, '.lookbook_id')
  await writeFile(indexPath, html)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(markerPath, `${lookbookId}\n`)
  return {indexPath, manifestPath, markerPath}
}

async function verifyLookImagesMarker(lookImagesDir: string, lookbookId: string): Promise<void> {
  try {
    const marker = (await readFile(path.join(lookImagesDir, '.lookbook_id'), 'utf8')).trim()
    if (marker !== lookbookId) {
      throw new Error(`look images marker ${marker} does not match config lookbook_id ${lookbookId}`)
    }
  } catch (error: any) {
    if (error?.code === 'ENOENT') return
    throw error
  }
}

async function prepareAssets(
  config: Record<string, any>,
  picks: Array<Record<string, any>>,
  options: BuildLookbookOptions,
): Promise<PreparedAssets> {
  const heroImages: Record<string, string> = {}
  for (const look of config.looks || []) {
    const lookId = String(look.id)
    const destName = `${lookId}.jpg`
    const destPath = path.join(options.outDir, destName)

    if (options.noTryon) {
      const firstPick = picks.find((pick) => pickLookId(pick) === lookId)
      const source = sourceImageUrl(firstPick)
      if (source) {
        await writeJpegAsset(source, destPath, 1200)
        heroImages[lookId] = destName
      } else {
        heroImages[lookId] = ''
      }
      continue
    }

    const source = path.join(options.lookImagesDir || '', `${lookId}.png`)
    await writeJpegAsset(source, destPath, 1200)
    heroImages[lookId] = destName
  }

  for (const [index, piece] of picks.entries()) {
    const source = sourceImageUrl(piece)
    if (!source) continue
    const thumbName = `thumb-${assetId(piece, index)}.jpg`
    await writeJpegAsset(source, path.join(options.outDir, thumbName), 240)
    piece.thumb_path = thumbName
  }

  const firstHero = Object.values(heroImages).find(Boolean)
  const ogImage = 'og.jpg'
  if (firstHero) {
    await writeJpegAsset(path.join(options.outDir, firstHero), path.join(options.outDir, ogImage), 1200)
  }
  const dimensions = await imageDimensions(path.join(options.outDir, ogImage))
  return {heroImages, ogImage, ogWidth: dimensions?.width, ogHeight: dimensions?.height}
}

function buildManifest(config: any, picks: any[], assets: PreparedAssets, tier: 'premium' | 'editorial') {
  const looks = config.looks || []
  const stockRefresh = stockRefreshConfig(config)
  const items: any[] = []
  const manifestLooks = looks.map((look: any) => {
    const pieces = picks.filter((pick) => pickLookId(pick) === String(look.id))
    for (const piece of pieces) items.push(manifestItem(piece, look, stockRefresh))
    return {
      id: look.id,
      eyebrow: look.eyebrow || look.id,
      title: look.title || look.id,
      note: look.note || '',
      setting: look.setting || '',
      composition: look.composition || '',
      hero_image: assets.heroImages[String(look.id)] || '',
      subtotal_cents: pieces.reduce((sum, piece) => sum + Number(piece.price_cents || 0) * Number(piece.quantity || piece.qty || 1), 0),
      items: pieces.map((piece) => piece.sku || ''),
    }
  })

  return {
    schema: 'buck-mason-lookbook-manifest',
    schema_version: 1,
    generated_by: 'buckmason-cli',
    tier,
    lookbook_id: config.lookbook_id,
    title: config.lookbook_title || config.title,
    date: config.lookbook_date || config.date,
    subtitle: config.subtitle || '',
    page_url: normalizedPageUrl(config.page_url),
    currency: 'USD',
    stock_refresh: {
      ...stockRefresh,
      endpoint: `${stockRefresh.base_url}/stock/:sku`,
    },
    disclosure: tier === 'premium'
      ? 'AI-generated try-on previews - not photographs of real garments on the customer.'
      : 'Editorial tier - product imagery from buckmason.com, no AI try-on.',
    looks: manifestLooks,
    items,
  }
}

function manifestItem(piece: any, look: any, stockRefresh: ReturnType<typeof stockRefreshConfig>) {
  const priceCents = Number(piece.price_cents || 0)
  const quantity = Number(piece.quantity || piece.qty || 1)
  const stock = onlineStock(piece)
  const stockLabel = stockLabelFor(piece)
  return {
    sku: piece.sku || '',
    product_id: piece.id || piece.product_id,
    look_id: look.id,
    look_title: look.title || look.id,
    name: piece.name || '',
    color: piece.color || '',
    size: piece.picked_size || piece.size || '',
    quantity,
    price_cents: priceCents,
    price: money(priceCents),
    url: piece.url || '',
    thumb: piece.thumb_path || '',
    image_url: sourceImageUrl(piece),
    fullsize_url: fullsizeUrl(piece),
    stock: {
      online: stock,
      label: stockLabel,
      source: stockSourceLabelFor(piece, stockRefresh),
    },
  }
}

function renderHtml(config: any, picks: any[], manifest: any, assets: PreparedAssets, tier: 'premium' | 'editorial'): string {
  const title = escapeHtml(manifest.title || 'Buck Mason Lookbook')
  const subtitle = escapeHtml(manifest.subtitle || '')
  const pageUrl = normalizedPageUrl(manifest.page_url)
  const ogImage = absoluteAssetUrl(pageUrl, assets.ogImage)
  const ogWidth = assets.ogWidth ? `  <meta property="og:image:width" content="${assets.ogWidth}">\n` : ''
  const ogHeight = assets.ogHeight ? `  <meta property="og:image:height" content="${assets.ogHeight}">\n` : ''
  const disclosure = tier === 'premium'
    ? 'AI-generated try-on previews - not photographs of real garments on the customer.'
    : 'Editorial tier - product imagery from buckmason.com, no AI try-on.'
  const stockRefresh = stockRefreshConfig(config)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} &middot; Buck Mason</title>
  <meta name="description" content="${subtitle}">

  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Buck Mason">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${subtitle}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
${ogWidth}${ogHeight}  <meta property="og:image:alt" content="Buck Mason lookbook - ${title}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${subtitle}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
  <link rel="alternate" type="application/json" href="lookbook.json" title="Lookbook manifest">

  <style>
    :root {
      --bm-cond: "Acumin Pro Condensed", "Helvetica Neue Condensed", "Helvetica Neue", Helvetica, Arial, sans-serif;
      --bm-body: "Acumin Pro", "Helvetica Neue", Helvetica, Arial, sans-serif;
      --bm-ink: #333; --bm-mute: #666; --bm-faint: #999; --bm-line: #e5e2dd; --bm-accent: #f3f1ef;
    }
    * { box-sizing: border-box; }
    body { font-family: var(--bm-body); color: var(--bm-ink); background: #fff; margin: 0; font-size: 14px; line-height: 1.5; }
    a { color: var(--bm-mute); }
    .eyebrow { font-family: var(--bm-cond); font-size: 11px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--bm-mute); }
    h1 { font-family: var(--bm-cond); font-weight: 600; font-size: 22px; line-height: 1; letter-spacing: 0.02em; text-transform: uppercase; margin: 8px 0 12px; color: var(--bm-ink); }
    h2 { font-family: var(--bm-cond); font-weight: 600; font-size: 20px; line-height: 1; letter-spacing: 0.02em; text-transform: uppercase; margin: 8px 0 12px; color: var(--bm-ink); }
    p.note { color: var(--bm-mute); margin: 0 0 24px; }
    .page { max-width: 1200px; margin: 0 auto; padding: 64px 32px 120px; }
    .cover { text-align: left; padding-bottom: 16px; }
    .cover .meta { color: var(--bm-faint); font-size: 12px; margin-top: 12px; }
    .look { display: grid; grid-template-columns: 5fr 4fr; gap: 48px; padding: 64px 0; }
    .look-hero img { width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; }
    .look-pieces { display: flex; flex-direction: column; gap: 0; }
    .piece { display: grid; grid-template-columns: 24px 88px 1fr; gap: 16px; align-items: start; padding: 18px 0; border-top: 1px solid var(--bm-line); cursor: pointer; }
    .piece:first-of-type { border-top: 1px solid var(--bm-ink); }
    .piece input[type="checkbox"] { width: 16px; height: 16px; margin-top: 4px; appearance: none; -webkit-appearance: none; border: 1px solid var(--bm-ink); cursor: pointer; position: relative; flex-shrink: 0; }
    .piece input[type="checkbox"]:checked { background: var(--bm-ink); }
    .piece input[type="checkbox"]:checked::after { content: ""; position: absolute; left: 4px; top: 0; width: 4px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
    .piece img { width: 88px; aspect-ratio: 3/4; object-fit: cover; display: block; background: #fafafa; }
    .piece-info { display: flex; flex-direction: column; gap: 4px; }
    .piece .name { font-family: var(--bm-cond); font-weight: 600; font-size: 13px; letter-spacing: 0.02em; text-transform: uppercase; }
    .piece .price { font-size: 14px; }
    .piece a { font-size: 11px; }
    .stock-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
    .piece .stock { font-size: 11px; color: var(--bm-mute); }
    .stock-refresh { width: 22px; height: 22px; border: 1px solid #d7d3cd; background: #fbfaf8; color: #6a655d; display: inline-grid; place-items: center; padding: 0; font: 14px/1 var(--bm-body); cursor: pointer; transition: color 120ms, border-color 120ms, background 120ms, opacity 120ms; flex: 0 0 auto; }
    .stock-refresh:hover { color: var(--bm-ink); border-color: #9a9389; background: #f4f1ed; }
    .stock-refresh:disabled { cursor: default; opacity: 0.52; }
    .stock-refresh.is-fresh { color: #2f7048; border-color: #cfdccf; background: #f5f8f2; }
    .stock-refresh.is-error { color: #8a4238; border-color: #ead6d1; background: #fff7f5; }
    .stock-refresh[aria-busy="true"] .stock-refresh-icon { animation: bm-spin 700ms linear infinite; }
    .stock-checked { color: var(--bm-faint); font-size: 10px; }
    @keyframes bm-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .total { font-family: var(--bm-cond); font-weight: 700; font-size: 13px; letter-spacing: 0.02em; text-transform: uppercase; padding-top: 18px; margin-top: 18px; border-top: 1px solid var(--bm-ink); }
    .cover-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .bm-btn-outline { display: inline-block; font-family: var(--bm-cond); font-weight: 600; font-size: 12px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--bm-ink); background: transparent; border: 1px solid var(--bm-ink); padding: 12px 20px; min-height: 44px; cursor: pointer; transition: background 120ms, color 120ms, border-color 120ms, opacity 120ms; }
    .bm-btn-outline:hover { background: var(--bm-ink); color: #fff; }
    .bm-btn-outline:disabled { opacity: 0.62; cursor: default; }
    .bm-btn-outline.is-accent { background: var(--bm-ink); color: #fff; }
    .bm-btn-outline.is-accent:hover { background: #111; border-color: #111; }
    .bm-btn-outline.selected { background: var(--bm-ink); color: #fff; }
    .bm-btn-outline.selected::before { content: "\\2713 "; }
    #select-all-btn { margin-top: 0; }
    .select-outfit { margin-top: 20px; align-self: flex-start; }
    .footer { text-align: center; padding: 48px 0 0; }
    .footer a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
    .footer-sites { font-family: var(--bm-cond); font-size: 11px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--bm-faint); }
    .footer-credit { margin-top: 8px; font-family: var(--bm-body); font-size: 12px; letter-spacing: 0; text-transform: none; color: var(--bm-mute); }
    @media (max-width: 1023px) and (min-width: 700px) {
      .page { padding: 48px 32px 120px; }
      .look { grid-template-columns: 1fr; gap: 24px; padding: 48px 0; }
      .piece { grid-template-columns: 24px 96px 1fr; }
      .piece img { width: 96px; }
    }
    @media (max-width: 699px) {
      body { font-size: 13px; }
      .page { padding: 32px 16px 120px; }
      .look { grid-template-columns: 1fr; gap: 16px; padding: 32px 0; }
      .piece { grid-template-columns: 22px 64px 1fr; gap: 12px; padding: 16px 0; }
      .piece img { width: 64px; }
      h1 { font-size: 20px; }
      h2 { font-size: 18px; }
      .footer { padding-top: 32px; }
    }
    #cart-bar { position: fixed; bottom: 0; left: 0; right: 0; background: var(--bm-ink); color: #fff; padding: 16px 32px; display: none; align-items: center; justify-content: space-between; gap: 16px; font-family: var(--bm-cond); font-size: 12px; letter-spacing: 0.02em; text-transform: uppercase; z-index: 5; }
    #cart-bar.show { display: flex; }
    #cart-bar .cart-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    #cart-bar button { background: #fff; color: var(--bm-ink); border: 1px solid #fff; padding: 14px 24px; font: inherit; letter-spacing: 0.02em; cursor: pointer; min-height: 44px; }
    #cart-bar button.secondary { background: transparent; color: #fff; border-color: rgba(255,255,255,0.46); }
    #cart-bar button:disabled { opacity: 0.62; cursor: default; }
    @media (max-width: 699px) { #cart-bar { padding: 12px 16px; font-size: 10px; align-items: stretch; } #cart-bar .cart-actions { display: grid; grid-template-columns: 1fr 1fr; } #cart-bar button { padding: 12px 16px; font-size: 10px; } }
    #handoff { display: none; position: fixed; inset: 32px; background: #fff; z-index: 10; padding: 32px; overflow: auto; box-shadow: 0 0 60px rgba(0,0,0,.25); }
    #handoff.show { display: block; }
    #handoff h2 { margin-top: 0; }
    #handoff p { color: var(--bm-mute); }
    #handoff pre { background: var(--bm-accent); border: 0; padding: 16px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; max-height: 50dvh; overflow: auto; }
    #handoff .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    #handoff button { font-family: var(--bm-cond); letter-spacing: 0.02em; text-transform: uppercase; font-size: 11px; cursor: pointer; min-height: 44px; padding: 12px 24px; }
    #handoff .primary { background: var(--bm-ink); color: #fff; border: 0; }
    #handoff .secondary { background: transparent; color: var(--bm-ink); border: 1px solid var(--bm-ink); }
    @media (max-width: 699px) { #handoff { inset: 12px; padding: 20px; } }
    .look-hero img, .piece img { cursor: zoom-in; }
    #lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.94); display: none; align-items: center; justify-content: center; z-index: 20; padding: 32px; cursor: zoom-out; }
    #lightbox.show { display: flex; }
    #lightbox img { max-width: min(100%, 1600px); max-height: 100%; object-fit: contain; cursor: default; display: block; }
    #lightbox .close { position: absolute; top: 12px; right: 12px; background: transparent; color: #fff; border: 0; font: 24px/1 var(--bm-cond); cursor: pointer; padding: 12px 16px; min-height: 44px; min-width: 44px; }
    @media (max-width: 699px) { #lightbox { padding: 12px; } }
  </style>
</head>
<body>
  <div class="page">
    <header class="cover">
      <div class="eyebrow">Buck Mason &middot; Stylist &middot; ${escapeHtml(manifest.lookbook_id)}</div>
      <h1>${title}</h1>
      <p class="note">${subtitle}</p>
      <div class="cover-actions">
        <button type="button" id="select-all-btn" class="bm-btn-outline" onclick="toggleAll(this)">Select all looks</button>
        <button type="button" id="top-voted-btn" class="bm-btn-outline is-accent" onclick="openTopVotedHandoff(this)">Give me the winners</button>
      </div>
      <div class="meta">${escapeHtml(disclosure)}</div>
    </header>
    ${(manifest.looks || []).map((look: any) => renderLook(look, picks, stockRefresh)).join('')}
    <div class="footer">
      <div class="footer-sites"><a href="https://www.buckmason.com/" target="_blank" rel="noopener noreferrer">www.buckmason.com</a> | <a href="https://www.pima.io/" target="_blank" rel="noopener noreferrer">www.pima.io</a></div>
      <div class="footer-credit"><a href="https://www.npmjs.com/package/@buckmason/cli" target="_blank" rel="noopener noreferrer">Generated using the Buck Mason CLI</a></div>
    </div>
  </div>

  <div id="cart-bar">
    <span><span id="cart-count">0</span> selected &middot; <span id="cart-total">$0</span></span>
    <div class="cart-actions">
      <button type="button" class="secondary" onclick="openTopVotedHandoff(this)">Give me the winners</button>
      <button type="button" onclick="openHandoff()">Send to my stylist</button>
    </div>
  </div>

  <div id="handoff" role="dialog" aria-modal="true" aria-labelledby="handoff-title">
    <h2 id="handoff-title">Tell your stylist</h2>
    <p id="handoff-intro">Speak this aloud to a voice agent, or paste it into a chat. Your agent will confirm shipping or pickup, coupon, and credit before charging.</p>
    <pre id="handoff-text"></pre>
    <div class="actions">
      <button id="copy-btn" class="primary" onclick="copyHandoff(this)">Copy to clipboard</button>
      <button class="secondary" onclick="closeHandoff()">Close</button>
    </div>
  </div>

  <div id="lightbox" onclick="closeLightbox(event)">
    <button class="close" type="button" aria-label="Close image" onclick="closeLightbox(event, true)">&times;</button>
    <img id="lightbox-img" alt="">
  </div>

  <script>
    const LOOKBOOK_ID = ${jsonForScript(manifest.lookbook_id)};
    const LOOKBOOK_TITLE = ${jsonForScript(manifest.title)};
    const LOOKBOOK_DATE = ${jsonForScript(manifest.date)};
    const HANDOFF_INTRO = 'Speak this aloud to a voice agent, or paste it into a chat. Your agent will confirm shipping or pickup, coupon, and credit before charging.';
    const WINNER_INTRO = 'Copy this prompt to ask your stylist agent for the top-voted pieces. Your agent still checks live stock, price, shipping, coupon, and credit before charging.';
    const STOCK_REFRESH = ${jsonForScript(stockRefresh)};
    function selected() {
      return Array.from(document.querySelectorAll('.piece input[type="checkbox"]:checked')).map(function(el) {
        return {
          name: el.dataset.name,
          size: el.dataset.size,
          qty: parseInt(el.dataset.qty, 10),
          cents: parseInt(el.dataset.priceCents, 10),
          sku: el.dataset.sku || ''
        };
      });
    }
    function fmtMoney(c) { return '$' + (c / 100).toFixed(c % 100 === 0 ? 0 : 2); }
    function stockRefreshUrl(sku) {
      const url = new URL(STOCK_REFRESH.base_url + '/stock/' + encodeURIComponent(sku));
      url.searchParams.set('near_zip', STOCK_REFRESH.near_zip);
      url.searchParams.set('radius_mi', STOCK_REFRESH.radius_mi);
      return url.toString();
    }
    function stockPayload(raw) { return raw && (raw.variant || raw.stock || raw.data) || raw; }
    function statusLabel(value) {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (value.label) return value.label;
      if (value.status) return String(value.status).replace(/_/g, ' ');
      if (typeof value.count === 'number') {
        if (value.count === 0) return 'Out of stock';
        if (value.count < 10) return 'Low stock (' + value.count + ' left)';
        return 'In stock';
      }
      return '';
    }
    function locationName(location) {
      return [location && location.name, location && location.location_name, location && location.store_name, location && location.short_name, location && location.label].filter(Boolean).join(' ');
    }
    function preferredLocation(locations) {
      const needle = String(STOCK_REFRESH.preferred_location || '').toLowerCase();
      if (!needle) return null;
      return (locations || []).find(function(location) { return locationName(location).toLowerCase().includes(needle); }) || null;
    }
    function preferredLocationCode(location) {
      if (location && location.short_name) return String(location.short_name).toUpperCase();
      const value = String((location && (location.name || location.location_name || location.store_name)) || STOCK_REFRESH.preferred_location || '');
      const words = value.trim().split(/\\s+/).filter(Boolean);
      return words.length ? words.map(function(word) { return word[0]; }).join('').slice(0, 3).toUpperCase() : '';
    }
    function stockAvailable(value) {
      if (!value) return false;
      if (value.in_stock === true || value.pickup_available === true || value.available === true) return true;
      if (typeof value.count === 'number') return value.count > 0;
      const text = String(value.label || value.status || '').toLowerCase();
      if (/out|unavailable|sold/.test(text)) return false;
      return /in stock|low stock|available/.test(text);
    }
    function locationStockLabel(location) {
      if (!location) return '';
      return statusLabel(location.stock || location.inventory || location.availability || location);
    }
    function stockSourceLabel(snapshot) {
      const location = preferredLocation(snapshot.locations || []);
      if (location && stockAvailable(location)) return preferredLocationCode(location);
      const pickup = preferredLocation((snapshot.fulfillment && snapshot.fulfillment.pickup_locations) || []);
      if (pickup) return preferredLocationCode(pickup);
      if (stockAvailable(snapshot.online) || statusLabel(snapshot.online)) return 'Online';
      return '';
    }
    function refreshedStockLine(raw, fallbackSize) {
      const snapshot = stockPayload(raw) || {};
      const size = snapshot.size || fallbackSize || '';
      const parts = [];
      if (size) parts.push('Size ' + size);
      const source = stockSourceLabel(snapshot);
      if (source) parts.push(source);
      const location = preferredLocation(snapshot.locations || []);
      const locationLabel = source && source !== 'Online' ? locationStockLabel(location) : '';
      const label = locationLabel || statusLabel(snapshot.online);
      if (label) parts.push(label);
      return parts.length ? parts.join(' · ') : '';
    }
    function stockRefreshTime(date) {
      return (date || new Date()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    async function refreshPieceStock(event, btn) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const row = btn.closest('.stock-row');
      const sku = row && row.dataset.stockSku;
      const label = row && row.querySelector('.stock');
      const checked = row && row.querySelector('.stock-checked');
      if (!row || !sku || !label) return;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.remove('is-fresh', 'is-error');
      if (checked) checked.textContent = 'Checking';
      try {
        const res = await fetch(stockRefreshUrl(sku), { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error('stock ' + res.status);
        const next = refreshedStockLine(await res.json(), row.dataset.stockSize);
        if (next) label.textContent = next;
        btn.classList.add('is-fresh');
        if (checked) checked.textContent = 'Updated ' + stockRefreshTime();
      } catch (err) {
        btn.classList.add('is-error');
        if (checked) checked.textContent = 'Could not refresh';
      } finally {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    }
    function refresh() {
      const items = selected();
      const cents = items.reduce(function(a, i) { return a + i.cents * i.qty; }, 0);
      document.getElementById('cart-count').textContent = String(items.length);
      document.getElementById('cart-total').textContent = fmtMoney(cents);
      document.getElementById('cart-bar').classList.toggle('show', items.length > 0);
    }
    function buildHandoffText(items) {
      const selectedItems = items || selected();
      if (selectedItems.length === 0) return '';
      const subtotal = selectedItems.reduce(function(a, i) { return a + i.cents * i.qty; }, 0);
      const lines = selectedItems.map(function(i) {
        const qtyPart = i.qty > 1 ? ' (x' + i.qty + ')' : '';
        const skuPart = i.sku ? ' - SKU ' + i.sku : '';
        return '- ' + i.name + ' - size ' + i.size + ' - ' + fmtMoney(i.cents) + qtyPart + skuPart;
      });
      return ['Buck Mason - ' + LOOKBOOK_TITLE + ' (' + LOOKBOOK_DATE + ')', '', 'I would like to order:'].concat(lines, ['', 'Subtotal at pick: ' + fmtMoney(subtotal), 'Please confirm shipping or pickup, any coupon or credit, and run checkout.']).join('\\n');
    }
    function resetCopyButton() {
      const btn = document.getElementById('copy-btn');
      if (!btn) return;
      clearTimeout(copyResetTimer);
      btn.disabled = false;
      btn.textContent = btn.dataset.original || 'Copy to clipboard';
    }
    function showHandoff(text, title, intro) {
      resetCopyButton();
      document.getElementById('handoff-title').textContent = title || 'Tell your stylist';
      document.getElementById('handoff-intro').textContent = intro || HANDOFF_INTRO;
      document.getElementById('handoff-text').textContent = text;
      document.getElementById('handoff').classList.add('show');
    }
    function openHandoff() { showHandoff(buildHandoffText(), 'Tell your stylist', HANDOFF_INTRO); }
    function closeHandoff() { document.getElementById('handoff').classList.remove('show'); }
    let copyResetTimer = null;
    async function copyHandoff(btn) {
      try {
        await navigator.clipboard.writeText(document.getElementById('handoff-text').textContent);
      } catch (e) {
        const r = document.createRange(); r.selectNode(document.getElementById('handoff-text'));
        getSelection().removeAllRanges(); getSelection().addRange(r);
        document.execCommand('copy'); getSelection().removeAllRanges();
      }
      btn.dataset.original = btn.dataset.original || btn.textContent;
      btn.textContent = 'Copied'; btn.disabled = true;
      clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(function() { btn.textContent = btn.dataset.original; btn.disabled = false; }, 1800);
    }
    function voteBucket(raw) {
      const up = Number(raw && raw.up || 0);
      const down = Number(raw && raw.down || 0);
      const total = up + down;
      return { up: up, down: down, total: total, net: up - down, likeRate: total ? up / total : null };
    }
    function bucketLabel(bucket) { return bucket.up + ' like / ' + bucket.down + ' pass'; }
    function rankVoteRecommendations(manifest, tally, maxItems) {
      const looks = Object.fromEntries((manifest.looks || []).map(function(look, index) {
        return [look.id, Object.assign({}, look, { order: index, votes: voteBucket(tally && tally.looks && tally.looks[look.id]) })];
      }));
      const rankedLooks = Object.values(looks).sort(function(a, b) {
        return (b.votes.net - a.votes.net) || (b.votes.up - a.votes.up) || ((b.votes.likeRate || 0) - (a.votes.likeRate || 0)) || (a.order - b.order);
      });
      const rankedItems = (manifest.items || []).map(function(item, index) {
        const look = looks[item.look_id] || {};
        const itemVotes = voteBucket(tally && tally.items && tally.items[item.sku]);
        const lookVotes = look.votes || voteBucket();
        const itemSignal = itemVotes.total >= 1 && itemVotes.net > 0;
        const lookSignal = itemVotes.total === 0 && lookVotes.total >= 1 && lookVotes.net > 0;
        const blockedByItemPass = itemVotes.total > 0 && itemVotes.net <= 0;
        const recommended = (itemSignal || lookSignal) && !blockedByItemPass;
        let score = itemVotes.net * 100 + itemVotes.up * 8 - itemVotes.down * 12 + (itemVotes.likeRate || 0) * 20 + lookVotes.net * 12 + lookVotes.up * 2 + (lookVotes.likeRate || 0) * 6;
        if (lookSignal && !itemSignal) score -= 6;
        return Object.assign({}, item, {
          order: index,
          votes: itemVotes,
          lookVotes: lookVotes,
          recommended: recommended,
          reason: itemVotes.total ? bucketLabel(itemVotes) + ' on item; ' + bucketLabel(lookVotes) + ' on ' + (look.eyebrow || item.look_id) : 'no item votes; ' + bucketLabel(lookVotes) + ' on ' + (look.eyebrow || item.look_id),
          score: score
        });
      }).sort(function(a, b) {
        return Number(b.recommended) - Number(a.recommended) || b.score - a.score || b.votes.up - a.votes.up || b.lookVotes.up - a.lookVotes.up || a.order - b.order;
      });
      return { rankedLooks: rankedLooks, recommended: rankedItems.filter(function(item) { return item.recommended; }).slice(0, maxItems || 8) };
    }
    function buildTopVotedHandoffText(manifest, recommended, rankedLooks, tally) {
      const voteCount = Number(tally && tally.count || 0);
      const title = manifest.title || LOOKBOOK_TITLE;
      const date = manifest.date || LOOKBOOK_DATE;
      if (!recommended.length) {
        return ['Buck Mason - ' + title + ' (' + date + ')', '', 'No positive top-voted picks yet.', 'Votes counted: ' + voteCount, 'Please choose items manually from the lookbook, or ask for more votes and try again.'].join('\\n');
      }
      const subtotal = recommended.reduce(function(sum, item) { return sum + Number(item.price_cents || 0) * Number(item.quantity || 1); }, 0);
      const lines = recommended.map(function(item) {
        const qty = Number(item.quantity || 1);
        const qtyPart = qty > 1 ? ' (x' + qty + ')' : '';
        const skuPart = item.sku ? ' - SKU ' + item.sku : '';
        return '- ' + item.name + ' - size ' + item.size + ' - ' + fmtMoney(Number(item.price_cents || 0)) + qtyPart + skuPart;
      });
      const topLook = rankedLooks.find(function(look) { return look.votes.total > 0; });
      const voteBasis = recommended.map(function(item) { return '- ' + item.name + ': ' + item.reason; });
      return ['Buck Mason - ' + title + ' (' + date + ')', '', 'I would like to order the top-voted picks:'].concat(lines, ['', 'Subtotal at vote pick: ' + fmtMoney(subtotal), 'Votes counted: ' + voteCount, topLook ? 'Top look: ' + (topLook.eyebrow || topLook.id) + ' (' + bucketLabel(topLook.votes) + ').' : '', '', 'Vote basis:'], voteBasis, ['', 'Please re-check live stock and price, confirm shipping or pickup, any coupon or credit, and run checkout.']).filter(function(line, index, arr) { return line || arr[index - 1]; }).join('\\n');
    }
    async function openTopVotedHandoff(btn) {
      const original = btn && btn.textContent;
      if (btn) { btn.disabled = true; btn.textContent = 'Checking votes'; }
      try {
        const responses = await Promise.all([
          fetch('lookbook.json', { headers: { accept: 'application/json' } }),
          fetch('/api/votes?public=1&fresh=1', { headers: { accept: 'application/json' } })
        ]);
        if (!responses[0].ok) throw new Error('manifest ' + responses[0].status);
        if (!responses[1].ok) throw new Error('votes ' + responses[1].status);
        const manifestJson = await responses[0].json();
        const votes = await responses[1].json();
        const tally = votes.tally || votes;
        const ranked = rankVoteRecommendations(manifestJson, tally, 8);
        showHandoff(buildTopVotedHandoffText(manifestJson, ranked.recommended, ranked.rankedLooks, tally), 'Top-voted picks', WINNER_INTRO);
      } catch (err) {
        showHandoff(['Buck Mason - ' + LOOKBOOK_TITLE + ' (' + LOOKBOOK_DATE + ')', '', 'I could not load the live vote winners from this browser.', '', 'Please ask my stylist agent to rank the votes for ' + location.href + ' and order the top-voted picks.'].join('\\n'), 'Top-voted picks', WINNER_INTRO);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = original; }
      }
    }
    document.addEventListener('change', function(e) {
      if (e.target.matches('.piece input[type="checkbox"]')) { refresh(); refreshSelectButtons(); }
    });
    function lookCheckboxes(lookId) { return Array.from(document.querySelectorAll('.look[data-look="' + lookId + '"] .piece input[type="checkbox"]')); }
    function allCheckboxes() { return Array.from(document.querySelectorAll('.piece input[type="checkbox"]')); }
    function toggleLook(lookId, btn) {
      const boxes = lookCheckboxes(lookId);
      const allChecked = boxes.length > 0 && boxes.every(function(b) { return b.checked; });
      boxes.forEach(function(b) { b.checked = !allChecked; });
      refresh(); refreshSelectButtons();
    }
    function toggleAll(btn) {
      const boxes = allCheckboxes();
      const allChecked = boxes.length > 0 && boxes.every(function(b) { return b.checked; });
      boxes.forEach(function(b) { b.checked = !allChecked; });
      refresh(); refreshSelectButtons();
    }
    function refreshSelectButtons() {
      document.querySelectorAll('.select-outfit').forEach(function(btn) {
        const boxes = lookCheckboxes(btn.dataset.targetLook);
        const allChecked = boxes.length > 0 && boxes.every(function(b) { return b.checked; });
        btn.classList.toggle('selected', allChecked);
        btn.textContent = allChecked ? 'Outfit selected' : 'Select this outfit';
      });
      const allBtn = document.getElementById('select-all-btn');
      if (allBtn) {
        const all = allCheckboxes();
        const everySelected = all.length > 0 && all.every(function(b) { return b.checked; });
        allBtn.classList.toggle('selected', everySelected);
        allBtn.textContent = everySelected ? 'Deselect all' : 'Select all looks';
      }
    }
    function openLightbox(src, alt) {
      const lb = document.getElementById('lightbox');
      const img = document.getElementById('lightbox-img');
      img.src = src; img.alt = alt || '';
      lb.classList.add('show');
      document.body.style.overflow = 'hidden';
    }
    function closeLightbox(ev, force) {
      if (!force && ev && ev.target && ev.target.id === 'lightbox-img') return;
      document.getElementById('lightbox').classList.remove('show');
      document.body.style.overflow = '';
    }
    document.addEventListener('click', function(e) {
      const img = e.target.closest('.look-hero img, .piece img');
      if (img) {
        e.preventDefault(); e.stopPropagation();
        openLightbox(img.dataset.fullsize || img.src, img.alt);
      }
    }, true);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeLightbox(null, true); });
  </script>
</body>
</html>`
}

function renderLook(look: any, picks: any[], stockRefresh: ReturnType<typeof stockRefreshConfig>): string {
  const pieces = picks.filter((pick) => pickLookId(pick) === String(look.id))
  if (!pieces.length) return ''
  const subtotal = pieces.reduce((sum, piece) => sum + Number(piece.price_cents || 0) * Number(piece.quantity || piece.qty || 1), 0)
  const heroSrc = look.hero_image || ''
  return `<section class="look" data-look="${escapeHtml(look.id)}">
      <div class="look-hero">
        <img src="${escapeHtml(heroSrc)}" data-fullsize="${escapeHtml(heroSrc)}" alt="Buck Mason lookbook - ${escapeHtml(look.title || look.id)}">
      </div>
      <div class="look-pieces">
        <div class="eyebrow">${escapeHtml(look.eyebrow || look.id)}</div>
        <h2>${escapeHtml(look.title || look.id)}</h2>
        <p class="note">${escapeHtml(look.note || '')}</p>
${pieces.map((piece, index) => renderPiece(piece, look.id, index, stockRefresh)).join('\n')}
        <div class="total">Look subtotal &middot; ${money(subtotal)}</div>
        <button type="button" class="bm-btn-outline select-outfit" data-target-look="${escapeHtml(look.id)}" onclick="toggleLook(this.dataset.targetLook, this)">Select this outfit</button>
      </div>
    </section>`
}

function renderPiece(piece: any, lookId: string, index: number, stockRefresh: ReturnType<typeof stockRefreshConfig>): string {
  const id = `cb-${lookId}-${index}`
  const priceCents = Number(piece.price_cents || 0)
  const quantity = Number(piece.quantity || piece.qty || 1)
  const size = piece.picked_size || piece.size || ''
  const thumb = piece.thumb_path || sourceImageUrl(piece)
  return `        <label class="piece" for="${escapeHtml(id)}">
          <input type="checkbox" id="${escapeHtml(id)}"
                 data-name="${escapeHtml(piece.name || '')}"
                 data-size="${escapeHtml(size)}"
                 data-sku="${escapeHtml(piece.sku || '')}"
                 data-qty="${quantity}"
                 data-price-cents="${priceCents}"
                 data-url="${escapeHtml(piece.url || '')}">
          <img src="${escapeHtml(thumb)}" data-fullsize="${escapeHtml(fullsizeUrl(piece))}" alt="${escapeHtml(piece.name || '')}">
          <div class="piece-info">
            <div class="name">${escapeHtml(piece.name || '')}</div>
            <div class="price">${money(priceCents)}</div>
            <a href="${escapeHtml(piece.url || '#')}" target="_blank" rel="noopener">View on buckmason.com</a>
            ${stockRow(piece, stockRefresh)}
          </div>
        </label>`
}

function stockRow(piece: any, stockRefresh: ReturnType<typeof stockRefreshConfig>): string {
  const sku = piece.sku || ''
  const size = piece.picked_size || piece.size || ''
  const disabled = sku ? '' : ' disabled'
  return `<div class="stock-row" data-stock-sku="${escapeHtml(sku)}" data-stock-size="${escapeHtml(size)}">
              <span class="stock">${escapeHtml(stockLine(piece, stockRefresh))}</span>
              <button type="button" class="stock-refresh" aria-label="Refresh stock for ${escapeHtml(piece.name || 'item')}" title="Refresh stock" onclick="refreshPieceStock(event, this)"${disabled}><span class="stock-refresh-icon" aria-hidden="true">&#8635;</span></button>
              <span class="stock-checked" aria-live="polite"></span>
            </div>`
}

function stockLine(piece: any, stockRefresh: ReturnType<typeof stockRefreshConfig>): string {
  const size = piece.picked_size || piece.size || ''
  const source = stockSourceLabelFor(piece, stockRefresh)
  const label = stockLabelFor(piece) || '-'
  return [size ? `Size ${size}` : '', source, label].filter(Boolean).join(' · ')
}

function stockLabelFor(piece: any): string {
  const stock = onlineStock(piece)
  if (stock && typeof stock === 'object' && 'label' in stock) return String(stock.label || '')
  return stock ? String(stock) : ''
}

function onlineStock(piece: any): any {
  if (piece?.in_stock_online) return piece.in_stock_online
  if (piece?.stock?.online) return piece.stock.online
  return piece?.stock || {}
}

function stockSourceLabelFor(piece: any, stockRefresh: ReturnType<typeof stockRefreshConfig>): string {
  const preferredLocation = findPreferredLocation(piece?.locations || piece?.stock?.locations || [], stockRefresh)
  if (preferredLocation && stockAvailable(preferredLocation)) return locationCode(preferredLocation, stockRefresh)
  const pickupLocation = findPreferredLocation(piece?.fulfillment?.pickup_locations || [], stockRefresh)
  if (pickupLocation) return locationCode(pickupLocation, stockRefresh)
  return stockAvailable(onlineStock(piece)) || stockLabelFor(piece) ? 'Online' : ''
}

function findPreferredLocation(locations: any[], stockRefresh: ReturnType<typeof stockRefreshConfig>): any {
  if (!Array.isArray(locations) || !locations.length) return null
  const preferred = String(stockRefresh.preferred_location || '').toLowerCase()
  const preferredCode = locationCode({name: stockRefresh.preferred_location}, stockRefresh).toLowerCase()
  return locations.find((location) => {
    const text = [
      location?.name,
      location?.location_name,
      location?.store_name,
      location?.short_name,
      location?.label,
    ].filter(Boolean).join(' ').toLowerCase()
    return (preferred && text.includes(preferred)) || (preferredCode && text.split(/\s+/).includes(preferredCode))
  }) || null
}

function locationCode(location: any, stockRefresh: ReturnType<typeof stockRefreshConfig>): string {
  if (location?.short_name) return String(location.short_name).toUpperCase()
  const value = String(location?.name || location?.location_name || location?.store_name || stockRefresh.preferred_location || '')
  return value.trim().split(/\s+/).filter(Boolean).map((word) => word[0]).join('').slice(0, 3).toUpperCase()
}

function stockAvailable(value: any): boolean {
  if (!value) return false
  if (value.in_stock === true || value.pickup_available === true || value.available === true) return true
  if (typeof value.count === 'number') return value.count > 0
  const text = String(value.label || value.status || '').toLowerCase()
  if (/\b(out|unavailable|sold)\b/.test(text)) return false
  return /in stock|low stock|available/.test(text)
}

function stockRefreshConfig(config: any) {
  const raw = config.stock_refresh || {}
  return {
    base_url: trimSlash(raw.base_url || 'https://pima.io/mcp/buckmason'),
    near_zip: String(raw.near_zip || config.near_zip || '90291'),
    radius_mi: Number(raw.radius_mi || config.radius_mi || 25),
    cache_ttl_seconds: Number(raw.cache_ttl_seconds || 60),
    preferred_location: raw.preferred_location || config.preferred_location || 'Abbot Kinney',
  }
}

function pickLookId(piece: any): string {
  return String(piece?.look || piece?.look_id || '')
}

function sourceImageUrl(piece: any): string {
  return piece?.try_on?.url || piece?.hero?.url || piece?.image_url || piece?.try_on_url || ''
}

function fullsizeUrl(piece: any): string {
  return piece?.hero?.url || piece?.try_on?.url || piece?.image_url || piece?.try_on_url || ''
}

function assetId(piece: any, index: number): string {
  return String(piece.id || piece.product_id || piece.sku || index + 1).replace(/[^A-Za-z0-9._-]/g, '-')
}

async function writeJpegAsset(source: string, dest: string, maxWidth: number): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'buckmason-asset-'))
  const tempSource = path.join(tempDir, `source${sourceExt(source)}`)
  try {
    await writeSourceToFile(source, tempSource)
    const converted = await convertWithSips(tempSource, dest, maxWidth)
    if (!converted) await copyFile(tempSource, dest)
  } finally {
    await rm(tempDir, {recursive: true, force: true})
  }
}

async function writeSourceToFile(source: string, dest: string): Promise<void> {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`failed to fetch image ${source}: ${response.status}`)
    await writeFile(dest, Buffer.from(await response.arrayBuffer()))
    return
  }
  if (source.startsWith('file://')) {
    await copyFile(new URL(source), dest)
    return
  }
  await copyFile(source, dest)
}

async function convertWithSips(source: string, dest: string, maxWidth: number): Promise<boolean> {
  try {
    await runCapture('sips', ['--resampleWidth', String(maxWidth), '--setProperty', 'format', 'jpeg', source, '--out', dest])
    return true
  } catch {
    return false
  }
}

async function imageDimensions(file: string): Promise<{width: number; height: number} | null> {
  try {
    await access(file)
    const output = await runCapture('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file])
    const width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1])
    const height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1])
    return width && height ? {width, height} : null
  } catch {
    return null
  }
}

function runCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']})
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(err || `${command} exited ${code}`)))
  })
}

function sourceExt(source: string): string {
  try {
    const url = new URL(source)
    return path.extname(url.pathname) || '.img'
  } catch {
    return path.extname(source) || '.img'
  }
}

function normalizedPageUrl(value: string | undefined): string {
  if (!value) return ''
  return value.endsWith('/') ? value : `${value}/`
}

function absoluteAssetUrl(pageUrl: string | undefined, asset: string): string {
  if (!asset) return ''
  if (/^https?:\/\//.test(asset)) return asset
  if (!pageUrl) return asset
  return new URL(asset, normalizedPageUrl(pageUrl)).toString()
}

function money(cents: number): string {
  return cents % 100 === 0 ? `$${Math.round(cents / 100)}` : `$${(cents / 100).toFixed(2)}`
}

function requiredString(value: unknown, label: string): string {
  if (!value) throw new Error(`${label} is required`)
  return String(value)
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
}
