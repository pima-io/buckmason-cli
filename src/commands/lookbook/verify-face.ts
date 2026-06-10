import {Command, Flags} from '@oclif/core'
import {verifyFace} from '../../lookbook/image-generation.js'
import {printJson} from '../../lib/output.js'

export default class LookbookVerifyFace extends Command {
  static description = 'Verify a generated premium try-on face against customer reference photos.'

  static flags = {
    generated: Flags.string({required: true, description: 'Generated look image'}),
    reference: Flags.string({multiple: true, required: true, description: 'Customer reference photo. Repeat for multiple photos.'}),
    threshold: Flags.integer({description: 'Minimum score for every face match dimension', default: 6}),
    'off-putting-cap': Flags.integer({description: 'Maximum allowed generic/uncanny score', default: 4}),
    model: Flags.string({description: 'Vision-capable OpenAI model', default: 'gpt-4o'}),
    'api-key-env': Flags.string({description: 'Env var containing the OpenAI key', default: 'OPENAI_API_KEY'}),
    'api-base': Flags.string({description: 'OpenAI API base URL', default: 'https://api.openai.com'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookVerifyFace)
    const apiKey = process.env[flags['api-key-env']] || ''
    if (!apiKey.startsWith('sk-')) throw new Error(`${flags['api-key-env']} must be set to an OpenAI API key.`)

    const result = await verifyFace({
      generated: flags.generated,
      references: flags.reference,
      apiKey,
      model: flags.model,
      apiBase: flags['api-base'],
      threshold: flags.threshold,
      offPuttingCap: flags['off-putting-cap'],
    })
    this.log(printJson(result))
    if (!result.overall_pass) this.exit(1)
  }
}
