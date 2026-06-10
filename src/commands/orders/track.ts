import {Command, Flags, Args} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderRecords} from '../../lib/output.js'

export default class OrdersTrack extends Command {
  static description = 'Show shipment tracking for one order code. Defaults to the guest order-code path.'

  static args = {
    code: Args.string({required: true, description: 'Order code'}),
  }

  static flags = {
    account: Flags.boolean({description: 'Search saved account history instead of using the guest order-code path'}),
    key: Flags.string({description: 'PIMA public API key. Or set BUCKMASON_PIMA_KEY.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full order JSON'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(OrdersTrack)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const orders = await client.apiGet<any[]>('/api/order_history', {
      order_code: flags.account ? undefined : args.code,
    }, {
      authenticated: flags.account,
    })
    const order = (orders || []).find((candidate) => String(candidate.code).toLowerCase() === args.code.toLowerCase())
    if (!order) throw new Error(`No order found for ${args.code}`)
    if (flags.json) {
      this.log(printJson(order))
      return
    }

    this.log(`${order.code} - ${order.rms_status || order.status || 'unknown'}`)
    this.log(renderRecords(order.shipments || [], ['status', 'tracking_code', 'tracking_url', 'shipped_at', 'estimated_delivery_date'], 'table'))
  }
}
