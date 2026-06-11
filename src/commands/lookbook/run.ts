import {Command, Flags} from '@oclif/core'
import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {resolveCompanySlug, resolveHost} from '../../lib/config.js'
import {buildHtmlLookbook} from '../../lookbook/build-html.js'
import {discoverWeeklyCandidates} from '../../lookbook/discover-candidates.js'
import {buildLookbookImagePlan, verifyFace} from '../../lookbook/image-generation.js'
import {parseProfile} from '../../lookbook/profile.js'
import {scoreEvent} from '../../lookbook/score-event.js'
import {validateLookbookDir} from '../../lookbook/validate.js'

export default class LookbookRun extends Command {
  static description = 'Run the headless lookbook pipeline through discover, premium image checkpoint, build, and local validation.'

  static flags = {
    weekly: Flags.boolean({description: 'Weekly newsletter mode'}),
    event: Flags.string({description: 'Event JSON file'}),
    profile: Flags.string({required: true, description: 'Customer profile.md'}),
    'runs-dir': Flags.string({description: 'Run directory root. Defaults to ~/.buckmason/runs.', defaultHelp: '~/.buckmason/runs'}),
    wishlist: Flags.string({description: 'Wishlist JSONL. Defaults to ~/.buckmason/wishlist.jsonl.', defaultHelp: '~/.buckmason/wishlist.jsonl'}),
    'max-pieces': Flags.integer({description: 'Maximum pieces to pick', default: 6}),
    tier: Flags.string({options: ['auto', 'editorial', 'premium'], default: 'auto', description: 'Lookbook tier'}),
    'resume-build': Flags.boolean({description: 'Resume after premium images have been generated'}),
    'lookbook-id': Flags.string({description: 'Override lookbook id'}),
    'no-verify': Flags.boolean({description: 'Skip premium face verification gate'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookRun)
    if (flags.weekly === Boolean(flags.event)) throw new Error('Pass exactly one of --weekly or --event.')

    const host = await resolveHost(flags.host)
    const company = await resolveCompanySlug(flags.company)
    const profile = parseProfile(await readFile(flags.profile, 'utf8'))
    const today = new Date().toISOString().slice(0, 10)
    const lookbookId = flags['lookbook-id'] || await deriveLookbookId(flags.weekly, flags.event, today)
    const runDir = path.join(flags['runs-dir'] || defaultRunsDir(), lookbookId)
    const looksDir = path.join(runDir, 'looks')
    const deployDir = path.join(runDir, 'deploy')
    const picksPath = path.join(runDir, 'picks.json')
    const configPath = path.join(runDir, 'config.json')
    const imagePlanPath = path.join(runDir, 'image-plan.json')
    await mkdir(looksDir, {recursive: true})
    await mkdir(deployDir, {recursive: true})

    if (flags.event && !flags['resume-build']) {
      const event = JSON.parse(await readFile(flags.event, 'utf8'))
      const scored = scoreEvent(event)
      if (scored.action === 'skip') return this.log(`score=${scored.score} action=skip reason=${scored.reason} - no lookbook generated.`)
      if (scored.action === 'soft') return this.log(`score=${scored.score} action=soft - surface to customer next interactive turn.`)
    }

    if (!flags['resume-build']) {
      const picks = await discoverAndPick({host, company, profile, flags})
      await writeFile(picksPath, `${JSON.stringify(picks, null, 2)}\n`)
      await writeFile(configPath, `${JSON.stringify(await buildConfig({flags, lookbookId, today, picks, host}), null, 2)}\n`)
    }

    const config = JSON.parse(await readFile(configPath, 'utf8'))
    const picks = JSON.parse(await readFile(picksPath, 'utf8'))
    const tier = deriveTier(flags.tier, Boolean(flags.weekly), profile)
    if (tier === 'premium') {
      const plan = buildLookbookImagePlan({config, picks, profile})
      await writeFile(imagePlanPath, `${JSON.stringify(plan, null, 2)}\n`)
      const missing = (config.looks || []).filter((look: any) => !existsSync(path.join(looksDir, `${look.id}.png`)))
      if (missing.length) {
        await writeSummary(runDir, [
          'READY_FOR_PREMIUM_IMAGE_STEP',
          '',
          `Image plan: ${imagePlanPath}`,
          `Generate into: ${looksDir}`,
          `Marker: ${path.join(looksDir, '.lookbook_id')} must contain ${lookbookId}`,
          'Next: buckmason lookbook generate-images --plan image-plan.json --out looks, then rerun with --resume-build.',
        ].join('\n'))
        this.log('READY_FOR_PREMIUM_IMAGE_STEP')
        return
      }

      if (!flags['no-verify']) await verifyPremiumFaces(config.looks || [], looksDir, profile)
      await buildHtmlLookbook({configPath, picksPath, outDir: deployDir, lookImagesDir: looksDir})
    } else {
      await buildHtmlLookbook({configPath, picksPath, outDir: deployDir, noTryon: true})
    }

    const validation = await validateLookbookDir(deployDir)
    if (!validation.ok) throw new Error(`Validation failed: ${validation.failures.join('; ')}`)
    await writeSummary(runDir, [`READY_TO_DEPLOY`, '', `Tier: ${tier}`, `Deploy dir: ${deployDir}`, `Command: buckmason lookbook deploy --dir ${deployDir} --project buckmason-${lookbookId}`].join('\n'))
    this.log('READY_TO_DEPLOY')
    this.log(`Deploy dir: ${deployDir}`)
  }
}

async function discoverAndPick({host, company, profile, flags}: any): Promise<any[]> {
  const sizes = profile.sizes || {}
  const data = await discoverWeeklyCandidates({
    host,
    company,
    gender: (profile.gender as any) || 'u',
    sinceDays: flags.weekly ? 30 : 60,
    wishlistPath: flags.wishlist || defaultWishlistPath(),
    sizes,
    max: Math.max(flags['max-pieces'] * 3, 18),
  })
  const chosen = data.candidates.slice(0, flags['max-pieces'])
  const half = chosen.length < 4 ? chosen.length : Math.ceil(chosen.length / 2)
  return chosen.map((pick: any, index: number) => ({
    ...pick,
    look: index < half ? 'look1' : 'look2',
    picked_size: pick.size,
  }))
}

function defaultRunsDir(): string {
  return path.join(os.homedir(), '.buckmason/runs')
}

function defaultWishlistPath(): string {
  return path.join(os.homedir(), '.buckmason/wishlist.jsonl')
}

async function buildConfig({flags, lookbookId, today, picks}: any): Promise<Record<string, any>> {
  const looks = ['look1', 'look2']
    .filter((look) => picks.some((pick: any) => pick.look === look))
    .map((look, index) => ({
      id: look,
      eyebrow: `Look ${String(index + 1).padStart(2, '0')}`,
      title: `Look ${index + 1}`,
      note: '',
      setting: index === 0 ? 'Buck Mason daytime editorial setting with natural light.' : 'Buck Mason evening editorial setting with warm natural light.',
      composition: index === 0 ? 'Full body, walking, three-quarter angle, 35mm.' : 'Medium full body, relaxed stance, looking off camera, 35mm.',
    }))
  return {
    lookbook_id: lookbookId,
    lookbook_title: flags.weekly ? `This Week from Buck Mason - ${today}` : `Buck Mason Lookbook - ${today}`,
    lookbook_date: today,
    subtitle: flags.weekly ? "What's new on buckmason.com plus pieces not recently proposed." : 'A Buck Mason event lookbook.',
    page_url: `https://buckmason-${lookbookId}.pages.dev/`,
    looks,
  }
}

function deriveTier(flag: string, weekly: boolean, profile: Record<string, any>): 'premium' | 'editorial' {
  if (flag === 'premium' || flag === 'editorial') return flag
  if (weekly && String(profile.weekly_lookbook_tier || 'editorial').toLowerCase() !== 'premium') return 'editorial'
  return process.env.OPENAI_API_KEY && (profile.reference_photos || []).length >= 2 ? 'premium' : 'editorial'
}

async function deriveLookbookId(weekly: boolean, eventPath: string | undefined, today: string): Promise<string> {
  if (weekly) return `${today.slice(0, 4)}-weekly-${isoWeek(new Date())}`
  const event = JSON.parse(await readFile(eventPath || '', 'utf8'))
  const slug = String(event.title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'event'
  return `${today}-${slug}`
}

function isoWeek(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  return String(Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)).padStart(2, '0')
}

async function verifyPremiumFaces(looks: any[], looksDir: string, profile: Record<string, any>): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY || ''
  const references = profile.reference_photos || []
  if (!apiKey.startsWith('sk-') || references.length < 1) throw new Error('Premium resume requires OPENAI_API_KEY and reference_photos unless --no-verify is set.')
  const failures: string[] = []
  await Promise.all(looks.map(async (look) => {
    const result = await verifyFace({generated: path.join(looksDir, `${look.id}.png`), references, apiKey})
    if (!result.overall_pass) failures.push(`${look.id}: ${result.reason}`)
  }))
  if (failures.length) throw new Error(`Face verification failed: ${failures.join('; ')}`)
}

async function writeSummary(runDir: string, text: string): Promise<void> {
  await writeFile(path.join(runDir, 'summary.md'), `${text}\n`)
}
