import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderKeyValues, type OutputFormat} from '../../lib/output.js'

export default class ReturnsAddress extends Command {
  static description = 'Show the customer saved address PIMA will use for return labels.'

  static flags = {
    'order-code': Flags.string({description: 'Use the guest order-code path instead of an authorized token'}),
    key: Flags.string({description: 'PIMA public API key. Or set BUCKMASON_PIMA_KEY.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ReturnsAddress)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const address = await client.apiGet<Record<string, unknown>>('/api/address', {
      order_code: flags['order-code'],
    }, {
      authenticated: !flags['order-code'],
    })

    if (flags.output === 'json') {
      this.log(printJson(address))
      return
    }

    this.log(renderKeyValues(address || {}, flags.output as OutputFormat))
  }
}
