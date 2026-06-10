import {access, mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {validateLookbookDir} from './validate.js'

export interface PrepareDeployOptions {
  dir: string
  project: string
  lookbookId?: string
  kvId?: string
  withVoting?: boolean
}

export async function prepareCloudflarePagesDeploy(options: PrepareDeployOptions): Promise<{lookbookId: string; voting: boolean}> {
  await access(path.join(options.dir, 'index.html'))
  const lookbookId = options.lookbookId || await readLookbookId(options.dir) || options.project.replace(/^buckmason-/, '')
  if (options.withVoting ?? true) {
    if (!options.kvId) throw new Error('Voting is enabled but no KV namespace id was provided. Pass --kv-id or set LOOKBOOK_VOTES_KV_ID.')
    await injectVotingUi(options.dir)
    await writeVotingFunctions(options.dir)
    await writeWranglerToml(options.dir, options.project, lookbookId, options.kvId)
  }

  return {lookbookId, voting: options.withVoting ?? true}
}

export async function deployWithWrangler(options: {
  dir: string
  project: string
  dryRun?: boolean
  auto?: boolean
  noOverwrite?: boolean
}): Promise<string> {
  const validation = await validateLookbookDir(options.dir)
  if (!validation.ok) throw new Error(`Local validation failed: ${validation.failures.join('; ')}`)
  if (options.dryRun) return `https://${options.project}.pages.dev/`

  await run('wrangler', ['whoami'])
  const exists = await wranglerProjectExists(options.project)
  if (!exists) await run('wrangler', ['pages', 'project', 'create', options.project, '--production-branch', 'main'])
  else if (options.noOverwrite) {
    const list = await runCapture('wrangler', ['pages', 'deployment', 'list', '--project-name', options.project])
    if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(list)) {
      throw new Error(`--no-overwrite set, but project ${options.project} already has deployments.`)
    }
  }

  await run('wrangler', ['pages', 'deploy', options.dir, '--project-name', options.project, '--branch', 'main', '--commit-dirty=true'])
  return `https://${options.project}.pages.dev/`
}

export async function injectVotingUi(dir: string): Promise<void> {
  const indexPath = path.join(dir, 'index.html')
  const manifest = JSON.parse(await readFile(path.join(dir, 'lookbook.json'), 'utf8'))
  let html = await readFile(indexPath, 'utf8')
  if (html.includes('id="vote-widget-css"')) return

  const css = `<style id="vote-widget-css">
.vote-box{border-top:1px solid #e5e0d8;margin-top:18px;padding-top:14px;display:grid;gap:10px}
.vote-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.vote-row button{border:1px solid #2d2926;background:#fff;min-height:38px;padding:8px 12px;cursor:pointer}
.vote-row button.is-selected{background:#2d2926;color:#fff}
.vote-box input,.vote-box textarea{border:1px solid #d8d2ca;padding:9px;font:inherit;width:100%}
.vote-status{color:#6f675f;font-size:12px}
</style>`
  html = html.replace('</head>', `${css}\n</head>`)
  html = html.replace('</body>', `${renderVotingMarkup(manifest)}\n${VOTE_SCRIPT}\n</body>`)
  await writeFile(indexPath, html)
}

function renderVotingMarkup(manifest: any): string {
  const looks = (manifest.looks || []).map((look: any) => `<section class="vote-box" data-vote-look="${escapeHtml(look.id)}">
  <strong>${escapeHtml(look.eyebrow || look.title || look.id)}</strong>
  <div class="vote-row">
    <button type="button" data-vote-kind="look" data-vote-id="${escapeHtml(look.id)}" data-vote-value="up">Like look</button>
    <button type="button" data-vote-kind="look" data-vote-id="${escapeHtml(look.id)}" data-vote-value="down">Pass</button>
  </div>
</section>`).join('\n')
  const items = (manifest.items || []).filter((item: any) => item.sku).map((item: any) => `<div class="vote-row">
  <span>${escapeHtml(item.name)} (${escapeHtml(item.size)})</span>
  <button type="button" data-vote-kind="item" data-vote-id="${escapeHtml(item.sku)}" data-vote-value="up">Like</button>
  <button type="button" data-vote-kind="item" data-vote-id="${escapeHtml(item.sku)}" data-vote-value="down">Pass</button>
</div>`).join('\n')

  return `<section class="vote-box" id="lookbook-vote-widget">
  <h2>Vote on this lookbook</h2>
  <input id="vote-voter" maxlength="60" placeholder="Your name">
  ${looks}
  <details><summary>Vote on individual pieces</summary>${items}</details>
  <textarea id="vote-comment" maxlength="1000" rows="3" placeholder="Comments"></textarea>
  <button type="button" class="btn primary" onclick="submitLookbookVote()">Submit votes</button>
  <span class="vote-status" id="vote-status" aria-live="polite"></span>
</section>`
}

