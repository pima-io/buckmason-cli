import {access, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {validateLookbookDir} from './validate.js'
import {
  FAVICON_TAGS,
  VOTE_DOCK,
  VOTE_WIDGET_SCRIPT,
  VOTING_CSS,
} from './voting-templates.js'
import {
  VOTE_POST_FUNCTION,
  VOTE_ROOM_WORKER,
  VOTES_GET_FUNCTION,
  VOTES_LIVE_FUNCTION,
} from './voting-runtime.js'

const DEFAULT_VOTES_KV_TITLE = 'LOOKBOOK_VOTES'

export interface PrepareDeployOptions {
  dir: string
  project: string
  lookbookId?: string
  kvId?: string
  withVoting?: boolean
}

export interface PreparedDeploy {
  lookbookId: string
  voting: boolean
  voteRoomWorkerDir?: string
}

export async function prepareCloudflarePagesDeploy(options: PrepareDeployOptions): Promise<PreparedDeploy> {
  await access(path.join(options.dir, 'index.html'))
  const lookbookId = options.lookbookId || await readLookbookId(options.dir) || options.project.replace(/^buckmason-/, '')
  let voteRoomWorkerDir: string | undefined
  if (options.withVoting ?? true) {
    const kvId = await resolveVotesKvId(options.kvId)
    await injectVotingUi(options.dir)
    await writeVotingFunctions(options.dir)
    const voteRoomWorkerName = `${options.project}-vote-room`
    await writeWranglerToml(options.dir, options.project, lookbookId, kvId, voteRoomWorkerName)
    voteRoomWorkerDir = await writeVoteRoomWorker(lookbookId, kvId, voteRoomWorkerName)
    await fetchFavicons(options.dir)
  }

  return {lookbookId, voting: options.withVoting ?? true, voteRoomWorkerDir}
}

async function resolveVotesKvId(explicitKvId?: string): Promise<string> {
  if (explicitKvId?.trim()) return explicitKvId.trim()

  const title = process.env.LOOKBOOK_VOTES_KV_TITLE || DEFAULT_VOTES_KV_TITLE
  const existing = await findKvNamespaceId(title)
  if (existing) return existing

  const created = await runCapture('wrangler', ['kv', 'namespace', 'create', title])
  const createdId = parseCreatedKvId(created)
  if (!createdId) throw new Error(`Created KV namespace ${title}, but could not parse its id from wrangler output.`)
  return createdId
}

async function findKvNamespaceId(title: string): Promise<string | null> {
  const out = await runCapture('wrangler', ['kv', 'namespace', 'list'])
  try {
    const namespaces = JSON.parse(out)
    const found = Array.isArray(namespaces)
      ? namespaces.find((namespace: any) => namespace?.title === title || namespace?.name === title)
      : null
    return found?.id || null
  } catch {
    const escaped = escapeRegExp(title)
    const match = out.match(new RegExp(`"id"\\s*:\\s*"([^"]+)"[\\s\\S]*?"(?:title|name)"\\s*:\\s*"${escaped}"`))
      || out.match(new RegExp(`"(?:title|name)"\\s*:\\s*"${escaped}"[\\s\\S]*?"id"\\s*:\\s*"([^"]+)"`))
    return match?.[1] || null
  }
}

function parseCreatedKvId(output: string): string | null {
  return output.match(/id\s*=\s*"([^"]+)"/)?.[1] || output.match(/"id"\s*:\s*"([^"]+)"/)?.[1] || null
}

export async function deployWithWrangler(options: {
  dir: string
  project: string
  dryRun?: boolean
  auto?: boolean
  noOverwrite?: boolean
  voteRoomWorkerDir?: string
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

  if (options.voteRoomWorkerDir) {
    await run('wrangler', ['deploy'], {cwd: options.voteRoomWorkerDir})
    await run('wrangler', ['pages', 'deploy', '.', '--project-name', options.project, '--branch', 'main', '--commit-dirty=true'], {cwd: options.dir})
  } else {
    await run('wrangler', ['pages', 'deploy', options.dir, '--project-name', options.project, '--branch', 'main', '--commit-dirty=true'])
  }
  return `https://${options.project}.pages.dev/`
}

export async function injectVotingUi(dir: string): Promise<void> {
  const indexPath = path.join(dir, 'index.html')
  let html = await readFile(indexPath, 'utf8')
  html = stripVotingInjection(html)
  const lookIds = [...new Set([...html.matchAll(/data-look="(look\d+)"/g)].map((match) => match[1]))].sort()
  if (!lookIds.length) throw new Error('No <section data-look="lookN"> blocks found in index.html.')
  for (const lookId of lookIds) {
    html = replaceLookSection(html, lookId, injectLookControls)
  }

  const faviconBlock = `<!-- FAVICON -->\n${FAVICON_TAGS}\n<!-- /FAVICON -->`
  html = html.replace('</head>', `${faviconBlock}\n${VOTING_CSS}\n</head>`)
  html = html.replace('</body>', `${VOTE_DOCK}\n${VOTE_WIDGET_SCRIPT}\n</body>`)
  await writeFile(indexPath, html)
}

function stripVotingInjection(html: string): string {
  return html
    .replace(/<!-- VOTE-WIDGET -->.*?<\/section>\s*/gs, '')
    .replace(/<!-- VOTE-LOOK-INLINE -->.*?<!-- \/VOTE-LOOK-INLINE -->\s*/gs, '')
    .replace(/<!-- VOTE-PIECE-INLINE -->.*?<!-- \/VOTE-PIECE-INLINE -->\s*/gs, '')
    .replace(/<!-- VOTE-DOCK -->.*?<!-- \/VOTE-DOCK -->\s*/gs, '')
    .replace(/<style id="vote-widget-css">.*?<\/style>\s*/gs, '')
    .replace(/<script id="vote-widget-js">.*?<\/script>\s*/gs, '')
    .replace(/<!-- FAVICON -->.*?<!-- \/FAVICON -->\s*/gs, '')
}

function replaceLookSection(html: string, lookId: string, transform: (block: string, lookId: string) => string): string {
  const pattern = new RegExp(`<section[^>]*data-look="${escapeRegExp(lookId)}"[\\s\\S]*?<\\/section>`)
  return html.replace(pattern, (block) => transform(block, lookId))
}

function injectLookControls(block: string, lookId: string): string {
  const lookInline = lookInlineHtml(lookId)
  let next = block.replace(
    /(<div class="look-hero">\s*<img\b[^>]*>\s*)/,
    (_match, prefix) => `${prefix}${lookInline}`,
  )
  if (!next.includes(lookInline)) next = next.replace('<div class="look-pieces">', `${lookInline}<div class="look-pieces">`)
  return injectPieceControls(next)
}

function injectPieceControls(block: string): string {
  return block.replace(/<label\b[^>]*class="piece"[^>]*>[\s\S]*?<\/label>/g, (label) => {
    const match = /<input[^>]*data-name="([^"]*)"[^>]*data-sku="([^"]*)"/s.exec(label)
    if (!match) return label
    const [, name, sku] = match
    return label.replace(/(<\/div>\s*<\/label>)/s, `${pieceInlineHtml(sku, name)}$1`)
  })
}

function thumbsHtml(kind: 'look' | 'item', targetId: string, label: string): string {
  return `<div class="vote-choice" data-kind="${kind}" data-id="${escapeHtml(targetId)}"><button type="button" class="thumb-btn up" data-vote="up" data-state="off" aria-pressed="false" aria-label="Like ${escapeHtml(label)}">Like</button><button type="button" class="thumb-btn down" data-vote="down" data-state="off" aria-pressed="false" aria-label="Pass on ${escapeHtml(label)}">Pass</button></div>`
}

function scoreHtml(kind: 'look' | 'item', targetId: string): string {
  return `<div class="vote-score" data-score-kind="${kind}" data-score-id="${escapeHtml(targetId)}" data-empty="true" aria-live="polite">  <div class="score-counts">    <span class="score-pill score-up"><span data-up>0</span> like</span>    <span class="score-pill score-down"><span data-down>0</span> pass</span>  </div>  <div class="vote-meter" data-vote-meter data-empty="true" aria-hidden="true">    <span class="vote-meter-tick"></span>  </div>  <div class="vote-rollover" data-vote-rollover hidden>    <button type="button" class="vote-rollover-trigger" data-rollover-trigger>Votes</button>    <div class="vote-rollover-panel" data-rollover-panel role="tooltip"></div>  </div></div>`
}

function lookInlineHtml(lookId: string): string {
  return `<!-- VOTE-LOOK-INLINE --><div class="vote-look-inline" data-vote-inline-for="${escapeHtml(lookId)}">  <div class="vote-context"><span class="vote-live-dot"></span>${scoreHtml('look', lookId)}</div>  ${thumbsHtml('look', lookId, 'this look')}</div><!-- /VOTE-LOOK-INLINE -->`
}

function pieceInlineHtml(sku: string, name: string): string {
  return `<!-- VOTE-PIECE-INLINE --><div class="vote-piece-inline" data-vote-inline-for="${escapeHtml(sku)}">  <div class="vote-context">${scoreHtml('item', sku)}</div>  ${thumbsHtml('item', sku, name)}</div><!-- /VOTE-PIECE-INLINE -->`
}

async function writeVotingFunctions(dir: string): Promise<void> {
  const apiDir = path.join(dir, 'functions', 'api')
  await mkdir(apiDir, {recursive: true})
  await mkdir(path.join(apiDir, 'votes'), {recursive: true})
  await writeFile(path.join(apiDir, 'vote.js'), VOTE_POST_FUNCTION)
  await writeFile(path.join(apiDir, 'votes.js'), VOTES_GET_FUNCTION)
  await writeFile(path.join(apiDir, 'votes', 'live.js'), VOTES_LIVE_FUNCTION)
}

async function writeWranglerToml(dir: string, project: string, lookbookId: string, kvId: string, voteRoomWorkerName: string): Promise<void> {
  await writeFile(path.join(dir, 'wrangler.toml'), `name = "${tomlEscape(project)}"
pages_build_output_dir = "."
compatibility_date = "2026-05-01"

[vars]
LOOKBOOK_ID = "${tomlEscape(lookbookId)}"

[[kv_namespaces]]
binding = "LOOKBOOK_VOTES"
id = "${tomlEscape(kvId)}"

[[durable_objects.bindings]]
name = "VOTE_ROOM"
class_name = "VoteRoom"
script_name = "${tomlEscape(voteRoomWorkerName)}"
`)
}

async function writeVoteRoomWorker(lookbookId: string, kvId: string, voteRoomWorkerName: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'buckmason-vote-room-'))
  await writeFile(path.join(dir, 'vote-room-worker.js'), VOTE_ROOM_WORKER)
  await writeFile(path.join(dir, 'wrangler.toml'), `name = "${tomlEscape(voteRoomWorkerName)}"
main = "vote-room-worker.js"
compatibility_date = "2026-05-01"

[vars]
LOOKBOOK_ID = "${tomlEscape(lookbookId)}"

[[kv_namespaces]]
binding = "LOOKBOOK_VOTES"
id = "${tomlEscape(kvId)}"

[[durable_objects.bindings]]
name = "VOTE_ROOM"
class_name = "VoteRoom"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["VoteRoom"]
`)
  return dir
}

async function fetchFavicons(dir: string): Promise<void> {
  const targets = [
    ['favicon-32.png', 'https://www.buckmason.com/favicon-32x32.png'],
    ['favicon-16.png', 'https://www.buckmason.com/icons/icon-48x48.png'],
    ['apple-touch-icon.png', 'https://www.buckmason.com/icons/icon-192x192.png'],
    ['favicon.ico', 'https://www.buckmason.com/favicon.ico'],
  ] as const
  await Promise.all(targets.map(async ([file, url]) => {
    try {
      await access(path.join(dir, file))
    } catch {
      try {
        const response = await fetch(url)
        if (!response.ok) return
        await writeFile(path.join(dir, file), Buffer.from(await response.arrayBuffer()))
      } catch {
        // Favicons are a polish asset; deployment should not fail if Buck Mason blocks this fetch.
      }
    }
  }))
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

function run(command: string, args: string[], options: {cwd?: string} = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: 'inherit', cwd: options.cwd})
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
