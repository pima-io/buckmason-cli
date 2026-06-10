import {Command, Flags, Args} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderRecords} from '../../lib/output.js'

export default class StockCheck extends Command {
  static description = 'Check online and nearby-store stock for a SKU.'

  static args = {
    sku: Args.string({required: true}),
  }

  static flags = {
    'near-zip': Flags.string({description: 'ZIP for nearby stores'}),
    radius: Flags.integer({description: 'Radius in miles', default: 25}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print JSON'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(StockCheck)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const stock = await client.mcpGet(`/stock/${encodeURIComponent(args.sku)}`, {
      near_zip: flags['near-zip'],
      radius_mi: flags.radius,
    })
    if (flags.json) this.log(printJson(stock))
    else {
      const online = (stock as any).online
      this.log(`Online: ${online?.label ?? online ?? 'unknown'}`)
      this.log(renderRecords((stock as any).locations || [], ['name', 'distance_mi', 'pickup_enabled', 'in_stock', 'count'], 'table'))
    }
  }
}
