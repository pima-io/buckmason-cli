import {Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {generateLookImages, type LookbookImagePlan} from '../../lookbook/image-generation.js'
import {
  failedLookIds,
  filterImagePlanLooks,
  imagePlanWithRecheckAddenda,
  recheckLookbook,
  renderOutfitRecheckSummary,
  writeImagePlan,
} from '../../lookbook/recheck.js'
import {printJson} from '../../lib/output.js'

export default class LookbookRecheck extends Command {
  static description = 'Visually recheck generated outfit images against the selected Buck Mason product references.'

  static flags = {
    'run-dir': Flags.string({required: true, description: 'Lookbook run directory containing config.json, picks.json, image-plan.json, and looks/*.png'}),
    look: Flags.string({description: 'Comma-separated look ids to recheck, for example look2 or look1,look3'}),
    fix: Flags.boolean({description: 'Regenerate failed looks with the recheck addendum, then recheck'}),
    'max-retries': Flags.integer({description: 'Maximum fix/regenerate attempts when --fix is used', default: 1}),
    'fail-on-warning': Flags.boolean({description: 'Treat warnings as failures'}),
    model: Flags.string({description: 'Vision model for outfit QA', default: 'gpt-4o'}),
    'api-key-env': Flags.string({description: 'Env var containing the OpenAI key', default: 'OPENAI_API_KEY'}),
    'api-base': Flags.string({description: 'OpenAI API base URL', default: 'https://api.openai.com'}),
    concurrency: Flags.integer({description: 'Concurrent premium image edit calls for --fix'}),
    json: Flags.boolean({description: 'Print JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookRecheck)
    const apiKey = process.env[flags['api-key-env']] || ''
    if (!apiKey.startsWith('sk-')) throw new Error(`${flags['api-key-env']} must be set to an OpenAI API key.`)

    const runDir = expandHome(flags['run-dir'])
    const lookIds = parseLookIds(flags.look)
    let report = await recheckLookbook({
      runDir,
      apiKey,
      apiBase: flags['api-base'],
      model: flags.model,
      lookIds,
      failOnWarning: flags['fail-on-warning'],
    })

    let imagePlan = JSON.parse(await readFile(path.join(runDir, 'image-plan.json'), 'utf8')) as LookbookImagePlan
    let attempts = 0
    while (!report.ok && flags.fix && attempts < flags['max-retries']) {
      const ids = failedLookIds(report, {failOnWarning: flags['fail-on-warning']})
      if (!ids.length) break
      attempts += 1
      imagePlan = imagePlanWithRecheckAddenda(imagePlan, report, {failOnWarning: flags['fail-on-warning']})
      await writeImagePlan(imagePlan, path.join(runDir, 'image-plan.json'))
      const retryPlan = filterImagePlanLooks(imagePlan, ids)
      this.log(`Regenerating ${ids.join(', ')} after outfit recheck failure...`)
      const generated = await generateLookImages({
        plan: retryPlan,
        outDir: path.join(runDir, 'looks'),
        apiKey,
        apiBase: flags['api-base'],
        concurrency: flags.concurrency,
      })
      const failed = generated.filter((result) => !result.ok)
      if (failed.length) throw new Error(`Regeneration failed: ${failed.map((result) => `${result.look_id}: ${result.error}`).join('; ')}`)
      report = await recheckLookbook({
        runDir,
        apiKey,
        apiBase: flags['api-base'],
        model: flags.model,
        lookIds,
        failOnWarning: flags['fail-on-warning'],
      })
    }

    if (flags.json) this.log(printJson({attempts, ...report}))
    else this.log(renderOutfitRecheckSummary(report))
    if (!report.ok) this.exit(1)
  }
}

function parseLookIds(value?: string): string[] | undefined {
  if (!value) return undefined
  return value.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}
