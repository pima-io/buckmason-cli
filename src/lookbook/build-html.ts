import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'

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

export async function buildHtmlLookbook(options: BuildLookbookOptions): Promise<BuildLookbookResult> {
  const config = JSON.parse(await readFile(options.configPath, 'utf8'))
  const picks = JSON.parse(await readFile(options.picksPath, 'utf8'))
  const lookbookId = requiredString(config.lookbook_id, 'config.lookbook_id')
  await mkdir(options.outDir, {recursive: true})

  if (!options.noTryon && !options.lookImagesDir) {
    throw new Error('Premium build requires lookImagesDir. Use noTryon for editorial tier.')
  }

  if (options.lookImagesDir) await verifyLookImagesMarker(options.lookImagesDir, lookbookId)

  const heroImages = await prepareHeroImages(config, picks, options)
  const manifest = buildManifest(config, picks, heroImages, options.noTryon ? 'editorial' : 'premium')
  const html = renderHtml(config, picks, manifest)
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

async function prepareHeroImages(
  config: Record<string, any>,
  picks: Array<Record<string, any>>,
  options: BuildLookbookOptions,
): Promise<Record<string, string>> {
  const heroImages: Record<string, string> = {}
  for (const look of config.looks || []) {
    const lookId = String(look.id)
    if (options.noTryon) {
      const firstPick = picks.find((pick) => String(pick.look || pick.look_id) === lookId)
      heroImages[lookId] = imageUrl(firstPick) || ''
      continue
    }

    const source = path.join(options.lookImagesDir || '', `${lookId}.png`)
    const destName = `${lookId}.png`
    await copyFile(source, path.join(options.outDir, destName))
    heroImages[lookId] = destName
  }

  return heroImages
}

function buildManifest(config: any, picks: any[], heroImages: Record<string, string>, tier: 'premium' | 'editorial') {
  const looks = config.looks || []
  const items: any[] = []
  const manifestLooks = looks.map((look: any) => {
    const pieces = picks.filter((pick) => String(pick.look || pick.look_id) === String(look.id))
    for (const piece of pieces) items.push(manifestItem(piece, look))
    return {
      id: look.id,
      eyebrow: look.eyebrow || look.id,
      title: look.title || look.id,
      note: look.note || '',
      setting: look.setting || '',
      composition: look.composition || '',
      hero_image: heroImages[String(look.id)] || '',
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
    disclosure: tier === 'premium'
      ? 'AI-generated try-on previews - not photographs of real garments on the customer.'
      : 'Editorial tier - product imagery from buckmason.com, no AI try-on.',
    looks: manifestLooks,
    items,
  }
}

function manifestItem(piece: any, look: any) {
  const priceCents = Number(piece.price_cents || 0)
  const quantity = Number(piece.quantity || piece.qty || 1)
  const stock = piece.in_stock_online || piece.stock || {}
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
    image_url: imageUrl(piece),
    fullsize_url: fullsizeUrl(piece),
    stock: {
      online: stock,
      label: typeof stock === 'object' ? stock.label || '' : String(stock || ''),
    },
  }
}

function renderHtml(config: any, picks: any[], manifest: any): string {
  const looks = manifest.looks || []
  const title = escapeHtml(manifest.title || 'Buck Mason Lookbook')
  const subtitle = escapeHtml(manifest.subtitle || '')
  const pageUrl = escapeHtml(manifest.page_url || '')
  const ogImage = escapeHtml(absoluteAssetUrl(manifest.page_url, looks[0]?.hero_image || looks[0]?.items?.[0]?.image_url || ''))

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} - Buck Mason</title>
  <meta name="description" content="${subtitle}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Buck Mason">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${subtitle}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${ogImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${subtitle}">
  <meta name="twitter:image" content="${ogImage}">
  <link rel="alternate" type="application/json" href="lookbook.json" title="Lookbook manifest">
  <style>
    :root{--ink:#2d2926;--muted:#6f675f;--line:#e5e0d8;--paper:#fbfaf8;--accent:#f3f0ea}
    *{box-sizing:border-box}
    body{margin:0;background:#fff;color:var(--ink);font-family:"Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:1.5}
    a{color:inherit}
    .page{max-width:1180px;margin:0 auto;padding:56px 28px 128px}
    .eyebrow,.btn,.piece-name,.total,.footer{font-family:"Helvetica Neue Condensed","Arial Narrow",Arial,sans-serif;text-transform:uppercase;letter-spacing:.02em}
    .eyebrow{font-size:11px;color:var(--muted)}
    h1,h2{font-family:"Helvetica Neue Condensed","Arial Narrow",Arial,sans-serif;text-transform:uppercase;letter-spacing:.02em;line-height:1.02;margin:8px 0 12px}
    h1{font-size:24px} h2{font-size:20px}
    .note{color:var(--muted);max-width:760px}
    .cover{border-bottom:1px solid var(--line);padding-bottom:28px}
    .look{display:grid;grid-template-columns:5fr 4fr;gap:44px;padding:56px 0;border-bottom:1px solid var(--line)}
    .look-hero img{width:100%;aspect-ratio:3/4;object-fit:cover;background:var(--accent);display:block;cursor:zoom-in}
    .pieces{display:grid}
    .piece{display:grid;grid-template-columns:24px 84px 1fr;gap:14px;align-items:start;padding:16px 0;border-top:1px solid var(--line)}
    .piece:first-child{border-top:1px solid var(--ink)}
    .piece input{width:16px;height:16px;margin-top:4px}
    .piece img{width:84px;aspect-ratio:3/4;object-fit:cover;background:var(--accent);cursor:zoom-in}
    .piece-name{font-weight:700;font-size:13px}
    .piece-meta,.piece a{color:var(--muted);font-size:12px}
    .total{font-weight:700;border-top:1px solid var(--ink);padding-top:16px;margin-top:16px}
    .btn{border:1px solid var(--ink);background:#fff;color:var(--ink);min-height:42px;padding:11px 18px;font-size:12px;cursor:pointer}
    .btn:hover,.btn.primary{background:var(--ink);color:#fff}
    .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
    .footer{text-align:center;color:var(--muted);font-size:11px;padding-top:40px}
    #cart-bar{position:fixed;left:0;right:0;bottom:0;z-index:5;background:var(--ink);color:#fff;padding:14px 28px;display:none;align-items:center;justify-content:space-between;gap:16px}
    #cart-bar.show{display:flex}
    #cart-bar button{background:#fff;color:var(--ink);border:1px solid #fff;padding:12px 18px;cursor:pointer}
    #handoff{display:none;position:fixed;inset:28px;z-index:10;background:#fff;box-shadow:0 0 60px rgba(0,0,0,.25);padding:28px;overflow:auto}
    #handoff.show{display:block}
    #handoff pre{white-space:pre-wrap;background:var(--paper);padding:16px;line-height:1.5;max-height:52vh;overflow:auto}
    #lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:20;padding:24px}
    #lightbox.show{display:flex}
    #lightbox img{max-width:100%;max-height:100%;object-fit:contain}
    @media(max-width:760px){.page{padding:34px 16px 118px}.look{grid-template-columns:1fr;gap:18px;padding:36px 0}.piece{grid-template-columns:22px 64px 1fr}.piece img{width:64px}#cart-bar{padding:12px 16px;align-items:stretch}#handoff{inset:12px;padding:18px}}
  </style>
</head>
<body>
  <div class="page">
    <header class="cover">
      <div class="eyebrow">Buck Mason - ${escapeHtml(manifest.lookbook_id)}</div>
      <h1>${title}</h1>
      <p class="note">${subtitle}</p>
      <div class="actions">
        <button type="button" class="btn" onclick="toggleAll()">Select all looks</button>
        <button type="button" class="btn primary" onclick="openTopVotedHandoff()">Give me the winners</button>
      </div>
      <p class="piece-meta">${escapeHtml(manifest.disclosure)}</p>
    </header>
    ${looks.map((look: any) => renderLook(look, picks)).join('\n')}
    <div class="footer">Buck Mason - Pima.io - buckmason CLI</div>
  </div>
  <div id="cart-bar">
    <span><span id="cart-count">0</span> selected - <span id="cart-total">$0</span></span>
    <button type="button" onclick="openHandoff()">Send to my stylist</button>
  </div>
  <div id="handoff" role="dialog" aria-modal="true">
    <h2 id="handoff-title">Tell your stylist</h2>
    <p id="handoff-intro" class="note">Speak this aloud to a voice agent, or paste it into a chat. Your agent will confirm shipping or pickup, coupon, and credit before charging.</p>
    <pre id="handoff-text"></pre>
    <div class="actions">
      <button type="button" class="btn primary" onclick="copyHandoff(this)">Copy to clipboard</button>
      <button type="button" class="btn" onclick="closeHandoff()">Close</button>
    </div>
  </div>
  <div id="lightbox" onclick="closeLightbox(event)"><img id="lightbox-img" alt=""></div>
  <script type="application/json" id="lookbook-data">${escapeHtml(JSON.stringify(manifest))}</script>
  <script>
    const LOOKBOOK = JSON.parse(document.getElementById('lookbook-data').textContent);
    function selected(){return [...document.querySelectorAll('.piece input:checked')].map(el=>({name:el.dataset.name,size:el.dataset.size,sku:el.dataset.sku,qty:Number(el.dataset.qty||1),cents:Number(el.dataset.priceCents||0)}))}
    function money(c){return '$'+(c/100).toFixed(c%100===0?0:2)}
    function refresh(){const items=selected();document.getElementById('cart-count').textContent=items.length;document.getElementById('cart-total').textContent=money(items.reduce((s,i)=>s+i.cents*i.qty,0));document.getElementById('cart-bar').classList.toggle('show',items.length>0)}
    function toggleAll(){const boxes=[...document.querySelectorAll('.piece input')];const all=boxes.length&&boxes.every(b=>b.checked);boxes.forEach(b=>b.checked=!all);refresh()}
    function handoffText(items=selected()){if(!items.length)return '';const subtotal=items.reduce((s,i)=>s+i.cents*i.qty,0);return ['Buck Mason - '+LOOKBOOK.title+' ('+LOOKBOOK.date+')','',"I'd like to order:",...items.map(i=>'- '+i.name+' - size '+i.size+' - '+money(i.cents)+(i.qty>1?' (x'+i.qty+')':'')+(i.sku?' - SKU '+i.sku:'')),'','Subtotal at pick: '+money(subtotal),'Please confirm shipping or pickup, any coupon or credit, and run checkout.'].join('\\n')}
    function showHandoff(text,title){document.getElementById('handoff-title').textContent=title||'Tell your stylist';document.getElementById('handoff-text').textContent=text;document.getElementById('handoff').classList.add('show')}
    function openHandoff(){showHandoff(handoffText())}
    function closeHandoff(){document.getElementById('handoff').classList.remove('show')}
    async function copyHandoff(btn){await navigator.clipboard?.writeText(document.getElementById('handoff-text').textContent).catch(()=>{});btn.textContent='Copied'}
    function bucket(raw){const up=Number(raw?.up||0),down=Number(raw?.down||0),total=up+down;return{up,down,total,net:up-down,likeRate:total?up/total:null}}
    function topVotes(tally){const looks=Object.fromEntries((LOOKBOOK.looks||[]).map((l,i)=>[l.id,{...l,order:i,votes:bucket(tally?.looks?.[l.id])}]));return (LOOKBOOK.items||[]).map((item,i)=>{const v=bucket(tally?.items?.[item.sku]);const lv=looks[item.look_id]?.votes||bucket();const recommended=(v.total>=1&&v.net>0)||(v.total===0&&lv.total>=1&&lv.net>0);return{...item,v,lv,recommended,score:v.net*100+v.up*8-v.down*12+lv.net*12-i}}).filter(i=>i.recommended).sort((a,b)=>b.score-a.score).slice(0,8)}
    async function openTopVotedHandoff(){try{const res=await fetch('/api/votes?public=1&fresh=1',{headers:{accept:'application/json'}});if(!res.ok)throw new Error('votes unavailable');const tally=(await res.json()).tally;const picks=topVotes(tally);showHandoff(handoffText(picks),'Top-voted picks')}catch{showHandoff('Ask my stylist agent to rank the votes for '+location.href+' and order the top-voted picks.','Top-voted picks')}}
    document.addEventListener('change',e=>{if(e.target.matches('.piece input'))refresh()})
    document.addEventListener('click',e=>{const img=e.target.closest('.look-hero img,.piece img');if(!img)return;e.preventDefault();document.getElementById('lightbox-img').src=img.dataset.fullsize||img.src;document.getElementById('lightbox').classList.add('show')},true)
    function closeLightbox(e){if(e&&e.target&&e.target.id==='lightbox-img')return;document.getElementById('lightbox').classList.remove('show')}
    document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLightbox()})
  </script>
</body>
</html>`
}

function renderLook(look: any, picks: any[]): string {
  const pieces = picks.filter((pick) => String(pick.look || pick.look_id) === String(look.id))
  const subtotal = pieces.reduce((sum, piece) => sum + Number(piece.price_cents || 0) * Number(piece.quantity || piece.qty || 1), 0)
  return `<section class="look" data-look="${escapeHtml(look.id)}">
  <div class="look-hero"><img src="${escapeHtml(look.hero_image || '')}" data-fullsize="${escapeHtml(look.hero_image || '')}" alt="${escapeHtml(look.title || look.id)}"></div>
  <div>
    <div class="eyebrow">${escapeHtml(look.eyebrow || look.id)}</div>
    <h2>${escapeHtml(look.title || look.id)}</h2>
    <p class="note">${escapeHtml(look.note || '')}</p>
    <div class="pieces">${pieces.map(renderPiece).join('\n')}</div>
    <div class="total">Look subtotal - ${money(subtotal)}</div>
  </div>
</section>`
}

function renderPiece(piece: any): string {
  const image = imageUrl(piece)
  const priceCents = Number(piece.price_cents || 0)
  const quantity = Number(piece.quantity || piece.qty || 1)
  return `<label class="piece">
  <input type="checkbox" data-name="${escapeHtml(piece.name || '')}" data-size="${escapeHtml(piece.picked_size || piece.size || '')}" data-sku="${escapeHtml(piece.sku || '')}" data-qty="${quantity}" data-price-cents="${priceCents}">
  <img src="${escapeHtml(image)}" data-fullsize="${escapeHtml(fullsizeUrl(piece))}" alt="${escapeHtml(piece.name || '')}">
  <span>
    <span class="piece-name">${escapeHtml(piece.name || '')}</span><br>
    <span class="piece-meta">${escapeHtml(piece.color || '')} - size ${escapeHtml(piece.picked_size || piece.size || '')}</span><br>
    <span>${money(priceCents)}</span><br>
    <a href="${escapeHtml(piece.url || '#')}" target="_blank" rel="noopener">View on buckmason.com</a>
  </span>
</label>`
}

function imageUrl(piece: any): string {
  return piece?.try_on?.url || piece?.hero?.url || piece?.image_url || piece?.try_on_url || ''
}

function fullsizeUrl(piece: any): string {
  return piece?.hero?.url || piece?.try_on?.url || piece?.image_url || piece?.try_on_url || ''
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

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
}
