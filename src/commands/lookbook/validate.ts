import {Command, Flags} from '@oclif/core'
import {validateLookbookDir} from '../../lookbook/validate.js'
import {printJson} from '../../lib/output.js'

export default class LookbookValidate extends Command {
  static description = 'Validate a locally built Buck Mason lookbook directory.'

  static flags = {
    dir: Flags.string({required: true, description: 'Lookbook output directory'}),
    json: Flags.boolean({description: 'Print JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(LookbookValidate)
    const result = await validateLookbookDir(flags.dir)
    if (flags.json) this.log(printJson(result))
    else {
      for (const warning of result.warnings) this.warn(warning)
      for (const failure of result.failures) this.error(failure, {exit: false})
      this.log(result.ok ? 'Lookbook validation passed.' : 'Lookbook validation failed.')
    }
    if (!result.ok) this.exit(1)
  }
}
