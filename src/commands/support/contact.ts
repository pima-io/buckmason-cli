import {Command, Flags} from '@oclif/core'
import {BUCK_MASON_SUPPORT_INFO, renderSupportInfo} from '../../lib/support.js'
import {printJson} from '../../lib/output.js'

export default class SupportContact extends Command {
  static description = 'Show Buck Mason customer-service contact info and self-service links from the public FAQ page.'

  static flags = {
    json: Flags.boolean({description: 'Print support info as JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(SupportContact)
    this.log(flags.json ? printJson(BUCK_MASON_SUPPORT_INFO) : renderSupportInfo())
  }
}
