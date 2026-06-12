import {Command, Flags} from '@oclif/core'
import {existsSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {Client} from '../../lib/client.js'
import {printJson, renderRecords} from '../../lib/output.js'
import {buildHtmlLookbook} from '../../lookbook/build-html.js'
import {deployWithWrangler, prepareCloudflarePagesDeploy} from '../../lookbook/deploy.js'
import {buildLookbookImagePlan, generateLookImages, type LookbookImagePlan} from '../../lookbook/image-generation.js'
import {
  failedLookIds,
  filterImagePlanLooks,
  imagePlanWithRecheckAddenda,
  recheckLookbook,
  renderOutfitRecheckSummary,
  type OutfitRecheckReport,
} from '../../lookbook/recheck.js'
import {
  buildTripArtifacts,
  buildTripConfig,
  buildTripPicks,
  defaultPeopleDir,
  defaultRunsDir,
  parseTripProfile,
  readTripPlan,
  resolvePersonProfile,
  smokeCheckLookbook,
  writeTripInputs,
} from '../../lookbook/trip.js'
import {validateLookbookDir} from '../../lookbook/validate.js'

export default class LookbookTrip extends Command {
  static description = 'Build a destination trip lookbook from a plan file, optional premium image generation, Wrangler deploy, and smoke checks.'

  static flags = {
    plan: Flags.string({required: true, description: 'Trip plan JSON with destination, month, looks, and product ids'}),
    person: Flags.string({description: 'Person preset name under --people-dir, overriding plan.person'}),
    profile: Flags.string({description: 'Profile markdown path, overriding plan.profile'}),
    'people-dir': Flags.string({description: 'Directory containing <person>/profile.md presets. Defaults to ~/.buckmason/people.', defaultHelp: '~/.buckmason/people'}),
    'runs-dir': Flags.string({description: 'Run directory root. Defaults to ~/.buckmason/runs.', defaultHelp: '~/.buckmason/runs'}),
    'run-dir': Flags.string({description: 'Exact run directory. Overrides --runs-dir.'}),
    project: Flags.string({description: 'Cloudflare Pages project name. Defaults to plan.project or buckmason-<lookbook-id>.'}),
    'no-tryon': Flags.boolean({description: 'Build editorial product-image tier instead of premium generated try-on images'}),
    'generate-images': Flags.boolean({description: 'Call gpt-image-2 for missing premium look images'}),
    recheck: Flags.boolean({description: 'Visually verify generated outfits against selected product references before deploy'}),
    'recheck-fix': Flags.boolean({description: 'Regenerate failed outfits once the visual recheck suggests a fix. Implies --recheck'}),
    'recheck-max-retries': Flags.integer({description: 'Maximum outfit recheck fix/regenerate attempts', default: 1}),
    'recheck-fail-on-warning': Flags.boolean({description: 'Treat outfit recheck warnings as failures'}),
    'recheck-model': Flags.string({description: 'Vision model for outfit recheck', default: 'gpt-4o'}),
    concurrency: Flags.integer({description: 'Concurrent premium image edit calls; defaults to number of looks'}),
    'api-key-env': Flags.string({description: 'Env var containing the OpenAI key', default: 'OPENAI_API_KEY'}),
    'api-base': Flags.string({description: 'OpenAI API base URL', default: 'https://api.openai.com'}),
    deploy: Flags.boolean({description: 'Deploy to Cloudflare Pages with Wrangler after local validation'}),
    'dry-run': Flags.boolean({description: 'Prepare deploy files but do not publish to Cloudflare Pages'}),
    'kv-id': Flags.string({description: 'Cloudflare KV namespace id for legacy LOOKBOOK_VOTES import'}),
    'no-voting': Flags.boolean({description: 'Deploy read-only static lookbook without voting functions'}),
    'no-overwrite': Flags.boolean({description: 'Refuse to deploy if the Pages project already has deployments'}),
    'no-smoke': Flags.boolean({description: 'Skip post-deploy page, manifest, voting, and OG smoke checks'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print JSON summary'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookTrip)
    const plan = await readTripPlan(flags.plan)
    if (flags.person) plan.person = flags.person
    if (flags.profile) plan.profile = flags.profile

    const artifacts = buildTripArtifacts({plan, runsDir: flags['runs-dir'] || defaultRunsDir(), runDir: flags['run-dir'], project: flags.project})
    const profileSourcePath = resolvePersonProfile({plan, profile: flags.profile, person: flags.person, peopleDir: flags['people-dir'] || defaultPeopleDir()})
    const profileText = await readFile(profileSourcePath, 'utf8')
    const profile = parseTripProfile(profileText)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const config = buildTripConfig(plan, artifacts)
    const picks = await buildTripPicks({client, plan, profile})
    await writeTripInputs({plan, artifacts, profileSourcePath, profileText, config, picks})

    const tier = flags['no-tryon'] ? 'editorial' : 'premium'
    let generatedImages: Array<{look_id: string; output: string; ok: boolean; error?: string}> = []
    let outfitRecheck: OutfitRecheckReport | null = null
    if (tier === 'premium') {
      let imagePlan: LookbookImagePlan = buildLookbookImagePlan({config, picks, profile})
      await writeFile(artifacts.imagePlanPath, `${JSON.stringify(imagePlan, null, 2)}\n`)
      const missing = imagePlan.looks.filter((look) => !pathExists(path.join(artifacts.looksDir, `${look.id}.png`)))
      const canGenerateMissing = flags['generate-images'] || flags['recheck-fix']
      if (missing.length && !canGenerateMissing) {
        this.log('READY_FOR_PREMIUM_IMAGE_STEP')
        this.log(`Image plan: ${artifacts.imagePlanPath}`)
        this.log(`Generate: buckmason lookbook trip --plan ${flags.plan} --generate-images${flags.deploy ? ' --deploy' : ''}`)
        return
      }

      if (missing.length) {
        const apiKey = process.env[flags['api-key-env']] || ''
        if (!apiKey.startsWith('sk-')) throw new Error(`${flags['api-key-env']} must be set to an OpenAI API key.`)
        this.log(`Generating ${missing.length} premium look image${missing.length === 1 ? '' : 's'}...`)
        generatedImages = await generateLookImages({
          plan: imagePlan,
          outDir: artifacts.looksDir,
          apiKey,
          apiBase: flags['api-base'],
          concurrency: flags.concurrency,
        })
        this.log(renderRecords(generatedImages, ['look_id', 'ok', 'output', 'error'], 'table'))
        if (generatedImages.some((result) => !result.ok)) throw new Error('Premium image generation failed.')
      }

      if (flags.recheck || flags['recheck-fix']) {
        const apiKey = process.env[flags['api-key-env']] || ''
        if (!apiKey.startsWith('sk-')) throw new Error(`${flags['api-key-env']} must be set to an OpenAI API key.`)
        outfitRecheck = await recheckLookbook({
          runDir: artifacts.runDir,
          apiKey,
          apiBase: flags['api-base'],
          model: flags['recheck-model'],
          failOnWarning: flags['recheck-fail-on-warning'],
        })

        let attempts = 0
        while (!outfitRecheck.ok && flags['recheck-fix'] && attempts < flags['recheck-max-retries']) {
          const ids = failedLookIds(outfitRecheck, {failOnWarning: flags['recheck-fail-on-warning']})
          if (!ids.length) break
          attempts += 1
          imagePlan = imagePlanWithRecheckAddenda(imagePlan, outfitRecheck, {failOnWarning: flags['recheck-fail-on-warning']})
          await writeFile(artifacts.imagePlanPath, `${JSON.stringify(imagePlan, null, 2)}\n`)
          this.log(`Regenerating ${ids.join(', ')} after outfit recheck failure...`)
          const retryGenerated = await generateLookImages({
            plan: filterImagePlanLooks(imagePlan, ids),
            outDir: artifacts.looksDir,
            apiKey,
            apiBase: flags['api-base'],
            concurrency: flags.concurrency,
          })
          generatedImages = [...generatedImages, ...retryGenerated]
          this.log(renderRecords(retryGenerated, ['look_id', 'ok', 'output', 'error'], 'table'))
          if (retryGenerated.some((result) => !result.ok)) throw new Error('Premium image regeneration failed.')
          outfitRecheck = await recheckLookbook({
            runDir: artifacts.runDir,
            apiKey,
            apiBase: flags['api-base'],
            model: flags['recheck-model'],
            failOnWarning: flags['recheck-fail-on-warning'],
          })
        }

        this.log(renderOutfitRecheckSummary(outfitRecheck))
        if (!outfitRecheck.ok) throw new Error('Outfit recheck failed. Rerun with --recheck-fix to regenerate failed looks before deploy.')
      }

      await buildHtmlLookbook({configPath: artifacts.configPath, picksPath: artifacts.picksPath, outDir: artifacts.deployDir, lookImagesDir: artifacts.looksDir})
    } else {
      await buildHtmlLookbook({configPath: artifacts.configPath, picksPath: artifacts.picksPath, outDir: artifacts.deployDir, noTryon: true})
    }

    const validation = await validateLookbookDir(artifacts.deployDir)
    if (!validation.ok) throw new Error(`Validation failed: ${validation.failures.join('; ')}`)

    let url = config.page_url
    let smoke = null
    if (flags.deploy) {
      process.env.WRANGLER_LOG_PATH ||= '/private/tmp/wrangler-logs'
      process.env.ASDF_NODEJS_VERSION ||= '20.20.2'
      const prepared = await prepareCloudflarePagesDeploy({
        dir: artifacts.deployDir,
        project: artifacts.project,
        kvId: flags['kv-id'] || process.env.LOOKBOOK_VOTES_KV_ID,
        withVoting: !flags['no-voting'],
      })
      this.log(`Prepared ${artifacts.deployDir} for Cloudflare Pages (${prepared.voting ? 'voting enabled' : 'read-only'}).`)
      url = await deployWithWrangler({
        dir: artifacts.deployDir,
        project: artifacts.project,
        dryRun: flags['dry-run'],
        noOverwrite: flags['no-overwrite'],
        voteRoomWorkerDir: prepared.voteRoomWorkerDir,
      })
      if (!flags['dry-run'] && !flags['no-smoke']) {
        smoke = await smokeCheckLookbook(url)
        if (!smoke.ok) throw new Error(`Deploy smoke check failed: ${JSON.stringify(smoke)}`)
      }
    }

    const summary = {
      status: flags.deploy ? (flags['dry-run'] ? 'dry_run_ready' : 'deployed') : 'ready_to_deploy',
      tier,
      lookbook_id: artifacts.lookbookId,
      project: artifacts.project,
      run_dir: artifacts.runDir,
      deploy_dir: artifacts.deployDir,
      url,
      looks: config.looks.length,
      items: picks.length,
      generated_images: generatedImages.length,
      outfit_recheck: outfitRecheck,
      smoke,
    }
    if (flags.json) this.log(printJson(summary))
    else {
      this.log(`READY: ${summary.status}`)
      this.log(`URL: ${url}`)
      this.log(`Run dir: ${artifacts.runDir}`)
      if (smoke) this.log(`Smoke: page ${smoke.page_status}, votes ${smoke.votes_status}, live ${smoke.live_status}, og ${smoke.og_status}`)
    }
  }
}

function pathExists(filePath: string): boolean {
  return existsSync(filePath)
}
