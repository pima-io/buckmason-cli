import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {renderRecords, type OutputFormat} from '../../lib/output.js'

export default class ReturnsRates extends Command {
  static description = 'List return shipping rates.'

  static flags = {
    'order-code': Flags.string({description: 'Use the guest order-code path instead of an authorized token'}),
    key: Flags.string({description: 'PIMA public API key. Or set BUCKMASON_PIMA_KEY.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ReturnsRates)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const rates = await client.apiGet<any[]>('/api/return_shipping_rates', {
      order_code: flags['order-code'],
    }, {
      authenticated: !flags['order-code'],
    })
    this.log(renderRecords(rates || [], ['id', 'name', 'price'], flags.output as OutputFormat))
  }
}
