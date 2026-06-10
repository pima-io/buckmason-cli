import {Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {buildWardrobeFromOrders, wardrobePath, writeWardrobe} from '../../lib/wardrobe.js'
import {printJson, renderKeyValues} from '../../lib/output.js'

export default class WardrobeSync extends Command {
  static description = 'Sync the authorized customer order history into a local wardrobe cache.'

  static flags = {
    pages: Flags.integer({description: 'Maximum order-history pages to fetch', default: 10}),
    out: Flags.string({description: 'Wardrobe cache path'}),
    key: Flags.string({description: 'PIMA public API key. Or set BUCKMASON_PIMA_KEY.'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    json: Flags.boolean({description: 'Print JSON summary'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(WardrobeSync)
    const client = await Client.create({host: flags.host, companySlug: flags.company, key: flags.key})
    const orders: any[] = []
    for (let page = 1; page <= flags.pages; page += 1) {
      const batch = await client.apiGet<any[]>('/api/order_history', {page}, {authenticated: true})
      if (!batch?.length) break
      orders.push(...batch)
    }

    const cache = buildWardrobeFromOrders(orders, {host: client.host, company: client.companySlug})
    const target = await writeWardrobe(cache, flags.out)
    const summary = {
      path: target || wardrobePath(flags.out),
      orders: orders.length,
      items: cache.items.length,
      owned: cache.items.filter((item) => item.status === 'owned').length,
      not_in_hand: cache.items.filter((item) => item.status === 'not_in_hand').length,
      maybe_owned: cache.items.filter((item) => item.status === 'maybe_owned').length,
    }
    this.log(flags.json ? printJson(summary) : renderKeyValues(summary, 'table'))
  }
}