const VOTE_SCRIPT = `<script id="vote-widget-js">
function voteBallotId(){const key='buckmason-lookbook-ballot';let id=localStorage.getItem(key);if(!id){id=crypto.randomUUID();localStorage.setItem(key,id)}return id}
document.addEventListener('click',e=>{const b=e.target.closest('[data-vote-kind]');if(!b)return;const group=b.parentElement;group.querySelectorAll('[data-vote-kind="'+b.dataset.voteKind+'"][data-vote-id="'+b.dataset.voteId+'"]').forEach(x=>x.classList.remove('is-selected'));b.classList.add('is-selected')})
async function submitLookbookVote(){const status=document.getElementById('vote-status');const looks={},items={};document.querySelectorAll('[data-vote-kind].is-selected').forEach(b=>{(b.dataset.voteKind==='look'?looks:items)[b.dataset.voteId]=b.dataset.voteValue});status.textContent='Saving';const res=await fetch('/api/vote',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ballot_id:voteBallotId(),voter:document.getElementById('vote-voter').value,comment:document.getElementById('vote-comment').value,looks,items})});status.textContent=res.ok?'Saved':'Could not save vote'}
</script>`

async function writeVotingFunctions(dir: string): Promise<void> {
  const apiDir = path.join(dir, 'functions', 'api')
  await mkdir(apiDir, {recursive: true})
  await writeFile(path.join(apiDir, 'vote.js'), VOTE_POST_FUNCTION)
  await writeFile(path.join(apiDir, 'votes.js'), VOTES_GET_FUNCTION)
}

async function writeWranglerToml(dir: string, project: string, lookbookId: string, kvId: string): Promise<void> {
  await writeFile(path.join(dir, 'wrangler.toml'), `name = "${tomlEscape(project)}"
pages_build_output_dir = "."
compatibility_date = "2026-05-01"

[vars]
LOOKBOOK_ID = "${tomlEscape(lookbookId)}"

[[kv_namespaces]]
binding = "LOOKBOOK_VOTES"
id = "${tomlEscape(kvId)}"
`)
}

async function readLookbookId(dir: string): Promise<string | null> {
  try {
    return (await readFile(path.join(dir, '.lookbook_id'), 'utf8')).trim()
  } catch {
    try {
      return JSON.parse(await readFile(path.join(dir, 'lookbook.json'), 'utf8')).lookbook_id || null
    } catch {
      return null
    }
  }
}

async function wranglerProjectExists(project: string): Promise<boolean> {
  try {
    const list = await runCapture('wrangler', ['pages', 'project', 'list'])
    return new RegExp(`(^|\\s)${escapeRegExp(project)}(\\s|$)`).test(list)
  } catch {
    return false
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: 'inherit'})
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)))
  })
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

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
}

function tomlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const VOTE_POST_FUNCTION = `export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const rawBallotId = String(body.ballot_id || "").slice(0, 96);
  const ballot_id = /^[A-Za-z0-9_-]{12,96}$/.test(rawBallotId) ? rawBallotId : crypto.randomUUID();
  const voter = String(body.voter || "").slice(0, 60).trim() || "anonymous";
  const comment = String(body.comment || "").slice(0, 1000);
  const looks = cleanVotes(body.looks || {}, /^look[0-9]+$/);
  const items = cleanVotes(body.items || {}, /^[A-Za-z0-9._-]{1,64}$/);
  const record = { ballot_id, voter, comment, looks, items, ts: new Date().toISOString(), lookbook_id: env.LOOKBOOK_ID || "unknown", ip: request.headers.get("CF-Connecting-IP") || null, ua: String(request.headers.get("user-agent") || "").slice(0, 200) };
  const key = \`vote:\${record.lookbook_id}:ballot:\${ballot_id}\`;
  await env.LOOKBOOK_VOTES.put(key, JSON.stringify(record));
  return json({ ok: true, key, ballot_id, ts: record.ts });
}
function cleanVotes(raw, keyPattern) { const out = {}; for (const [k, v] of Object.entries(raw || {})) if (keyPattern.test(String(k)) && (v === "up" || v === "down")) out[String(k)] = v; return out; }
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
`

const VOTES_GET_FUNCTION = `export async function onRequestGet({ env }) {
  const prefix = \`vote:\${env.LOOKBOOK_ID || "unknown"}:\`;
  const votes = [];
  let cursor;
  do {
    const list = await env.LOOKBOOK_VOTES.list(cursor ? { prefix, cursor } : { prefix });
    for (const key of list.keys || []) {
      const value = await env.LOOKBOOK_VOTES.get(key.name);
      if (!value) continue;
      try { votes.push(JSON.parse(value)); } catch {}
    }
    cursor = list.cursor;
    if (list.list_complete) break;
  } while (cursor);
  const tally = { count: 0, generated_at: new Date().toISOString(), looks: {}, items: {}, voters: [], recent: [] };
  for (const vote of votes.filter(hasVotes)) {
    tally.count += 1;
    for (const [look, value] of Object.entries(vote.looks || {})) count(tally.looks, look, value);
    for (const [sku, value] of Object.entries(vote.items || {})) count(tally.items, sku, value);
    const safe = { voter: vote.voter, ts: vote.ts, comment: vote.comment, looks: vote.looks, items: vote.items };
    tally.voters.push(safe);
    if (String(vote.comment || "").trim()) tally.recent.push(safe);
  }
  return new Response(JSON.stringify({ ok: true, tally, votes: tally.voters }, null, 2), { headers: { "content-type": "application/json", "cache-control": "public, max-age=2, s-maxage=2" } });
}
function hasVotes(vote) { return Object.keys(vote.looks || {}).length || Object.keys(vote.items || {}).length; }
function count(map, key, value) { if (value !== "up" && value !== "down") return; const bucket = map[key] ||= { up: 0, down: 0, total: 0, score: 0 }; bucket[value] += 1; bucket.total += 1; bucket.score = bucket.up - bucket.down; }
`
