import {Command, Flags} from '@oclif/core'
import {readFile} from 'node:fs/promises'
import {generateLookImages, type LookbookImagePlan} from '../../lookbook/image-generation.js'
import {printJson, renderRecords} from '../../lib/output.js'

export default class LookbookGenerateImages extends Command {
  static description = 'Explicitly run gpt-image-2 image edits for a prepared premium lookbook image plan.'

  static flags = {
    plan: Flags.string({required: true, description: 'Image plan JSON from lookbook image-plan'}),
    out: Flags.string({required: true, description: 'Output directory for look<N>.png and .lookbook_id'}),
    concurrency: Flags.integer({description: 'Concurrent image edit calls; defaults to number of looks'}),
    'api-key-env': Flags.string({description: 'Env var containing the OpenAI key', default: 'OPENAI_API_KEY'}),
    'api-base': Flags.string({description: 'OpenAI API base URL', default: 'https://api.openai.com'}),
    'dry-run': Flags.boolean({description: 'Write prompt files and marker without calling OpenAI'}),
    json: Flags.boolean({description: 'Print JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookGenerateImages)
    const plan = JSON.parse(await readFile(flags.plan, 'utf8')) as LookbookImagePlan
    const apiKey = process.env[flags['api-key-env']] || ''
    if (!flags['dry-run'] && !apiKey.startsWith('sk-')) {
      throw new Error(`${flags['api-key-env']} must be set to an OpenAI API key. This command never downgrades from gpt-image-2.`)
    }

    const results = await generateLookImages({
      plan,
      outDir: flags.out,
      apiKey,
      apiBase: flags['api-base'],
      concurrency: flags.concurrency,
      dryRun: flags['dry-run'],
    })

    if (flags.json) this.log(printJson(results))
    else this.log(renderRecords(results, ['look_id', 'ok', 'output', 'error'], 'table'))

    if (results.some((result) => !result.ok)) this.exit(1)
  }
}
