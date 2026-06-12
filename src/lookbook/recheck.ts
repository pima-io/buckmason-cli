import {existsSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import type {LookbookImagePlan, LookImagePlan} from './image-generation.js'

export type OutfitRecheckSeverity = 'pass' | 'warning' | 'hard_fail'

export interface OutfitRecheckItem {
  sku: string
  name?: string
  expected: string
  observed: string
  pass: boolean
  severity: OutfitRecheckSeverity
  note?: string
}

export interface OutfitRecheckLookResult {
  look_id: string
  title?: string
  overall_pass: boolean
  severity: OutfitRecheckSeverity
  items: OutfitRecheckItem[]
  warnings: string[]
  failures: string[]
  regeneration_prompt_addendum?: string
  raw?: unknown
}

export interface OutfitRecheckReport {
  ok: boolean
  lookbook_id: string
  generated_at: string
  hard_failures: number
  warnings: number
  looks: OutfitRecheckLookResult[]
}

export interface OutfitRecheckLookInput {
  id: string
  title: string
  heroPath: string
  setting?: string
  composition?: string
  pieces: OutfitRecheckPiece[]
}

export interface OutfitRecheckPiece {
  index: number
  sku: string
  name: string
  category?: string
  color?: string
  size?: string
  rationale?: string
  imageUrl?: string
}

export interface OutfitRecheckPlan {
  lookbookId: string
  runDir: string
  looks: OutfitRecheckLookInput[]
  imagePlan: LookbookImagePlan
}

export async function loadOutfitRecheckPlan(options: {
  runDir: string
  lookIds?: string[]
}): Promise<OutfitRecheckPlan> {
  const runDir = expandHome(options.runDir)
  const config = JSON.parse(await readFile(path.join(runDir, 'config.json'), 'utf8'))
  const picks = JSON.parse(await readFile(path.join(runDir, 'picks.json'), 'utf8')) as Array<Record<string, any>>
  const imagePlan = JSON.parse(await readFile(path.join(runDir, 'image-plan.json'), 'utf8')) as LookbookImagePlan
  const selected = new Set((options.lookIds || []).filter(Boolean))
  const configLooks = Array.isArray(config.looks) ? config.looks : []

  const looks = configLooks
    .filter((look: Record<string, any>) => !selected.size || selected.has(String(look.id)))
    .map((look: Record<string, any>) => {
      const id = String(look.id)
      const imageLook = imagePlan.looks.find((entry) => entry.id === id)
      const lookPicks = picks.filter((pick) => String(pick.look || pick.look_id) === id)
      return {
        id,
        title: String(look.title || id),
        setting: String(look.setting || ''),
        composition: String(look.composition || ''),
        heroPath: path.join(runDir, 'looks', `${id}.png`),
        pieces: lookPicks.map((piece, index) => ({
          index: index + 1,
          sku: String(piece.sku || piece.id || `piece-${index + 1}`),
          name: String(piece.name || piece.sku || `Piece ${index + 1}`),
          category: piece.category ? String(piece.category) : undefined,
          color: piece.color ? String(piece.color) : undefined,
          size: piece.picked_size || piece.size ? String(piece.picked_size || piece.size) : undefined,
          rationale: piece.rationale ? String(piece.rationale) : undefined,
          imageUrl: imageLook?.garments[index]?.url || piece.try_on?.url || piece.try_on_url || piece.image_url,
        })),
      } satisfies OutfitRecheckLookInput
    })

  for (const look of looks) {
    if (!existsSync(look.heroPath)) throw new Error(`Missing generated look image: ${look.heroPath}`)
  }

  return {
    lookbookId: String(imagePlan.lookbook_id || config.lookbook_id || 'lookbook'),
    runDir,
    looks,
    imagePlan,
  }
}

export async function recheckLookbook(options: {
  runDir: string
  apiKey: string
  apiBase?: string
  model?: string
  lookIds?: string[]
  failOnWarning?: boolean
  fetchImpl?: typeof fetch
}): Promise<OutfitRecheckReport> {
  const plan = await loadOutfitRecheckPlan({runDir: options.runDir, lookIds: options.lookIds})
  const looks: OutfitRecheckLookResult[] = []
  for (const look of plan.looks) {
    looks.push(await recheckLook({
      look,
      apiKey: options.apiKey,
      apiBase: options.apiBase,
      model: options.model,
      fetchImpl: options.fetchImpl,
    }))
  }

  return buildOutfitRecheckReport({
    lookbookId: plan.lookbookId,
    looks,
    failOnWarning: options.failOnWarning,
  })
}

export async function recheckLook(options: {
  look: OutfitRecheckLookInput
  apiKey: string
  apiBase?: string
  model?: string
  fetchImpl?: typeof fetch
}): Promise<OutfitRecheckLookResult> {
  const content: any[] = [{type: 'text', text: buildLookRecheckPrompt(options.look)}]
  content.push({type: 'image_url', image_url: {url: await dataUrl(options.look.heroPath), detail: 'high'}})
  for (const piece of options.look.pieces) {
    if (piece.imageUrl) content.push({type: 'image_url', image_url: {url: piece.imageUrl, detail: 'high'}})
  }

  const fetcher = options.fetchImpl || fetch
  const response = await fetcher(`${options.apiBase || 'https://api.openai.com'}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model || 'gpt-4o',
      messages: [
        {role: 'system', content: OUTFIT_RECHECK_SYSTEM},
        {role: 'user', content},
      ],
      response_format: {type: 'json_object'},
      max_tokens: 1200,
      temperature: 0,
    }),
  })

  const body = await response.text()
  if (!response.ok) throw new Error(`outfit recheck returned HTTP ${response.status}: ${body.slice(0, 500)}`)
  const parsed = JSON.parse(body)
  const raw = parsed?.choices?.[0]?.message?.content
  if (!raw) throw new Error('outfit recheck response did not include choices[0].message.content')
  return normalizeOutfitRecheckResponse(JSON.parse(raw), options.look)
}

export function buildLookRecheckPrompt(look: OutfitRecheckLookInput): string {
  return [
    'OUTFIT RECHECK',
    'Image 1 is the generated lookbook hero image.',
    `Images 2-${look.pieces.length + 1} are the exact garment references in the same order as the product list below.`,
    '',
    `Look: ${look.id} - ${look.title}`,
    look.setting ? `Setting: ${look.setting}` : '',
    look.composition ? `Composition: ${look.composition}` : '',
    '',
    'Expected garments:',
    ...look.pieces.map((piece) => [
      `Garment ${piece.index}:`,
      `- SKU: ${piece.sku}`,
      `- Name: ${piece.name}`,
      `- Category: ${piece.category || 'unknown'}`,
      `- Color: ${piece.color || 'unknown'}`,
      `- Size: ${piece.size || 'unknown'}`,
      piece.rationale ? `- Styling rationale: ${piece.rationale}` : '',
      piece.imageUrl ? `- Reference image: image ${piece.index + 1}` : '- Reference image: unavailable; judge from text only',
    ].filter(Boolean).join('\n')),
    '',
    'Judge only whether the generated outfit matches the selected Buck Mason products.',
    'Hard failures:',
    '- Wrong garment category, such as chinos instead of jeans, tee instead of polo, or missing outerwear.',
    '- Wrong color family, especially bottoms rendered dark when the product reference is pale, natural, white, or ecru.',
    '- Missing or replaced selected products.',
    '- Invented logos, large graphics, pocket flaps, contrast trims, or major construction details absent from the product reference.',
    '- Do not hard fail dark-neutral ambiguity when the expected product is already dark, such as B007/dark indigo denim reading dark, navy, or nearly black in office lighting.',
    '',
    'Warnings:',
    '- Minor fit differences, mild texture ambiguity, or small detail loss when the garment category and color are still clearly right.',
    '- Subtle pattern or weave loss, such as pinstripe, seersucker, herringbone, or twill texture that is hard to see at image scale, when the garment silhouette and base color are right.',
    '- Dark indigo, dress navy, charcoal, or black garments that are visually close enough to be plausible under the generated lighting.',
    '- Minor sweater neckline ambiguity, such as mock neck versus crewneck, when the garment is otherwise the right sweater color and knit family.',
    '',
    'Do not judge the person identity, face quality, background, pose, footwear, or non-Buck-Mason accessories unless they hide or alter the selected garments.',
    'Return JSON only with this exact shape:',
    '{"look_id":"look2","overall_pass":false,"severity":"hard_fail","items":[{"sku":"SKU","name":"Item","expected":"short expected garment description","observed":"what image 1 shows","pass":false,"severity":"hard_fail","note":"short reason"}],"warnings":[],"failures":["short failure"],"regeneration_prompt_addendum":"Specific prompt text to fix failed garments, or empty string if passing."}',
  ].filter(Boolean).join('\n')
}

export function normalizeOutfitRecheckResponse(raw: any, look: OutfitRecheckLookInput): OutfitRecheckLookResult {
  const items: any[] = Array.isArray(raw?.items) ? raw.items : []
  const normalizedItems: OutfitRecheckItem[] = items.map((item: any, index: number): OutfitRecheckItem => {
    const fallback = look.pieces[index]
    const severity = normalizeSeverity(item?.severity, item?.pass === false ? 'hard_fail' : 'pass')
    return adjustItemSeverity({
      sku: String(item?.sku || fallback?.sku || `piece-${index + 1}`),
      name: item?.name || fallback?.name ? String(item?.name || fallback?.name) : undefined,
      expected: String(item?.expected || expectedPieceSummary(fallback) || ''),
      observed: String(item?.observed || ''),
      pass: item?.pass === undefined ? severity === 'pass' : Boolean(item.pass),
      severity,
      note: item?.note ? String(item.note) : undefined,
    }, fallback)
  })
  const hasHardFail = normalizedItems.some((item) => item.severity === 'hard_fail' || !item.pass)
  const hasWarning = normalizedItems.some((item) => item.severity === 'warning')
  const rawSeverity = normalizeSeverity(raw?.severity, hasHardFail ? 'hard_fail' : hasWarning ? 'warning' : 'pass')
  const severity = deriveLookSeverity(rawSeverity, normalizedItems, arrayOfStrings(raw?.failures))
  const itemFailures = normalizedItems.filter((item) => item.severity === 'hard_fail' || !item.pass).map((item) => `${item.sku}: ${item.note || item.observed || 'visual mismatch'}`)
  const warnings = [
    ...arrayOfStrings(raw?.warnings),
    ...normalizedItems.filter((item) => item.severity === 'warning').map((item) => `${item.sku}: ${item.note || item.observed || 'visual ambiguity'}`),
  ]

  return {
    look_id: look.id,
    title: look.title,
    overall_pass: severity !== 'hard_fail',
    severity,
    items: normalizedItems,
    warnings,
    failures: severity === 'hard_fail' ? (arrayOfStrings(raw?.failures).length ? arrayOfStrings(raw?.failures) : itemFailures) : [],
    regeneration_prompt_addendum: raw?.regeneration_prompt_addendum ? String(raw.regeneration_prompt_addendum).trim() : undefined,
  }
}

export function buildOutfitRecheckReport(options: {
  lookbookId: string
  looks: OutfitRecheckLookResult[]
  failOnWarning?: boolean
}): OutfitRecheckReport {
  const hardFailures = options.looks.reduce((sum, look) => sum + (look.severity === 'hard_fail' || !look.overall_pass ? 1 : 0), 0)
  const warnings = options.looks.reduce((sum, look) => sum + (look.severity === 'warning' ? 1 : 0) + look.warnings.length, 0)
  return {
    ok: hardFailures === 0 && (!options.failOnWarning || warnings === 0),
    lookbook_id: options.lookbookId,
    generated_at: new Date().toISOString(),
    hard_failures: hardFailures,
    warnings,
    looks: options.looks,
  }
}

export function failedLookIds(report: OutfitRecheckReport, options: {failOnWarning?: boolean} = {}): string[] {
  return report.looks
    .filter((look) => look.severity === 'hard_fail' || !look.overall_pass || (options.failOnWarning && (look.severity === 'warning' || look.warnings.length > 0)))
    .map((look) => look.look_id)
}

export function imagePlanWithRecheckAddenda(
  imagePlan: LookbookImagePlan,
  report: OutfitRecheckReport,
  options: {failOnWarning?: boolean} = {},
): LookbookImagePlan {
  const failed = new Map(report.looks
    .filter((look) => failedLookIds(report, options).includes(look.look_id))
    .map((look) => [look.look_id, look]))
  return {
    ...imagePlan,
    looks: imagePlan.looks.map((look) => {
      const result = failed.get(look.id)
      if (!result) return look
      return {
        ...look,
        prompt: [
          look.prompt,
          '',
          'OUTFIT RECHECK FIX ADDENDUM - NON-NEGOTIABLE',
          ...(result.failures.length ? result.failures.map((failure) => `- Failed visual QA: ${failure}`) : []),
          result.regeneration_prompt_addendum || 'Regenerate this look so every selected garment matches its product reference by category, color, silhouette, and visible construction details.',
        ].filter(Boolean).join('\n'),
      }
    }),
  }
}

export function filterImagePlanLooks(imagePlan: LookbookImagePlan, lookIds: string[]): LookbookImagePlan {
  const selected = new Set(lookIds)
  return {
    ...imagePlan,
    looks: imagePlan.looks.filter((look) => selected.has(look.id)),
  }
}

export async function writeImagePlan(imagePlan: LookbookImagePlan, imagePlanPath: string): Promise<void> {
  await writeFile(imagePlanPath, `${JSON.stringify(imagePlan, null, 2)}\n`)
}

export function renderOutfitRecheckSummary(report: OutfitRecheckReport): string {
  const lines = [`Outfit recheck ${report.ok ? 'passed' : 'failed'}: ${report.hard_failures} hard failure(s), ${report.warnings} warning(s).`]
  for (const look of report.looks) {
    lines.push(`${look.look_id}: ${look.severity.toUpperCase()}${look.title ? ` - ${look.title}` : ''}`)
    for (const failure of look.failures) lines.push(`- ${failure}`)
    for (const warning of look.warnings) lines.push(`- Warning: ${warning}`)
    for (const item of look.items.filter((entry) => entry.severity !== 'pass' || !entry.pass)) {
      lines.push(`- ${item.sku}: expected ${item.expected}; observed ${item.observed || 'unspecified'}${item.note ? ` (${item.note})` : ''}`)
    }
  }
  return lines.join('\n')
}

function adjustItemSeverity(item: OutfitRecheckItem, piece?: OutfitRecheckPiece): OutfitRecheckItem {
  if (item.severity !== 'hard_fail' && item.pass !== false) return item
  if (!isDarkDenimAmbiguity(item, piece) && !isMockNeckAmbiguity(item, piece)) return item
  return {
    ...item,
    pass: true,
    severity: 'warning',
    note: item.note ? `${item.note} Treated as visual-detail ambiguity.` : 'Treated as visual-detail ambiguity.',
  }
}

function deriveLookSeverity(
  rawSeverity: OutfitRecheckSeverity,
  items: OutfitRecheckItem[],
  rawFailures: string[],
): OutfitRecheckSeverity {
  const hasHardFail = items.some((item) => item.severity === 'hard_fail' || !item.pass)
  if (hasHardFail) return 'hard_fail'
  const hasWarning = items.some((item) => item.severity === 'warning')
  if (hasWarning) return 'warning'
  if (rawSeverity === 'hard_fail' && items.length === 0 && rawFailures.length > 0) return 'hard_fail'
  return rawSeverity === 'warning' ? 'warning' : 'pass'
}

function isDarkDenimAmbiguity(item: OutfitRecheckItem, piece?: OutfitRecheckPiece): boolean {
  const expected = [item.expected, piece?.name, piece?.category, piece?.color].join(' ').toLowerCase()
  const observed = [item.observed, item.note].join(' ').toLowerCase()
  if (!/(jean|denim|b007|ford standard)/.test(expected)) return false
  if (/(pale|ecru|off-white|off white|white|natural|cream|khaki|light)/.test(expected)) return false
  return /(dark|indigo|navy|black|b007)/.test(expected) && /(black|dark|not b007|denim|jean)/.test(observed)
}

function isMockNeckAmbiguity(item: OutfitRecheckItem, piece?: OutfitRecheckPiece): boolean {
  const expected = [item.expected, piece?.name, piece?.category, piece?.color].join(' ').toLowerCase()
  const observed = [item.observed, item.note].join(' ').toLowerCase()
  if (!/(mock neck|mock-neck|turtleneck)/.test(expected)) return false
  if (!/(sweater|knit|wool|anatomica)/.test(expected)) return false
  return /(crewneck|crew neck|neckline|collar)/.test(observed)
}

function expectedPieceSummary(piece?: OutfitRecheckPiece): string {
  if (!piece) return ''
  return [piece.color, piece.name, piece.category, piece.size ? `size ${piece.size}` : ''].filter(Boolean).join(' ')
}

function normalizeSeverity(value: unknown, fallback: OutfitRecheckSeverity): OutfitRecheckSeverity {
  if (value === 'hard_fail' || value === 'warning' || value === 'pass') return value
  return fallback
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => String(entry)).filter(Boolean)
}

async function dataUrl(filePath: string): Promise<string> {
  const bytes = await readFile(filePath)
  return `data:${mimeFromPath(filePath)};base64,${Buffer.from(bytes).toString('base64')}`
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

function expandHome(value: string): string {
  if (value === '~') return process.env.HOME || value
  if (value.startsWith('~/')) return path.join(process.env.HOME || '', value.slice(2))
  return value
}

const OUTFIT_RECHECK_SYSTEM = `You are a strict merchandise QA gate for AI-generated Buck Mason try-on lookbooks.
Your job is to compare the generated hero image against the selected product reference images.
Be conservative about product correctness. Wrong garment color, wrong bottoms, missing outerwear, or changed garment category are hard failures.
Do not critique the customer's identity, attractiveness, background, photography style, or product styling unless it affects product accuracy.
Return valid JSON only.`
