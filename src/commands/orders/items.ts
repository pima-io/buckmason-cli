import {Args, Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {summarizeOrderItems} from '../../lib/orders.js'
import {printJson, renderRecords, type OutputFormat} from '../../lib/output.js'

export default class OrdersItems extends Command {
  static description = 'List item-level returnability and shipment status for an order.'

  static args = {
    code: Args.string({required: true, description: 'Order code'}),
  }

  static flags = {
    key: Flags.string({description: 'Override the built-in Buck Mason PIMA public API key.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(OrdersItems)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key, token: null})
    const orders = await client.apiGet<any[]>('/api/order_history', {
      order_code: args.code,
    }, {
      authenticated: false,
    })
    const order = (orders || []).find((candidate) => candidate.code === args.code) || orders?.[0]
    if (!order) throw new Error(`Order ${args.code} was not found.`)

    const items = summarizeOrderItems(order)
    if (flags.output === 'json') {
      this.log(printJson(items))
      return
    }

    this.log(renderRecords(items, ['id', 'product', 'color', 'size', 'sku', 'status', 'shipment_status', 'returnable', 'return_blocker'], flags.output as OutputFormat))
  }
}
