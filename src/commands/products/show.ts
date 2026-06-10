import {Command, Flags, Args} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {printJson, renderKeyValues, renderRecords} from '../../lib/output.js'

export default class ProductsShow extends Command {
  static description = 'Show Buck Mason product detail, variants, imagery, and nearby stock.'

  static args = {
    id: Args.string({required: true, description: 'Numeric product id or product code'}),
  }

  static flags = {
    'near-zip': Flags.string({description: 'ZIP for nearby stock'}),
    radius: Flags.integer({description: 'Radius in miles', default: 25}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full JSON'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ProductsShow)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const product = await client.mcpGet(`/products/${encodeURIComponent(args.id)}`, {
      near_zip: flags['near-zip'],
      radius_mi: flags.radius,
    })
    if (flags.json) {
      this.log(printJson(product))
      return
    }

    this.log(renderKeyValues(product as Record<string, unknown>, 'table'))
    const variants = ((product as any).variants || []).map((v: any) => ({
      sku: v.sku,
      size: v.size,
      online: v.online?.label ?? '',
      fulfillment: v.fulfillment?.mode ?? '',
      pickup_at: (v.fulfillment?.pickup_locations || []).map((l: any) => l.name).join(', '),
    }))
    if (variants.length > 0) this.log(renderRecords(variants, ['sku', 'size', 'online', 'fulfillment', 'pickup_at'], 'table'))
  }
}
