import {mkdir, readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import type {ParsedProfile} from './profile.js'

export interface LookbookImagePlanOptions {
  config: Record<string, any>
  picks: Array<Record<string, any>>
  profile: ParsedProfile
  quality?: 'medium' | 'high'
  size?: string
}

export interface LookbookImagePlan {
  model: 'gpt-image-2'
  quality: string
  size: string
  lookbook_id: string
  generated_note: string
  looks: LookImagePlan[]
}

export interface LookImagePlan {
  id: string
  title: string
  setting: string
  composition: string
  prompt: string
  garments: ImageInput[]
  identity_references: ImageInput[]
  output: string
}

export interface ImageInput {
  role: 'garment' | 'identity'
  label: string
  path?: string
  url?: string
  warning?: string
}

export interface FaceVerificationResult {
  scores: Record<string, number>
  off_putting: number
  overall_pass: boolean
  reason: string
}

const FACE_SCORE_FIELDS = [
  'hair_match',
  'beard_match',
  'eye_color_match',
  'skin_tone_match',
  'age_match',
  'asymmetry_match',
]

export function buildLookbookImagePlan(options: LookbookImagePlanOptions): LookbookImagePlan {
  const quality = options.quality || 'high'
  const size = options.size || '1024x1536'
  const lookbookId = String(options.config.lookbook_id || options.config.id || 'lookbook')
  const identityReferences = referencePhotos(options.profile)
  const looks = Array.isArray(options.config.looks) ? options.config.looks : []

  return {
    model: 'gpt-image-2',
    quality,
    size,
    lookbook_id: lookbookId,
    generated_note: 'Garment inputs must be submitted before identity references. Do not silently downgrade from gpt-image-2.',
    looks: looks.map((look: Record<string, any>) => {
      const pieces = options.picks.filter((pick) => String(pick.look || pick.look_id) === String(look.id))
      const garments = pieces.map((piece, index) => garmentImageInput(piece, index))
      return {
        id: String(look.id),
        title: String(look.title || look.id),
        setting: String(look.setting || look.note || options.config.setting || 'Buck Mason editorial environment with natural light.'),
        composition: String(look.composition || options.config.composition || 'Full-body, three-quarter angle, eye-level 35mm editorial photograph.'),
        prompt: renderTryOnPrompt({look, pieces, profile: options.profile, garments, identityReferences}),
        garments,
        identity_references: identityReferences,
        output: `looks/${look.id}.png`,
      }
    }),
  }
}

export async function writeImagePlan(plan: LookbookImagePlan, outPath: string): Promise<void> {
  await mkdir(path.dirname(outPath), {recursive: true})
  await writeFile(outPath, `${JSON.stringify(plan, null, 2)}\n`)
}

export async function generateLookImages(options: {
  plan: LookbookImagePlan
  outDir: string
  apiKey: string
  apiBase?: string
  concurrency?: number
  dryRun?: boolean
}): Promise<Array<{look_id: string; output: string; ok: boolean; error?: string}>> {
  await mkdir(options.outDir, {recursive: true})
  await writeFile(path.join(options.outDir, '.lookbook_id'), `${options.plan.lookbook_id}\n`)
  const max = Math.max(1, Math.min(options.concurrency || options.plan.looks.length || 1, options.plan.looks.length || 1))
  const queue = [...options.plan.looks]
  const results: Array<{look_id: string; output: string; ok: boolean; error?: string}> = []

  async function worker(): Promise<void> {
    while (queue.length) {
      const look = queue.shift()
      if (!look) return
      const output = path.join(options.outDir, `${look.id}.png`)
      if (options.dryRun) {
        await writeFile(path.join(options.outDir, `${look.id}.prompt.txt`), look.prompt)
        results.push({look_id: look.id, output, ok: true})
        continue
      }

      try {
        const bytes = await callOpenAiImageEdit({
          apiKey: options.apiKey,
          apiBase: options.apiBase,
          model: options.plan.model,
          quality: options.plan.quality,
          size: options.plan.size,
          prompt: look.prompt,
          images: [...look.garments, ...look.identity_references],
        })
        await writeFile(output, bytes)
        await writeFile(path.join(options.outDir, `${look.id}.prompt.txt`), look.prompt)
        results.push({look_id: look.id, output, ok: true})
      } catch (error) {
        results.push({look_id: look.id, output, ok: false, error: error instanceof Error ? error.message : String(error)})
      }
    }
  }

  await Promise.all(Array.from({length: max}, () => worker()))
  return results
}

export async function verifyFace(options: {
  generated: string
  references: string[]
  apiKey: string
  model?: string
  apiBase?: string
  threshold?: number
  offPuttingCap?: number
}): Promise<FaceVerificationResult> {
  const threshold = options.threshold ?? 6
  const offPuttingCap = options.offPuttingCap ?? 4
  const content: any[] = [{type: 'text', text: faceVerificationPrompt(threshold, offPuttingCap)}]
  content.push({type: 'image_url', image_url: {url: await dataUrl(options.generated), detail: 'high'}})
  for (const reference of options.references) {
    content.push({type: 'image_url', image_url: {url: await dataUrl(reference), detail: 'high'}})
  }

  const response = await fetch(`${options.apiBase || 'https://api.openai.com'}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model || 'gpt-4o',
      messages: [
        {role: 'system', content: FACE_VERIFICATION_SYSTEM},
        {role: 'user', content},
      ],
      response_format: {type: 'json_object'},
      max_tokens: 400,
      temperature: 0,
    }),
  })

  const body = await response.text()
  if (!response.ok) throw new Error(`vision call returned HTTP ${response.status}: ${body.slice(0, 400)}`)
  const parsed = JSON.parse(body)
  const raw = parsed?.choices?.[0]?.message?.content
  const result = JSON.parse(raw) as FaceVerificationResult
  const scores = result.scores || {}
  const allScoresPass = FACE_SCORE_FIELDS.every((field) => Number(scores[field] || 0) >= threshold)
  const offPuttingPass = Number(result.off_putting ?? 10) <= offPuttingCap
  result.overall_pass = Boolean(allScoresPass && offPuttingPass)
  return result
}

function renderTryOnPrompt(options: {
  look: Record<string, any>
  pieces: Array<Record<string, any>>
  profile: ParsedProfile
  garments: ImageInput[]
  identityReferences: ImageInput[]
}): string {
  const {look, pieces, profile, garments, identityReferences} = options
  const jacketLock = pieces.some((piece) => outerwearLike(piece))
  const longSleeveLock = pieces.some((piece) => longSleeveLike(piece))

  return [
    'IMAGE ORDER - DO NOT MISREAD',
    `Images 1-${garments.length} are garment references. Render only the labeled garments from those images.`,
    `Images ${garments.length + 1}-${garments.length + identityReferences.length} are identity references of the same customer.`,
    'The final generated person must be the customer from the identity references, not any model visible in a garment image.',
    '',
    'IDENTITY - IMMUTABLE',
    identityBlock(profile),
    '',
    jacketLock ? jacketLockBlock(pieces) : '',
    longSleeveLock ? longSleeveBlock(pieces) : '',
    'GARMENT - EXACT MATCH',
    ...pieces.map((piece, index) => garmentBlock(piece, index + 1)),
    '',
    'Hard constraints (do NOT violate):',
    '- Color must match the product reference exactly. No re-tinting, no shifting warmer or cooler.',
    '- Fabric weight must read as described. Show appropriate drape and wrinkle behavior.',
    "- Do NOT add visible logos, brand wordmarks, contrast stitching, embellishments, pocket flaps, or hardware that is not in the reference.",
    '- Do NOT change the silhouette to a tighter or looser fit than specified.',
    '- If a garment reference image contains a model, ignore that model, their other garments, jewelry, hands, face, body, and backdrop.',
    '',
    'SETTING',
    String(look.setting || look.note || 'Natural Buck Mason editorial setting, not a studio backdrop.'),
    '',
    'COMPOSITION',
    String(look.composition || 'Full body, three-quarter angle, weight on back leg, eye-level 35mm, natural posture.'),
    '',
    'STYLE',
    'Photorealistic 35mm editorial color photograph. Natural light. Shallow depth of field. Faithful skin tones. Subtle film grain. No text overlay. No brand marks. No watermarks.',
  ].filter(Boolean).join('\n')
}

function identityBlock(profile: ParsedProfile): string {
  return [
    'Use all identity references as anchors. Preserve real skin texture and asymmetry.',
    `Build: ${profile.build || profile.body_type || 'not specified'}`,
    `Height: ${profile.height || 'not specified'}`,
    `Weight: ${profile.weight || 'not specified'}`,
    `Posture: ${profile.posture || 'not specified'}`,
    `Apparent age: ${profile.age_range || profile.age || 'not specified'}`,
    `Face: ${profile.face || profile.face_notes || 'not specified'}`,
    `Hair: ${profile.hair || profile.hair_color || 'not specified'}`,
    `Beard: ${profile.beard || 'not specified'}`,
    `Eyes: ${profile.eye_color || profile.eyes || 'not specified'}`,
    `Skin: ${profile.skin_tone || profile.skin || 'not specified'}`,
    `Distinguishing features: ${profile.distinguishing_features || 'not specified'}`,
    'Hard constraints:',
    '- Do NOT smooth the customer into a generic model face.',
    '- Do NOT make the customer younger, leaner, more symmetrical, or more conventionally attractive than the references.',
    '- Do NOT add jewelry, watches, bracelets, or rings unless they appear in the identity references.',
    '- If the face looks like a generic AI model, regenerate internally before emitting.',
  ].join('\n')
}

function garmentBlock(piece: Record<string, any>, index: number): string {
  const description = String(piece.description_md || piece.description || '')
  return [
    `Garment ${index} - ${piece.category || piece.slot || 'piece'}:`,
    `- Name: ${piece.name || ''}`,
    `- Color: ${piece.color || piece.color_name || ''}${piece.color_rgb ? ` (${piece.color_rgb})` : ''}`,
    `- Fabric content: ${extractFabric(description) || piece.fabric || 'not specified; infer only from visible garment reference'}`,
    `- Weight / hand: ${extractWeight(description) || piece.weight || 'not specified; keep consistent with visible fabric'}`,
    `- Weave / knit: ${extractWeave(description) || piece.weave || 'not specified'}`,
    `- Silhouette / cut: ${piece.fit || piece.category || 'match the reference image exactly'}`,
    `- Construction details: ${extractConstruction(description) || 'match the reference image exactly; invent no extra details'}`,
    `- Fit on this body: size ${piece.picked_size || piece.size || ''}; natural Buck Mason fit, not shrink-wrapped`,
  ].join('\n')
}

function garmentImageInput(piece: Record<string, any>, index: number): ImageInput {
  const tryOn = piece.try_on || {}
  const hero = piece.hero || {}
  const url = tryOn.url || piece.try_on_url || piece.image_url || hero.url
  return {
    role: 'garment',
    label: `Garment ${index + 1}: ${piece.name || piece.sku || piece.id || 'item'}`,
    url,
    warning: piece.try_on_warning || (!piece.try_on_is_flat && hero.url ? 'Garment source may be editorial; ignore any model, other garments, and backdrop.' : undefined),
  }
}

function referencePhotos(profile: ParsedProfile): ImageInput[] {
  return (profile.reference_photos || []).map((photo, index) => ({
    role: 'identity',
    label: `Identity reference ${index + 1}`,
    path: photo,
  }))
}

function outerwearLike(piece: Record<string, any>): boolean {
  const text = `${piece.name || ''} ${piece.category || ''}`.toLowerCase()
  return /\b(jacket|coat|overshirt|outerwear|blazer|sport coat|sweater|cardigan)\b/.test(text)
}

function longSleeveLike(piece: Record<string, any>): boolean {
  const text = `${piece.name || ''} ${piece.category || ''} ${piece.description_md || ''}`.toLowerCase()
  return /\b(long[- ]sleeve|ls |long sleeve|button-up|button up|shirt jacket)\b/.test(text)
}

function jacketLockBlock(pieces: Array<Record<string, any>>): string {
  const outer = pieces.find(outerwearLike)
  return [
    'CRITICAL JACKET LOCK - NON-NEGOTIABLE',
    `The outermost garment MUST be ${outer?.name || 'the outer layer'} from its garment reference image.`,
    'The image must clearly show its collar, pocket, closure, fabric weight, and hem. If those features are not visible, the brief has failed.',
    '',
  ].join('\n')
}

function longSleeveBlock(pieces: Array<Record<string, any>>): string {
  const longSleeve = pieces.find(longSleeveLike)
  return [
    'SLEEVE LENGTH LOCK',
    `${longSleeve?.name || 'The long-sleeve garment'} must have sleeves clearly visible to the wrist or intentionally rolled to mid-forearm.`,
    'It is NOT a short-sleeve camp shirt unless the garment reference itself is short-sleeve.',
    '',
  ].join('\n')
}

function extractFabric(text: string): string | null {
  return text.match(/\b\d{1,3}%\s+[A-Za-z]+(?:\s*\/\s*\d{1,3}%\s+[A-Za-z]+)*/)?.[0] || null
}

function extractWeight(text: string): string | null {
  return text.match(/\b(?:\d{2,4}\s*gsm|\d+(?:\.\d+)?\s*oz(?:\/sq yd)?)\b/i)?.[0] || null
}

function extractWeave(text: string): string | null {
  return text.match(/\b(oxford|poplin|twill|herringbone|jersey|ribbed|terry|sateen|canvas|denim|linen|cashmere|cotton)\b/i)?.[0] || null
}

function extractConstruction(text: string): string | null {
  const hits = text.match(/\b(single-needle|double-needle|shell buttons?|chest pocket|patch pocket|ribbed collar|button fly|drawstring|pleated front)\b/gi)
  return hits ? [...new Set(hits)].join(', ') : null
}

async function callOpenAiImageEdit(options: {
  apiKey: string
  apiBase?: string
  model: string
  quality: string
  size: string
  prompt: string
  images: ImageInput[]
}): Promise<Buffer> {
  const form = new FormData()
  form.set('model', options.model)
  form.set('prompt', options.prompt)
  form.set('size', options.size)
  form.set('quality', options.quality)
  form.set('n', '1')

  for (const image of options.images) {
    const file = await imageBlob(image)
    form.append('image[]', file.blob, file.filename)
  }

  const response = await fetch(`${options.apiBase || 'https://api.openai.com'}/v1/images/edits`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${options.apiKey}`},
    body: form,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`image edit returned HTTP ${response.status}: ${text.slice(0, 500)}`)
  const parsed = JSON.parse(text)
  const b64 = parsed?.data?.[0]?.b64_json
  if (!b64) throw new Error('image edit response did not include data[0].b64_json')
  return Buffer.from(b64, 'base64')
}

