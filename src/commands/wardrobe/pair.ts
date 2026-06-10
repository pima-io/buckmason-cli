import {Args, Command, Flags} from '@oclif/core'
import {findWardrobeItem, pairWithWardrobe, readWardrobe} from '../../lib/wardrobe.js'
import {printJson, renderRecords, type OutputFormat} from '../../lib/output.js'

export default class WardrobePair extends Command {
  static description = 'Suggest owned wardrobe pieces that pair with an owned Buck Mason item.'

  static args = {
    item: Args.string({required: true, description: 'Anchor SKU, cache id, or product-name text'}),
  }

  static flags = {
    cache: Flags.string({description: 'Wardrobe cache path'}),
    limit: Flags.integer({description: 'Maximum pairings', default: 8}),
    output: Flags.string({options: ['table', 'json'], default: 'table'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WardrobePair)
    const cache = await readWardrobe(flags.cache)
    const anchor = findWardrobeItem(cache.items, args.item)
    if (!anchor) throw new Error(`No wardrobe item matched "${args.item}".`)
    const rows = pairWithWardrobe(anchor, cache.items, flags.limit).map((candidate) => ({
      product: candidate.item.product,
      color: candidate.item.color,
      size: candidate.item.size,
      sku: candidate.item.sku,
      score: candidate.score,
      why: candidate.reasons.join('; '),
    }))
    if (flags.output === 'json') this.log(printJson({anchor, pairings: rows}))
    else {
      this.log(`Anchor: ${anchor.product} - ${anchor.color} - size ${anchor.size}`)
      this.log(renderRecords(rows, ['product', 'color', 'size', 'sku', 'score', 'why'], flags.output as OutputFormat))
    }
  }
}
