import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderRecords, type OutputFormat} from '../../lib/output.js'

export default class OrdersHistory extends Command {
  static description = 'List customer order history using an authorized token, or one order with --order-code.'

  static flags = {
    page: Flags.integer({description: 'Page number', default: 1}),
    'order-code': Flags.string({description: 'Use the guest order-code path for a single order lookup'}),
    key: Flags.string({description: 'PIMA public API key. Or set BUCKMASON_PIMA_KEY.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(OrdersHistory)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const orders = await client.apiGet<any[]>('/api/order_history', {
      page: flags.page,
      order_code: flags['order-code'],
    }, {
      authenticated: !flags['order-code'],
    })
    if (flags.output === 'json') {
      this.log(printJson(orders))
      return
    }

    this.log(renderRecords(orders || [], ['code', 'status', 'rms_status', 'completed_at', 'total'], flags.output as OutputFormat))
  }
}
