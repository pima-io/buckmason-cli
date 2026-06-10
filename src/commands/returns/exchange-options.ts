import {Command, Flags, Args} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderRecords, type OutputFormat} from '../../lib/output.js'

export default class ReturnsExchangeOptions extends Command {
  static description = 'List exchange SKU options for a returnable order item.'

  static args = {
    'order-item-id': Args.integer({required: true, description: 'Order item id to exchange'}),
  }

  static flags = {
    'order-code': Flags.string({description: 'Use the guest order-code path instead of an authorized token'}),
    key: Flags.string({description: 'Override the built-in Buck Mason PIMA public API key.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ReturnsExchangeOptions)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const options = await client.apiGet<any[]>(
      `/api/exchange_options/${encodeURIComponent(args['order-item-id'])}`,
      {order_code: flags['order-code']},
      {authenticated: !flags['order-code']},
    )

    if (flags.output === 'json') {
      this.log(printJson(options))
      return
    }

    this.log(renderRecords(options || [], ['sku_id', 'product', 'color', 'size', 'in_stock', 'price', 'sku'], flags.output as OutputFormat))
  }
}
