import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {renderRecords, type OutputFormat} from '../../lib/output.js'

export default class ReturnsReasons extends Command {
  static description = 'List Buck Mason return reasons.'

  static flags = {
    'order-code': Flags.string({description: 'Use the guest order-code path instead of an authorized token'}),
    key: Flags.string({description: 'Override the built-in Buck Mason PIMA public API key.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ReturnsReasons)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const reasons = await client.apiGet<any[]>('/api/return_reasons', {
      order_code: flags['order-code'],
    }, {
      authenticated: !flags['order-code'],
    })
    this.log(renderRecords(reasons || [], ['id', 'text'], flags.output as OutputFormat))
  }
}