async function imageBlob(image: ImageInput): Promise<{blob: Blob; filename: string}> {
  if (image.path) {
    const bytes = await readFile(image.path)
    return {blob: new Blob([bytes], {type: mimeFromPath(image.path)}), filename: path.basename(image.path)}
  }

  if (!image.url) throw new Error(`Image input ${image.label} has neither path nor url.`)
  const response = await fetch(image.url)
  if (!response.ok) throw new Error(`Failed to fetch ${image.url}: HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') || mimeFromPath(new URL(image.url).pathname)
  return {blob: new Blob([bytes], {type: contentType}), filename: path.basename(new URL(image.url).pathname) || 'image.jpg'}
}

async function dataUrl(filePath: string): Promise<string> {
  const bytes = await readFile(filePath)
  return `data:${mimeFromPath(filePath)};base64,${bytes.toString('base64')}`
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

const FACE_VERIFICATION_SYSTEM = `You are a strict face-verification gate for an AI-generated try-on lookbook.
Compare the first image, a generated lookbook hero, against all subsequent customer reference photos.
The customer paid to see themself in clothes, not a better-looking AI version.
Score conservatively and return JSON only.`

function faceVerificationPrompt(threshold: number, offPuttingCap: number): string {
  return `Verify image 1 against images 2 onward.
Score each 0-10: hair_match, beard_match, eye_color_match, skin_tone_match, age_match, asymmetry_match.
Score off_putting 0-10, where higher means more generic AI model or uncanny.
overall_pass must be true only if every match score is >= ${threshold} and off_putting <= ${offPuttingCap}.
Return JSON only:
{"scores":{"hair_match":0,"beard_match":0,"eye_color_match":0,"skin_tone_match":0,"age_match":0,"asymmetry_match":0},"off_putting":0,"overall_pass":false,"reason":"one sentence"}`
}
