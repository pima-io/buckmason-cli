import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {parseCartItemSpec} from '../../lib/items.js'
import {printJson, renderKeyValues, renderRecords} from '../../lib/output.js'

export default class CartBuild extends Command {
  static description = 'Build a stateless Buck Mason Shopify cart permalink from products and sizes.'

  static flags = {
    item: Flags.string({
      char: 'i',
      multiple: true,
      required: true,
      description: 'Cart item as product-id-or-code:size[:qty]. Repeat for multiple items.',
    }),
    coupon: Flags.string({description: 'Optional coupon code'}),
    'pickup-location-slug': Flags.string({description: 'Optional pickup location slug'}),
    'pickup-location-id': Flags.integer({description: 'Optional pickup location id'}),
    'allow-pickup-partial': Flags.boolean({description: 'Allow cart even when not every item is available for pickup'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print full JSON'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(CartBuild)
    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const data = await client.mcpPost<Record<string, any>>('/cart', {
      items: flags.item.map(parseCartItemSpec),
      coupon: flags.coupon,
      pickup_location_slug: flags['pickup-location-slug'],
      pickup_location_id: flags['pickup-location-id'],
      allow_pickup_partial: flags['allow-pickup-partial'] || undefined,
    })

    if (flags.json) {
      this.log(printJson(data))
      return
    }

    this.log(renderKeyValues({
      checkout_url: data.checkout_url,
      subtotal: data.subtotal,
      coupon: data.coupon,
      pickup: data.pickup?.location_name,
    }, 'table'))
    this.log(renderRecords(data.items || [], ['sku', 'size', 'quantity', 'unit_price'], 'table'))
  }
}
