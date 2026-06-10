import {Args, Command, Flags} from '@oclif/core'
import {Client} from '../../lib/client.js'
import {findWardrobeItem, matchNewProducts, readWardrobe} from '../../lib/wardrobe.js'
import {printJson, renderRecords, type OutputFormat} from '../../lib/output.js'

export default class WardrobeMatchNew extends Command {
  static description = 'Find recent Buck Mason products that pair with an owned wardrobe item.'

  static args = {
    item: Args.string({required: true, description: 'Anchor SKU, cache id, or product-name text'}),
  }

  static flags = {
    gender: Flags.string({description: 'm, w, or u'}),
    category: Flags.string({description: 'Restrict new products to a category'}),
    days: Flags.integer({description: 'Recently-live window in days', default: 45}),
    limit: Flags.integer({description: 'Maximum matches', default: 8}),
    cache: Flags.string({description: 'Wardrobe cache path'}),
    host: Flags.string({description: 'PIMA host'}),
    company: Flags.string({description: 'PIMA company slug'}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WardrobeMatchNew)
    const cache = await readWardrobe(flags.cache)
    const anchor = findWardrobeItem(cache.items, args.item)
    if (!anchor) throw new Error(`No wardrobe item matched "${args.item}".`)

    const client = await Client.create({host: flags.host, companySlug: flags.company, token: null})
    const data = await client.mcpGet<Record<string, any>>('/seasonal', {
      gender: flags.gender,
      category: flags.category,
      days: flags.days,
      limit: Math.max(flags.limit * 4, 24),
    })
    const products = flattenSeasonalProducts(data)
    const matches = matchNewProducts(anchor, products, cache.items, flags.limit).map((candidate) => ({
      id: candidate.product.id,
      name: candidate.product.name,
      color: candidate.product.color,
      price: candidate.product.price,
      score: candidate.score,
      why: candidate.reasons.join('; '),
      url: candidate.product.url,
    }))

    if (flags.output === 'json') this.log(printJson({anchor, matches}))
    else {
      this.log(`Anchor: ${anchor.product} - ${anchor.color} - size ${anchor.size}`)
      this.log(renderRecords(matches, ['id', 'name', 'color', 'price', 'score', 'why', 'url'], flags.output as OutputFormat))
    }
  }
}

function flattenSeasonalProducts(data: Record<string, any>): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  for (const group of data.categories || []) {
    for (const product of group.products || []) out.push({...product, category: product.category || group.category})
  }

  return out
}
